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


class JobManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._jobs: dict[str, Job] = {}
        self._events: dict[str, Deque[dict[str, Any]]] = {}
        self._running_scraper_job_id: str | None = None

    def start_scraper(self) -> Job:
        with self._condition:
            if self._running_scraper_job_id:
                raise JobConflictError("scraper job is already running")

            job = Job(
                job_id=str(uuid.uuid4()),
                job_type="scraper",
                status="pending",
                created_at=utc_now(),
            )
            self._jobs[job.job_id] = job
            self._events[job.job_id] = deque(maxlen=MAX_LOG_LINES)
            self._running_scraper_job_id = job.job_id

        thread = threading.Thread(target=self._run_scraper, args=(job.job_id,), daemon=True)
        thread.start()
        return job

    def get_job(self, job_id: str) -> Job:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise JobNotFoundError(job_id)
            return Job(**job.to_dict())

    def snapshot_events(self, job_id: str) -> tuple[list[dict[str, Any]], bool]:
        with self._lock:
            if job_id not in self._jobs:
                raise JobNotFoundError(job_id)
            events = list(self._events.get(job_id, ()))
            finished = self._jobs[job_id].status in {"succeeded", "failed"}
            return events, finished

    def wait_for_event_count(self, job_id: str, current_count: int, timeout: float) -> int:
        with self._condition:
            if job_id not in self._jobs:
                raise JobNotFoundError(job_id)
            self._condition.wait_for(
                lambda: len(self._events.get(job_id, ())) > current_count
                or self._jobs[job_id].status in {"succeeded", "failed"},
                timeout=timeout,
            )
            return len(self._events.get(job_id, ()))

    def _run_scraper(self, job_id: str) -> None:
        process: subprocess.Popen[str] | None = None
        try:
            command, cwd, env = self._build_scraper_command()
            self._mark_started(job_id)
            self._append_event(
                job_id,
                {
                    "type": "start",
                    "job_id": job_id,
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

    def _mark_started(self, job_id: str) -> None:
        with self._condition:
            job = self._jobs[job_id]
            job.status = "running"
            job.started_at = utc_now()
            self._condition.notify_all()

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
            if self._running_scraper_job_id == job_id:
                self._running_scraper_job_id = None
            event: dict[str, Any] = {
                "type": "done",
                "job_id": job_id,
                "status": status,
                "exit_code": exit_code,
                "timestamp": utc_now(),
            }
            if error:
                event["error"] = error
            self._events[job_id].append(event)
            self._condition.notify_all()

    def _append_event(self, job_id: str, event: dict[str, Any]) -> None:
        with self._condition:
            self._events[job_id].append(event)
            self._condition.notify_all()


def format_sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
