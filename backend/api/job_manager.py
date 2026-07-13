from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import uuid
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone, date, timedelta
from pathlib import Path
from typing import Any, Callable, Deque
from zoneinfo import ZoneInfo


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
        self._cancel_requested: set[str] = set()

    def start_scraper(self) -> Job:
        return self._start_job("scraper", self._build_scraper_command)

    def start_llm(self, *, mode: str = "incremental", overwrite: bool = False) -> Job:
        return self._start_job(
            "llm",
            lambda: self._build_llm_command(mode=mode, overwrite=overwrite),
        )

    def start_llm_external(self) -> Job:
        return self._start_job(
            "llm-external",
            lambda: self._build_llm_command(external=True),
        )

    def start_pipeline(self) -> Job:
        """Start the dual-notice pipeline and its conservative match stages."""
        with self._condition:
            if self._active_operation:
                raise JobConflictError(self._conflict_message(self._active_operation))

            job = Job(
                job_id=str(uuid.uuid4()),
                job_type="pipeline",
                status="running",
                created_at=utc_now(),
                started_at=utc_now(),
            )
            self._jobs[job.job_id] = job
            self._events[job.job_id] = deque(maxlen=MAX_LOG_LINES)
            self._event_sequences[job.job_id] = 0
            self._running_job_id = job.job_id
            self._active_operation = "pipeline"

        thread = threading.Thread(target=self._run_pipeline, args=(job.job_id,), daemon=True)
        thread.start()
        return job

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

        self._finish_job(job_id, status="cancelled", exit_code=None, error="管理员手动停止")
        return {"status": "cancelled", "pid": pid}

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

    def _run_pipeline(self, job_id: str) -> None:
        """Run scraper -> LLM -> AI analysis as a single pipeline job.

        The global ``_active_operation`` lock is already held (set to
        ``"pipeline"``).  We release it in *finally*.
        """
        from .ai_analysis import AiAnalysisError, _run_generate_ai_analysis  # local import

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
                    "job_type": "pipeline",
                    "message": "Pipeline 开始",
                    "timestamp": utc_now(),
                },
            )

            stages: list[tuple[str, str, Callable[[], tuple[list[str], Path, dict[str, str]]]]] = [
                ("procurement-scraper", "采购公告爬虫", lambda: self._build_scraper_command("procurement")),
                ("result-scraper", "结果公告爬虫", lambda: self._build_scraper_command("result")),
                ("procurement-llm", "采购公告 LLM 结构化", lambda: self._build_llm_command(notice_type="procurement")),
                ("result-llm", "结果公告 LLM 结构化", lambda: self._build_llm_command(notice_type="result")),
                ("rule-matching", "规则候选匹配", self._build_rule_matching_command),
                ("llm-matching", "LLM 双重复核匹配", self._build_llm_matching_command),
                ("project-merger", "匹配结果汇总", self._build_project_merger_command),
            ]
            for stage_label, stage_name, command_builder in stages:
                log(f"[{stage_label}] {stage_name}阶段开始")
                exit_code = self._execute_stage(job_id, command_builder, stage_label)
                if exit_code != 0:
                    log(f"[{stage_label}] 失败，退出码 {exit_code}，Pipeline 停止", "stderr")
                    self._finish_job(job_id, status="failed", exit_code=exit_code, error=f"{stage_name}失败")
                    return
                log(f"[{stage_label}] 完成")

            # Final stage: AI analysis
            analysis_enabled = os.getenv("PIPELINE_ANALYSIS_ENABLED", "true").strip().lower()
            if analysis_enabled in ("false", "0", "no", "off"):
                log("[analysis] skipped (PIPELINE_ANALYSIS_ENABLED=false)")
            else:
                log("[analysis] 阶段开始")
                try:
                    analysis_days_str = os.getenv("PIPELINE_ANALYSIS_DAYS", "30")
                    try:
                        analysis_days = max(1, int(analysis_days_str))
                    except ValueError:
                        analysis_days = 30
                    _run_generate_ai_analysis(days=analysis_days)
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
            self._finish_job(job_id, status="failed", exit_code=None, error=str(exc))

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

    def _get_scraper_lookback_info(self) -> tuple[int, str]:
        import logging
        raw_lookback = os.getenv("SCRAPER_LOOKBACK_DAYS", "20")
        lookback_days = 20
        try:
            val = int(raw_lookback)
            if 1 <= val <= 365:
                lookback_days = val
            else:
                logging.warning(
                    f"SCRAPER_LOOKBACK_DAYS value {raw_lookback} out of range [1, 365]. Falling back to default 20."
                )
        except ValueError:
            logging.warning(
                f"SCRAPER_LOOKBACK_DAYS value {raw_lookback} is not a valid integer. Falling back to default 20."
            )

        timezone_name = os.getenv("SCHEDULER_TIMEZONE", "Asia/Shanghai")
        today = datetime.now(ZoneInfo(timezone_name)).date()
        since_date = today - timedelta(days=lookback_days)
        return lookback_days, since_date.isoformat()

    def _build_scraper_command(self, notice_type: str = "procurement") -> tuple[list[str], Path, dict[str, str]]:
        if notice_type not in {"procurement", "result"}:
            raise JobStartError(f"Unsupported scraper notice type: {notice_type}")
        project_root = Path(__file__).resolve().parents[2]
        scraper_root = project_root / "backend" / "python-http-www-cfcpn-com-jcw"
        default_script = scraper_root / "cfcpn_scraper.py"

        configured_python = os.getenv("SCRAPER_PYTHON_EXECUTABLE")
        python_executable = (
            self._resolve_path(configured_python, project_root, Path(sys.executable))
            if configured_python
            else Path(sys.executable)
        )
        script_path = self._resolve_path(os.getenv("SCRAPER_SCRIPT_PATH"), project_root, default_script)
        working_dir = self._resolve_path(os.getenv("SCRAPER_WORKING_DIR"), project_root, scraper_root)

        self._validate_executable_job_paths("Scraper", python_executable, script_path, working_dir)

        lookback_days, since_date = self._get_scraper_lookback_info()

        command = [
            str(python_executable),
            "-u",
            str(script_path),
            "--keyword",
            "\u8bc1\u5238",
            "--notice-type",
            notice_type,
            "--update",
            "--output-dir",
            "output",
            "--resume",
            "--since-date",
            since_date,
        ]
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env.setdefault("PYTHONIOENCODING", "utf-8")
        return command, working_dir, env

    def _build_llm_command(
        self,
        *,
        mode: str = "incremental",
        overwrite: bool = False,
        external: bool = False,
        notice_type: str = "procurement",
    ) -> tuple[list[str], Path, dict[str, str]]:
        if notice_type not in {"procurement", "result"}:
            raise JobStartError(f"Unsupported LLM notice type: {notice_type}")
        if external and notice_type != "procurement":
            raise JobStartError("External LLM imports only support procurement notices")
        project_root = Path(__file__).resolve().parents[2]
        default_script = project_root / "backend" / "llm_table" / "llm_markdown_table_builder.py"
        default_input_dir = project_root / "backend" / "python-http-www-cfcpn-com-jcw" / "output" / "notices"
        default_result_input_dir = project_root / "backend" / "python-http-www-cfcpn-com-jcw" / "output" / "result" / "notices"
        default_external_input_dir = (
            project_root / "backend" / "python-http-www-cfcpn-com-jcw" / "output" / "external" / "notices"
        )
        default_external_state_path = (
            project_root / "backend" / "python-http-www-cfcpn-com-jcw" / "output" / "checkpoints" / "external_llm.json"
        )
        default_output_dir = project_root / "backend" / "data" / "staging"
        default_result_output_dir = default_output_dir / "result"
        default_config_path = project_root / "backend" / "config" / "llm_api_config.json"
        default_working_dir = project_root / "backend" / "llm_table"

        configured_python = os.getenv("LLM_PYTHON_EXECUTABLE")
        python_executable = (
            self._resolve_path(configured_python, project_root, Path(sys.executable))
            if configured_python
            else Path(sys.executable)
        )
        script_path = self._resolve_path(os.getenv("LLM_SCRIPT_PATH"), project_root, default_script)
        working_dir = self._resolve_path(os.getenv("LLM_WORKING_DIR"), project_root, default_working_dir)
        input_env = (
            os.getenv("LLM_EXTERNAL_INPUT_DIR")
            if external
            else os.getenv("LLM_RESULT_INPUT_DIR") if notice_type == "result" else os.getenv("LLM_INPUT_DIR")
        )
        input_dir = self._resolve_path(
            input_env,
            project_root,
            default_external_input_dir if external else default_result_input_dir if notice_type == "result" else default_input_dir,
        )
        output_env = os.getenv("LLM_RESULT_OUTPUT_DIR") if notice_type == "result" else os.getenv("LLM_OUTPUT_DIR")
        output_dir = self._resolve_path(output_env, project_root, default_result_output_dir if notice_type == "result" else default_output_dir)
        config_path = self._resolve_path(os.getenv("LLM_CONFIG_PATH"), project_root, default_config_path)
        workers = os.getenv("LLM_WORKERS", "4")

        if not script_path.exists():
            raise JobStartError(f"LLM script not found: {script_path}")
        if not working_dir.exists():
            raise JobStartError(f"LLM working directory not found: {working_dir}")
        if external:
            input_dir.mkdir(parents=True, exist_ok=True)
        elif not input_dir.exists():
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
            "--notice-type",
            notice_type,
            "--output-dir",
            str(output_dir),
            "--llm-config",
            str(config_path),
            "--workers",
            workers,
        ]
        if mode == "full_refresh" and overwrite:
            command.extend(["--full-refresh", "--overwrite"])
        if external:
            state_path = self._resolve_path(
                os.getenv("LLM_EXTERNAL_STATE_PATH"),
                project_root,
                default_external_state_path,
            )
            state_path.parent.mkdir(parents=True, exist_ok=True)
            command.extend(
                [
                    "--allow-empty",
                    "--require-title-heading",
                    "--processed-sha256-state",
                    str(state_path),
                ]
            )
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env.setdefault("PYTHONIOENCODING", "utf-8")
        return command, working_dir, env

    def _build_rule_matching_command(self) -> tuple[list[str], Path, dict[str, str]]:
        project_root = Path(__file__).resolve().parents[2]
        procurement_csv = self._resolve_path(os.getenv("LLM_OUTPUT_DIR"), project_root, project_root / "backend" / "data" / "staging") / "announcement_table.csv"
        result_csv = self._resolve_path(os.getenv("LLM_RESULT_OUTPUT_DIR"), project_root, project_root / "backend" / "data" / "staging" / "result") / "result_table.csv"
        output_dir = self._resolve_path(os.getenv("MATCHING_OUTPUT_DIR"), project_root, project_root / "backend" / "data" / "staging" / "matching")
        max_candidates = os.getenv("MATCHING_MAX_CANDIDATES", "5")
        return self._build_matching_module_command(
            "backend.matching.project_matcher",
            ["--procurement-csv", str(procurement_csv), "--result-csv", str(result_csv), "--output-dir", str(output_dir), "--max-candidates", max_candidates],
        )

    def _build_llm_matching_command(self) -> tuple[list[str], Path, dict[str, str]]:
        project_root = Path(__file__).resolve().parents[2]
        procurement_csv = self._resolve_path(os.getenv("LLM_OUTPUT_DIR"), project_root, project_root / "backend" / "data" / "staging") / "announcement_table.csv"
        result_csv = self._resolve_path(os.getenv("LLM_RESULT_OUTPUT_DIR"), project_root, project_root / "backend" / "data" / "staging" / "result") / "result_table.csv"
        matching_dir = self._resolve_path(os.getenv("MATCHING_OUTPUT_DIR"), project_root, project_root / "backend" / "data" / "staging" / "matching")
        output_dir = self._resolve_path(os.getenv("LLM_MATCHING_OUTPUT_DIR"), project_root, project_root / "backend" / "data" / "staging" / "llm_matching")
        config_path = self._resolve_path(os.getenv("LLM_CONFIG_PATH"), project_root, project_root / "backend" / "config" / "llm_api_config.json")
        workers = os.getenv("LLM_MATCHING_WORKERS", os.getenv("LLM_WORKERS", "4"))
        max_candidates = os.getenv("MATCHING_MAX_CANDIDATES", "5")
        return self._build_matching_module_command(
            "backend.matching.llm_matcher",
            ["--procurement-csv", str(procurement_csv), "--result-csv", str(result_csv), "--links-csv", str(matching_dir / "project_links.csv"), "--candidate-scores-csv", str(matching_dir / "candidate_scores.csv"), "--output-dir", str(output_dir), "--llm-config", str(config_path), "--workers", workers, "--max-candidates", max_candidates],
        )

    def _build_project_merger_command(self) -> tuple[list[str], Path, dict[str, str]]:
        project_root = Path(__file__).resolve().parents[2]
        procurement_csv = self._resolve_path(os.getenv("LLM_OUTPUT_DIR"), project_root, project_root / "backend" / "data" / "staging") / "announcement_table.csv"
        result_csv = self._resolve_path(os.getenv("LLM_RESULT_OUTPUT_DIR"), project_root, project_root / "backend" / "data" / "staging" / "result") / "result_table.csv"
        matching_dir = self._resolve_path(os.getenv("LLM_MATCHING_OUTPUT_DIR"), project_root, project_root / "backend" / "data" / "staging" / "llm_matching")
        output_dir = self._resolve_path(os.getenv("MATCHING_MERGED_OUTPUT_DIR"), project_root, project_root / "backend" / "data" / "staging" / "final")
        return self._build_matching_module_command(
            "backend.matching.project_merger",
            ["--procurement-csv", str(procurement_csv), "--result-csv", str(result_csv), "--verified-links-csv", str(matching_dir / "llm_verified_links.csv"), "--output-dir", str(output_dir)],
        )

    @staticmethod
    def _build_matching_module_command(module: str, arguments: list[str]) -> tuple[list[str], Path, dict[str, str]]:
        project_root = Path(__file__).resolve().parents[2]
        python_executable = Path(sys.executable)
        if not python_executable.exists():
            raise JobStartError("Python executable not found for matching stage")
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env.setdefault("PYTHONIOENCODING", "utf-8")
        return [str(python_executable), "-u", "-m", module, *arguments], project_root, env

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
        }
        return labels.get(operation_type, operation_type)

    def _conflict_message(self, operation_type: str) -> str:
        return f"当前正在运行{self._operation_label(operation_type)}，请等待任务完成。"


def format_sse(event: dict[str, Any]) -> str:
    public_event = JobManager._public_event(event)
    return f"data: {json.dumps(public_event, ensure_ascii=False)}\n\n"
