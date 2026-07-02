from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import uuid
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque


MAX_LOG_LINES = 500


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Job:
    job_id: str
    job_type: str
    status: str
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    exit_code: int | None = None
    error: str | None = None
    pid: int | None = None
    log_count: int = 0
    last_event_at: str | None = None
    process_alive: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class JobNotFoundError(KeyError):
    pass


class JobConflictError(RuntimeError):
    pass


class JobStartError(RuntimeError):
    pass


class JobManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._jobs: dict[str, Job] = {}
        self._events: dict[str, Deque[dict[str, Any]]] = {}
        self._event_sequences: dict[str, int] = {}
        self._running_job_id: str | None = None
        self._active_operation: str | None = None
        self._processes: dict[str, subprocess.Popen[str]] = {}

    def start_scraper(self) -> Job:
        return self._start_job("scraper", self._build_scraper_command)

    def start_llm(self) -> Job:
        return self._start_job("llm", self._build_llm_command)

    def acquire_operation(self, operation_type: str) -> None:
        with self._condition:
            if self._active_operation:
                raise JobConflictError(self._conflict_message(self._active_operation))
            self._active_operation = operation_type

    def release_operation(self, operation_type: str) -> None:
        with self._condition:
            if self._active_operation == operation_type:
                self._active_operation = None
            self._condition.notify_all()

    def _start_job(self, job_type: str, command_builder: Any) -> Job:
        with self._condition:
            if self._active_operation:
                raise JobConflictError(self._conflict_message(self._active_operation))

            job = Job(
                job_id=str(uuid.uuid4()),
                job_type=job_type,
                status="running",
                created_at=utc_now(),
                started_at=utc_now(),
            )
            self._jobs[job.job_id] = job
            self._events[job.job_id] = deque(maxlen=MAX_LOG_LINES)
            self._event_sequences[job.job_id] = 0
            self._running_job_id = job.job_id
            self._active_operation = job_type

        thread = threading.Thread(target=self._run_job, args=(job.job_id, command_builder), daemon=True)
        thread.start()
        return job

    def get_job(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise JobNotFoundError(job_id)
            snapshot = job.to_dict()
            process = self._processes.get(job_id)
            snapshot["process_alive"] = bool(process and process.poll() is None)
            snapshot["log_count"] = len(self._events.get(job_id, ()))
            snapshot["events"] = [
                self._public_event(event)
                for event in list(self._events.get(job_id, ()))[-50:]
            ]
            return snapshot

    def snapshot_events(self, job_id: str) -> tuple[list[dict[str, Any]], bool, int]:
        with self._lock:
            if job_id not in self._jobs:
                raise JobNotFoundError(job_id)
            events = list(self._events.get(job_id, ()))
            finished = self._jobs[job_id].status in {"succeeded", "failed"}
            sequence = self._event_sequences.get(job_id, 0)
            return events, finished, sequence

    def wait_for_event_sequence(self, job_id: str, current_sequence: int, timeout: float) -> int:
        with self._condition:
            if job_id not in self._jobs:
                raise JobNotFoundError(job_id)
            self._condition.wait_for(
                lambda: self._event_sequences.get(job_id, 0) > current_sequence
                or self._jobs[job_id].status in {"succeeded", "failed"},
                timeout=timeout,
            )
            return self._event_sequences.get(job_id, 0)

    def cancel_job(self, job_id: str) -> None:
        """Request cancellation of a running job by terminating its subprocess."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise JobNotFoundError(job_id)
            if job.status not in {"running", "pending"}:
                return  # already finished, nothing to do
            process = self._processes.get(job_id)

        if process and process.poll() is None:
            try:
                process.terminate()
            except OSError:
                pass

    def _run_job(self, job_id: str, command_builder: Any) -> None:
        process: subprocess.Popen[str] | None = None
        try:
            command, cwd, env = command_builder()
            job_type = self._jobs[job_id].job_type
            self._append_event(
                job_id,
                {
                    "type": "start",
                    "job_id": job_id,
                    "job_type": job_type,
                    "message": "任务开始",
                    "timestamp": utc_now(),
                },
            )

            process = subprocess.Popen(
                command,
                cwd=str(cwd),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )

            with self._lock:
                self._processes[job_id] = process
                self._jobs[job_id].pid = process.pid
                self._jobs[job_id].process_alive = True

            readers = [
                threading.Thread(
                    target=self._read_stream,
                    args=(job_id, "stdout", process.stdout),
                    daemon=True,
                ),
                threading.Thread(
                    target=self._read_stream,
                    args=(job_id, "stderr", process.stderr),
                    daemon=True,
                ),
            ]
            for reader in readers:
                reader.start()

            exit_code = process.wait()
            for reader in readers:
                reader.join(timeout=2)

            status = "succeeded" if exit_code == 0 else "failed"
            self._finish_job(job_id, status=status, exit_code=exit_code, error=None)
        except Exception as exc:
            if process and process.poll() is None:
                try:
                    process.terminate()
                    process.wait(timeout=5)
                except OSError:
                    pass
            self._finish_job(job_id, status="failed", exit_code=None, error=str(exc))
        finally:
            with self._lock:
                self._processes.pop(job_id, None)
                if job_id in self._jobs:
                    self._jobs[job_id].process_alive = False

    def _build_scraper_command(self) -> tuple[list[str], Path, dict[str, str]]:
        project_root = Path(__file__).resolve().parents[2]
        scraper_root = project_root / "backend" / "python-http-www-cfcpn-com-jcw"
        default_script = scraper_root / "cfcpn_scraper.py"

        default_python = scraper_root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        python_executable = self._resolve_path(
            os.getenv("SCRAPER_PYTHON_EXECUTABLE"),
            project_root,
            default_python if default_python.exists() else Path(sys.executable),
        )
        script_path = self._resolve_path(os.getenv("SCRAPER_SCRIPT_PATH"), project_root, default_script)
        working_dir = self._resolve_path(os.getenv("SCRAPER_WORKING_DIR"), project_root, scraper_root)

        self._validate_executable_job_paths("Scraper", python_executable, script_path, working_dir)

        command = [
            str(python_executable),
            "-u",
            str(script_path),
            "--keyword",
            "\u8bc1\u5238",
            "--update",
            "--output-dir",
            "output",
            "--resume",
        ]
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env.setdefault("PYTHONIOENCODING", "utf-8")
        return command, working_dir, env

    def _build_llm_command(self) -> tuple[list[str], Path, dict[str, str]]:
        project_root = Path(__file__).resolve().parents[2]
        default_script = project_root / "backend" / "llm_table" / "llm_markdown_table_builder.py"
        default_input_dir = project_root / "backend" / "python-http-www-cfcpn-com-jcw" / "output" / "notices"
        default_output_dir = project_root / "backend" / "data" / "staging"
        default_config_path = project_root / "backend" / "config" / "llm_api_config.json"
        default_working_dir = project_root / "backend" / "llm_table"

        python_executable = self._resolve_path(
            os.getenv("LLM_PYTHON_EXECUTABLE"),
            project_root,
            Path(sys.executable),
        )
        script_path = self._resolve_path(os.getenv("LLM_SCRIPT_PATH"), project_root, default_script)
        working_dir = self._resolve_path(os.getenv("LLM_WORKING_DIR"), project_root, default_working_dir)
        input_dir = self._resolve_path(os.getenv("LLM_INPUT_DIR"), project_root, default_input_dir)
        output_dir = self._resolve_path(os.getenv("LLM_OUTPUT_DIR"), project_root, default_output_dir)
        config_path = self._resolve_path(os.getenv("LLM_CONFIG_PATH"), project_root, default_config_path)
        workers = os.getenv("LLM_WORKERS", "4")

        if not script_path.exists():
            raise JobStartError(f"LLM script not found: {script_path}")
        if not working_dir.exists():
            raise JobStartError(f"LLM working directory not found: {working_dir}")
        if not input_dir.exists():
            raise JobStartError(f"LLM input directory not found: {input_dir}")
        if not config_path.exists():
            raise JobStartError(f"LLM config file not found: {config_path}")
        self._validate_executable_job_paths("LLM", python_executable, script_path, working_dir)

        output_dir.mkdir(parents=True, exist_ok=True)
        command = [
            str(python_executable),
            "-u",
            str(script_path),
            "--input-dir",
            str(input_dir),
            "--output-dir",
            str(output_dir),
            "--llm-config",
            str(config_path),
            "--workers",
            workers,
        ]
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env.setdefault("PYTHONIOENCODING", "utf-8")
        return command, working_dir, env

    @staticmethod
    def _resolve_path(value: str | None, base_dir: Path, default: Path) -> Path:
        path = Path(value) if value else default
        if not path.is_absolute():
            path = base_dir / path
        return path.resolve()

    def _read_stream(self, job_id: str, stream_name: str, stream: Any) -> None:
        if stream is None:
            return
        for line in iter(stream.readline, ""):
            message = line.rstrip("\r\n")
            if stream_name == "stdout" and self._maybe_append_progress_event(job_id, message):
                continue
            self._append_event(
                job_id,
                {
                    "type": "log",
                    "job_id": job_id,
                    "stream": stream_name,
                    "message": message,
                    "timestamp": utc_now(),
                },
            )
        stream.close()

    @staticmethod
    def _validate_executable_job_paths(
        label: str,
        python_executable: Path,
        script_path: Path,
        working_dir: Path,
    ) -> None:
        if not python_executable.exists():
            raise JobStartError(f"{label} python executable not found")
        if not script_path.exists():
            raise JobStartError(f"{label} script not found")
        if not working_dir.exists():
            raise JobStartError(f"{label} working directory not found")
        if not working_dir.is_dir():
            raise JobStartError(f"{label} working directory is invalid")

    def _finish_job(
        self,
        job_id: str,
        *,
        status: str,
        exit_code: int | None,
        error: str | None,
    ) -> None:
        with self._condition:
            job = self._jobs[job_id]
            job.status = status
            job.finished_at = utc_now()
            job.exit_code = exit_code
            job.error = error
            if self._running_job_id == job_id:
                self._running_job_id = None
            if self._active_operation == job.job_type:
                self._active_operation = None
            event: dict[str, Any] = {
                "type": "done",
                "job_id": job_id,
                "status": status,
                "exit_code": exit_code,
                "timestamp": utc_now(),
            }
            if error:
                event["error"] = error
            self._append_event_locked(job_id, event)
            self._condition.notify_all()

    def _append_event(self, job_id: str, event: dict[str, Any]) -> None:
        with self._condition:
            self._append_event_locked(job_id, event)
            self._condition.notify_all()

    def _append_event_locked(self, job_id: str, event: dict[str, Any]) -> None:
        self._event_sequences[job_id] += 1
        stored_event = dict(event)
        stored_event["_seq"] = self._event_sequences[job_id]
        self._events[job_id].append(stored_event)
        if job_id in self._jobs:
            self._jobs[job_id].log_count = len(self._events[job_id])
            self._jobs[job_id].last_event_at = str(event.get("timestamp") or utc_now())

    @staticmethod
    def _public_event(event: dict[str, Any]) -> dict[str, Any]:
        public_event = {key: value for key, value in event.items() if not key.startswith("_")}
        if "_seq" in event:
            public_event["sequence"] = event["_seq"]
        return public_event

    def _maybe_append_progress_event(self, job_id: str, message: str) -> bool:
        prefix = "::progress::"
        if not message.startswith(prefix):
            return False

        try:
            payload = json.loads(message[len(prefix) :])
        except json.JSONDecodeError:
            return False

        event: dict[str, Any] = {
            "type": "progress",
            "job_id": job_id,
            "job_type": self._jobs[job_id].job_type,
            "stage": str(payload.get("stage") or "processing"),
            "message": str(payload.get("message") or "正在处理中"),
            "timestamp": utc_now(),
        }
        current = payload.get("current")
        total = payload.get("total")
        progress = payload.get("progress")
        if isinstance(current, int) and isinstance(total, int):
            event["current"] = current
            event["total"] = total
        if isinstance(progress, int):
            event["progress"] = max(0, min(100, progress))
        self._append_event(job_id, event)
        return True

    @staticmethod
    def _operation_label(operation_type: str) -> str:
        labels = {
            "scraper": "一键更新爬虫",
            "llm": "LLM 数据处理",
            "publish": "推送",
            "ai_analysis": "AI 情报分析",
        }
        return labels.get(operation_type, operation_type)

    def _conflict_message(self, operation_type: str) -> str:
        return f"当前正在运行{self._operation_label(operation_type)}，请等待任务完成。"


def format_sse(event: dict[str, Any]) -> str:
    public_event = JobManager._public_event(event)
    return f"data: {json.dumps(public_event, ensure_ascii=False)}\n\n"
