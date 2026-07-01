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

    def start_scraper(self) -> Job:
        return self._start_job("scraper", self._build_scraper_command)

    def start_llm(self) -> Job:
        return self._start_job("llm", self._build_llm_command)

    def _start_job(self, job_type: str, command_builder: Any) -> Job:
        with self._condition:
            if self._running_job_id:
                running_job = self._jobs[self._running_job_id]
                raise JobConflictError(f"{running_job.job_type} job is already running")

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

        thread = threading.Thread(target=self._run_job, args=(job.job_id, command_builder), daemon=True)
        thread.start()
        return job

    def get_job(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise JobNotFoundError(job_id)
            return Job(**job.to_dict())

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
                process.wait(timeout=5)
            self._finish_job(job_id, status="failed", exit_code=None, error=str(exc))

    def _build_scraper_command(self) -> tuple[list[str], Path, dict[str, str]]:
        project_root = Path(__file__).resolve().parents[2]
        scraper_root = project_root / "backend" / "python-http-www-cfcpn-com-jcw"
        default_script = scraper_root / "cfcpn_scraper.py"

        default_python = scraper_root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        python_executable = Path(
            os.getenv("SCRAPER_PYTHON_EXECUTABLE") or (str(default_python) if default_python.exists() else sys.executable)
        )
        script_path = Path(os.getenv("SCRAPER_SCRIPT_PATH") or default_script)
        working_dir = Path(os.getenv("SCRAPER_WORKING_DIR") or scraper_root)

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
        default_output_dir = project_root / "backend" / "data"
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
            self._append_event(
                job_id,
                {
                    "type": "log",
                    "job_id": job_id,
                    "stream": stream_name,
                    "message": line.rstrip("\r\n"),
                    "timestamp": utc_now(),
                },
            )
        stream.close()

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


def format_sse(event: dict[str, Any]) -> str:
    public_event = {key: value for key, value in event.items() if not key.startswith("_")}
    return f"data: {json.dumps(public_event, ensure_ascii=False)}\n\n"
