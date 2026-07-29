from __future__ import annotations

import json
import os
import subprocess
import threading
import uuid
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Deque

from .config import settings
from .job_commands import JobCommandFactory, JobStartError


MAX_LOG_LINES = 500


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
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


class JobManager(JobCommandFactory):
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._jobs: dict[str, Job] = {}
        self._events: dict[str, Deque[dict[str, Any]]] = {}
        self._event_sequences: dict[str, int] = {}
        self._running_job_id: str | None = None
        self._active_operation: str | None = None
        self._processes: dict[str, subprocess.Popen[str]] = {}
        self._cancel_requested: set[str] = set()
        self._history_limit = settings.job_history_limit

    def start_scraper(self) -> Job:
        return self._start_staged_job("scraper")

    def start_llm(self, *, mode: str = "incremental", overwrite: bool = False) -> Job:
        return self._start_staged_job("llm", llm_mode=mode, llm_overwrite=overwrite)

    def start_llm_external(self) -> Job:
        return self._start_job(
            "llm-external",
            lambda: self._build_llm_command(external=True),
        )

    def start_pipeline(self) -> Job:
        """Start the dual-notice pipeline and its conservative match stages."""
        return self._start_staged_job("pipeline")

    def start_app_watch(self) -> Job:
        """Crawl broker App pages and run the LLM structuring export."""
        return self._start_job("app-watch", self._build_app_watch_command)

    def _start_staged_job(
        self,
        job_type: str,
        *,
        llm_mode: str = "incremental",
        llm_overwrite: bool = False,
    ) -> Job:
        with self._condition:
            if self._active_operation:
                raise JobConflictError(self._conflict_message(self._active_operation))
            self._prune_history_locked()

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

        thread = threading.Thread(
            target=self._run_staged_job,
            args=(job.job_id, llm_mode, llm_overwrite),
            daemon=True,
        )
        thread.start()
        return job

    def acquire_operation(self, operation_type: str) -> None:
        with self._condition:
            if self._active_operation:
                raise JobConflictError(self._conflict_message(self._active_operation))
            self._prune_history_locked()
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
            self._prune_history_locked()

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

    def _prune_history_locked(self) -> None:
        while len(self._jobs) >= self._history_limit:
            removable_id = next(
                (
                    job_id
                    for job_id, job in self._jobs.items()
                    if job.status in {"succeeded", "failed", "cancelled"}
                    and job_id != self._running_job_id
                ),
                None,
            )
            if removable_id is None:
                return
            self._jobs.pop(removable_id, None)
            self._events.pop(removable_id, None)
            self._event_sequences.pop(removable_id, None)
            self._processes.pop(removable_id, None)
            self._cancel_requested.discard(removable_id)

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
            finished = self._jobs[job_id].status in {"succeeded", "failed", "cancelled"}
            sequence = self._event_sequences.get(job_id, 0)
            return events, finished, sequence

    def wait_for_event_sequence(self, job_id: str, current_sequence: int, timeout: float) -> int:
        with self._condition:
            if job_id not in self._jobs:
                raise JobNotFoundError(job_id)
            self._condition.wait_for(
                lambda: self._event_sequences.get(job_id, 0) > current_sequence
                or self._jobs[job_id].status in {"succeeded", "failed", "cancelled"},
                timeout=timeout,
            )
            return self._event_sequences.get(job_id, 0)

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        """Request cancellation of a running job by terminating its subprocess."""
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise JobNotFoundError(job_id)
            if job.status not in {"running", "pending"}:
                return {"status": job.status, "message": "job already finished"}
            self._cancel_requested.add(job_id)
            process = self._processes.get(job_id)
            pid = process.pid if process else job.pid

        self._append_event(
            job_id,
            {
                "type": "log",
                "job_id": job_id,
                "stream": "stderr",
                "message": "管理员手动停止任务",
                "timestamp": utc_now(),
            },
        )

        if process and process.poll() is None:
            self._terminate_process_tree(process)
            return {"status": "cancelling", "pid": pid}

        if job.job_type == "pipeline":
            return {"status": "cancelling", "pid": pid}

        self._finish_job(job_id, status="cancelled", exit_code=None, error="管理员手动停止")
        return {"status": "cancelled", "pid": pid}

    def _is_cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._cancel_requested

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

            if job_type == "scraper":
                lookback_days, since_date = self._get_scraper_lookback_info()
                self._append_event(
                    job_id,
                    {
                        "type": "log",
                        "job_id": job_id,
                        "stream": "stdout",
                        "message": f"爬虫回溯天数：{lookback_days}",
                        "timestamp": utc_now(),
                    },
                )
                self._append_event(
                    job_id,
                    {
                        "type": "log",
                        "job_id": job_id,
                        "stream": "stdout",
                        "message": f"爬虫起始日期：{since_date}",
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

            with self._lock:
                cancelled = job_id in self._cancel_requested
            if cancelled:
                self._finish_job(job_id, status="cancelled", exit_code=exit_code, error="管理员手动停止")
            else:
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
                self._cancel_requested.discard(job_id)
                if job_id in self._jobs:
                    self._jobs[job_id].process_alive = False

    # ------------------------------------------------------------------
    # Pipeline
    # ------------------------------------------------------------------

    def _run_staged_job(self, job_id: str, llm_mode: str, llm_overwrite: bool) -> None:
        """Run a scraper, LLM/matching, or complete Pipeline staged job.

        The global ``_active_operation`` lock is already held.  We release it
        in *finally*.
        """
        with self._lock:
            job_type = self._jobs[job_id].job_type
        is_pipeline = job_type == "pipeline"

        def log(message: str, stream: str = "stdout") -> None:
            self._append_event(
                job_id,
                {
                    "type": "log",
                    "job_id": job_id,
                    "stream": stream,
                    "message": message,
                    "timestamp": utc_now(),
                },
            )

        try:
            self._append_event(
                job_id,
                {
                    "type": "start",
                    "job_id": job_id,
                    "job_type": job_type,
                    "message": (
                        "Pipeline 开始"
                        if is_pipeline
                        else "LLM 数据处理与匹配开始"
                        if job_type == "llm"
                        else "双公告爬虫开始"
                    ),
                    "timestamp": utc_now(),
                },
            )

            stages: list[tuple[str, str, Callable[[], tuple[list[str], Path, dict[str, str]]]]] = []
            if job_type in {"scraper", "pipeline"}:
                stages.extend([
                    ("procurement-scraper", "采购公告爬虫", lambda: self._build_scraper_command("procurement")),
                    ("result-scraper", "结果公告爬虫", lambda: self._build_scraper_command("result")),
                ])
            if job_type in {"llm", "pipeline"}:
                stages.extend([
                    ("procurement-llm", "采购公告 LLM 结构化", lambda: self._build_llm_command(mode=llm_mode, overwrite=llm_overwrite, notice_type="procurement")),
                    ("result-llm", "结果公告 LLM 结构化", lambda: self._build_llm_command(mode=llm_mode, overwrite=llm_overwrite, notice_type="result")),
                    ("rule-matching", "规则候选匹配", self._build_rule_matching_command),
                    ("llm-matching", "LLM 双重复核匹配", self._build_llm_matching_command),
                    ("project-merger", "匹配结果汇总", self._build_project_merger_command),
                ])
            for stage_label, stage_name, command_builder in stages:
                if self._is_cancel_requested(job_id):
                    log(f"[{stage_label}] 已收到取消请求，任务停止")
                    self._finish_job(job_id, status="cancelled", exit_code=None, error="管理员手动停止")
                    return
                log(f"[{stage_label}] {stage_name}阶段开始")
                exit_code = self._execute_stage(job_id, command_builder, stage_label)
                if self._is_cancel_requested(job_id):
                    log(f"[{stage_label}] 已取消，任务停止")
                    self._finish_job(job_id, status="cancelled", exit_code=exit_code, error="管理员手动停止")
                    return
                if exit_code != 0:
                    log(f"[{stage_label}] 失败，退出码 {exit_code}，任务停止", "stderr")
                    self._finish_job(job_id, status="failed", exit_code=exit_code, error=f"{stage_name}失败")
                    return
                log(f"[{stage_label}] 完成")

            if not is_pipeline:
                self._finish_job(job_id, status="succeeded", exit_code=0, error=None)
                return

            # Final stage: AI analysis
            if self._is_cancel_requested(job_id):
                log("[analysis] 已收到取消请求，Pipeline 停止")
                self._finish_job(job_id, status="cancelled", exit_code=None, error="管理员手动停止")
                return
            analysis_enabled = os.getenv("PIPELINE_ANALYSIS_ENABLED", "true").strip().lower()
            if analysis_enabled in ("false", "0", "no", "off"):
                log("[analysis] skipped (PIPELINE_ANALYSIS_ENABLED=false)")
            else:
                from .ai_analysis import AiAnalysisError, _run_generate_ai_analysis  # local import

                log("[analysis] 阶段开始")
                try:
                    analysis_days_str = os.getenv("PIPELINE_ANALYSIS_DAYS", "30")
                    try:
                        analysis_days = max(1, int(analysis_days_str))
                    except ValueError:
                        analysis_days = 30
                    _run_generate_ai_analysis(days=analysis_days)
                    if self._is_cancel_requested(job_id):
                        log("[analysis] 已取消")
                        self._finish_job(job_id, status="cancelled", exit_code=None, error="管理员手动停止")
                        return
                    log("[analysis] 完成")
                except AiAnalysisError as exc:
                    log(f"[analysis] 失败: {exc.detail}", "stderr")
                    self._finish_job(job_id, status="failed", exit_code=None, error=f"analysis 失败: {exc.detail}")
                    return
                except Exception as exc:
                    log(f"[analysis] 失败: {exc}", "stderr")
                    self._finish_job(job_id, status="failed", exit_code=None, error=f"analysis 异常: {exc}")
                    return

            self._finish_job(job_id, status="succeeded", exit_code=0, error=None)

        except Exception as exc:
            if self._is_cancel_requested(job_id):
                self._finish_job(job_id, status="cancelled", exit_code=None, error="管理员手动停止")
            else:
                self._finish_job(job_id, status="failed", exit_code=None, error=str(exc))
        finally:
            with self._lock:
                self._cancel_requested.discard(job_id)

    def _execute_stage(
        self,
        job_id: str,
        command_builder: Callable[[], tuple[list[str], Path, dict[str, str]]],
        stage_label: str,
    ) -> int:
        """Run one subprocess stage inside the pipeline job.

        Streams stdout/stderr prefixed with ``[stage_label]`` into the
        pipeline job's event log.  Returns the process exit code.
        """
        process: subprocess.Popen[str] | None = None
        try:
            command, cwd, env = command_builder()

            if stage_label.endswith("scraper"):
                lookback_days, since_date = self._get_scraper_lookback_info()
                self._append_event(
                    job_id,
                    {
                        "type": "log",
                        "job_id": job_id,
                        "stream": "stdout",
                        "message": f"[{stage_label}] 爬虫回溯天数：{lookback_days}",
                        "timestamp": utc_now(),
                    },
                )
                self._append_event(
                    job_id,
                    {
                        "type": "log",
                        "job_id": job_id,
                        "stream": "stdout",
                        "message": f"[{stage_label}] 爬虫起始日期：{since_date}",
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

            def _prefix_stream(stream: Any, stream_name: str) -> None:
                if stream is None:
                    return
                for raw_line in iter(stream.readline, ""):
                    line = raw_line.rstrip("\r\n")
                    self._append_event(
                        job_id,
                        {
                            "type": "log",
                            "job_id": job_id,
                            "stream": stream_name,
                            "message": f"[{stage_label}] {line}",
                            "timestamp": utc_now(),
                        },
                    )
                stream.close()

            readers = [
                threading.Thread(target=_prefix_stream, args=(process.stdout, "stdout"), daemon=True),
                threading.Thread(target=_prefix_stream, args=(process.stderr, "stderr"), daemon=True),
            ]
            for r in readers:
                r.start()

            exit_code = process.wait()
            for r in readers:
                r.join(timeout=2)

            return exit_code
        except Exception as exc:
            if process and process.poll() is None:
                try:
                    process.terminate()
                    process.wait(timeout=5)
                except OSError:
                    pass
            raise
        finally:
            with self._lock:
                self._processes.pop(job_id, None)
                if job_id in self._jobs:
                    self._jobs[job_id].process_alive = False

    # ------------------------------------------------------------------
    # Termination
    # ------------------------------------------------------------------

    def _terminate_process_tree(self, process: subprocess.Popen[str]) -> None:
        if os.name == "nt":
            try:
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
            except OSError:
                try:
                    process.terminate()
                except OSError:
                    pass
            return

        try:
            process.terminate()
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                process.kill()
            except OSError:
                pass
        except OSError:
            pass

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
            if job.status in {"succeeded", "failed", "cancelled"}:
                return
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
            "llm-external": "外来公告导入",
            "pipeline": "自动化 Pipeline",
            "publish": "推送",
            "ai_analysis": "AI 情报分析",
            "app-watch": "券商App更新",
        }
        return labels.get(operation_type, operation_type)

    def _conflict_message(self, operation_type: str) -> str:
        return f"当前正在运行{self._operation_label(operation_type)}，请等待任务完成。"


def format_sse(event: dict[str, Any]) -> str:
    public_event = JobManager._public_event(event)
    return f"data: {json.dumps(public_event, ensure_ascii=False)}\n\n"
