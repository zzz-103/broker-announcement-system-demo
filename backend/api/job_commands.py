from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import PROJECT_ROOT, resolve_project_path


class JobStartError(RuntimeError):
    pass


CommandSpec = tuple[list[str], Path, dict[str, str]]


class JobCommandFactory:
    """Build trusted subprocess commands from centralized environment settings."""

    @staticmethod
    def _job_env() -> dict[str, str]:
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env.setdefault("PYTHONIOENCODING", "utf-8")
        return env

    @staticmethod
    def _resolve_path(value: str | None, base_dir: Path, default: Path) -> Path:
        path = Path(value) if value else default
        if not path.is_absolute():
            path = base_dir / path
        return path.resolve()

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

    @staticmethod
    def _get_scraper_lookback_info() -> tuple[int, str]:
        raw_lookback = os.getenv("SCRAPER_LOOKBACK_DAYS", "20")
        try:
            lookback_days = int(raw_lookback)
            if not 1 <= lookback_days <= 365:
                raise ValueError
        except ValueError:
            logging.warning("Invalid SCRAPER_LOOKBACK_DAYS; using 20.")
            lookback_days = 20
        timezone_name = os.getenv("SCHEDULER_TIMEZONE", "Asia/Shanghai")
        try:
            today = datetime.now(ZoneInfo(timezone_name)).date()
        except Exception:  # noqa: BLE001 - invalid configuration fallback
            logging.warning("Invalid SCHEDULER_TIMEZONE; using Asia/Shanghai.")
            today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
        return lookback_days, (today - timedelta(days=lookback_days)).isoformat()

    def _build_scraper_command(self, notice_type: str = "procurement") -> CommandSpec:
        if notice_type not in {"procurement", "result"}:
            raise JobStartError(f"Unsupported scraper notice type: {notice_type}")
        scraper_root = PROJECT_ROOT / "backend" / "python-http-www-cfcpn-com-jcw"
        python_executable = self._resolve_path(
            os.getenv("SCRAPER_PYTHON_EXECUTABLE"),
            PROJECT_ROOT,
            Path(sys.executable),
        )
        script_path = resolve_project_path(
            os.getenv("SCRAPER_SCRIPT_PATH"),
            scraper_root / "cfcpn_scraper.py",
        )
        working_dir = resolve_project_path(
            os.getenv("SCRAPER_WORKING_DIR"),
            scraper_root,
        )
        self._validate_executable_job_paths(
            "Scraper", python_executable, script_path, working_dir
        )
        _, since_date = self._get_scraper_lookback_info()
        command = [
            str(python_executable),
            "-u",
            str(script_path),
            "--keyword",
            "证券",
            "--notice-type",
            notice_type,
            "--update",
            "--output-dir",
            "output",
            "--resume",
            "--since-date",
            since_date,
        ]
        return command, working_dir, self._job_env()

    def _build_app_watch_command(self) -> CommandSpec:
        working_default = PROJECT_ROOT / "broker-app-watch"
        venv_python = (
            working_default
            / ".venv"
            / ("Scripts" if os.name == "nt" else "bin")
            / ("python.exe" if os.name == "nt" else "python")
        )
        python_executable = resolve_project_path(
            os.getenv("APP_WATCH_PYTHON_EXECUTABLE"),
            venv_python,
        )
        working_dir = resolve_project_path(
            os.getenv("APP_WATCH_WORKING_DIR"),
            working_default,
        )
        config_path = resolve_project_path(
            os.getenv("APP_WATCH_LLM_CONFIG_PATH") or os.getenv("LLM_CONFIG_PATH"),
            PROJECT_ROOT / "backend" / "config" / "llm_api_config.json",
        )
        export_path = resolve_project_path(
            os.getenv("APP_RELEASES_CSV_PATH"),
            working_default / "data" / "exports" / "app_releases.csv",
        )
        if not python_executable.exists():
            raise JobStartError("App-watch python executable not found")
        if not working_dir.is_dir():
            raise JobStartError("App-watch working directory not found")
        if not config_path.exists():
            raise JobStartError("App-watch LLM config file not found")
        export_path.parent.mkdir(parents=True, exist_ok=True)
        env = self._job_env()
        env["PYTHONPATH"] = os.pathsep.join(
            part
            for part in (
                str(working_dir / "src"),
                str(PROJECT_ROOT),
                env.get("PYTHONPATH", ""),
            )
            if part
        )
        command = [
            str(python_executable),
            "-u",
            "-m",
            "broker_app_watch.cli",
            "refresh",
            "--all",
            "--llm-config",
            str(config_path),
            "--export-path",
            str(export_path),
        ]
        return command, working_dir, env

    def _build_llm_command(
        self,
        *,
        mode: str = "incremental",
        overwrite: bool = False,
        external: bool = False,
        notice_type: str = "procurement",
    ) -> CommandSpec:
        if notice_type not in {"procurement", "result"}:
            raise JobStartError(f"Unsupported LLM notice type: {notice_type}")
        if external and notice_type != "procurement":
            raise JobStartError("External LLM imports only support procurement notices")
        scraper_output = (
            PROJECT_ROOT / "backend" / "python-http-www-cfcpn-com-jcw" / "output"
        )
        staging = PROJECT_ROOT / "backend" / "data" / "staging"
        python_executable = resolve_project_path(
            os.getenv("LLM_PYTHON_EXECUTABLE"),
            Path(sys.executable),
        )
        script_path = resolve_project_path(
            os.getenv("LLM_SCRIPT_PATH"),
            PROJECT_ROOT / "backend" / "llm_table" / "llm_markdown_table_builder.py",
        )
        working_dir = resolve_project_path(
            os.getenv("LLM_WORKING_DIR"),
            PROJECT_ROOT / "backend" / "llm_table",
        )
        input_env = (
            os.getenv("LLM_EXTERNAL_INPUT_DIR")
            if external
            else os.getenv("LLM_RESULT_INPUT_DIR")
            if notice_type == "result"
            else os.getenv("LLM_INPUT_DIR")
        )
        input_default = (
            scraper_output / "external" / "notices"
            if external
            else scraper_output / "result" / "notices"
            if notice_type == "result"
            else scraper_output / "notices"
        )
        input_dir = resolve_project_path(input_env, input_default)
        output_dir = resolve_project_path(
            os.getenv("LLM_RESULT_OUTPUT_DIR")
            if notice_type == "result"
            else os.getenv("LLM_OUTPUT_DIR"),
            staging / "result" if notice_type == "result" else staging,
        )
        config_path = resolve_project_path(
            os.getenv("LLM_CONFIG_PATH"),
            PROJECT_ROOT / "backend" / "config" / "llm_api_config.json",
        )
        if external:
            input_dir.mkdir(parents=True, exist_ok=True)
        self._validate_executable_job_paths(
            "LLM", python_executable, script_path, working_dir
        )
        if not input_dir.exists():
            raise JobStartError("LLM input directory not found")
        if not config_path.exists():
            raise JobStartError("LLM config file not found")
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
            os.getenv("LLM_WORKERS", "4"),
        ]
        if mode == "full_refresh" and overwrite:
            command.extend(["--full-refresh", "--overwrite"])
        if external:
            state_path = resolve_project_path(
                os.getenv("LLM_EXTERNAL_STATE_PATH"),
                scraper_output / "checkpoints" / "external_llm.json",
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
        return command, working_dir, self._job_env()

    def _staging_path(self, env_name: str, default: Path, filename: str) -> Path:
        return resolve_project_path(os.getenv(env_name), default) / filename

    def _build_rule_matching_command(self) -> CommandSpec:
        staging = PROJECT_ROOT / "backend" / "data" / "staging"
        return self._build_matching_module_command(
            "backend.matching.project_matcher",
            [
                "--procurement-csv",
                str(self._staging_path("LLM_OUTPUT_DIR", staging, "announcement_table.csv")),
                "--result-csv",
                str(self._staging_path("LLM_RESULT_OUTPUT_DIR", staging / "result", "result_table.csv")),
                "--output-dir",
                str(resolve_project_path(os.getenv("MATCHING_OUTPUT_DIR"), staging / "matching")),
                "--max-candidates",
                os.getenv("MATCHING_MAX_CANDIDATES", "5"),
            ],
        )

    def _build_llm_matching_command(self) -> CommandSpec:
        staging = PROJECT_ROOT / "backend" / "data" / "staging"
        matching = resolve_project_path(os.getenv("MATCHING_OUTPUT_DIR"), staging / "matching")
        output = resolve_project_path(
            os.getenv("LLM_MATCHING_OUTPUT_DIR"), staging / "llm_matching"
        )
        return self._build_matching_module_command(
            "backend.matching.llm_matcher",
            [
                "--procurement-csv",
                str(self._staging_path("LLM_OUTPUT_DIR", staging, "announcement_table.csv")),
                "--result-csv",
                str(self._staging_path("LLM_RESULT_OUTPUT_DIR", staging / "result", "result_table.csv")),
                "--links-csv",
                str(matching / "project_links.csv"),
                "--candidate-scores-csv",
                str(matching / "candidate_scores.csv"),
                "--output-dir",
                str(output),
                "--llm-config",
                str(resolve_project_path(os.getenv("LLM_CONFIG_PATH"), PROJECT_ROOT / "backend" / "config" / "llm_api_config.json")),
                "--workers",
                os.getenv("LLM_MATCHING_WORKERS", os.getenv("LLM_WORKERS", "4")),
                "--max-candidates",
                os.getenv("MATCHING_MAX_CANDIDATES", "5"),
            ],
        )

    def _build_project_merger_command(self) -> CommandSpec:
        staging = PROJECT_ROOT / "backend" / "data" / "staging"
        matching = resolve_project_path(
            os.getenv("LLM_MATCHING_OUTPUT_DIR"), staging / "llm_matching"
        )
        return self._build_matching_module_command(
            "backend.matching.project_merger",
            [
                "--procurement-csv",
                str(self._staging_path("LLM_OUTPUT_DIR", staging, "announcement_table.csv")),
                "--result-csv",
                str(self._staging_path("LLM_RESULT_OUTPUT_DIR", staging / "result", "result_table.csv")),
                "--verified-links-csv",
                str(matching / "llm_verified_links.csv"),
                "--output-dir",
                str(resolve_project_path(os.getenv("MATCHING_MERGED_OUTPUT_DIR"), staging / "final")),
            ],
        )

    @classmethod
    def _build_matching_module_command(
        cls,
        module: str,
        arguments: list[str],
    ) -> CommandSpec:
        python_executable = Path(sys.executable)
        if not python_executable.exists():
            raise JobStartError("Python executable not found for matching stage")
        return (
            [str(python_executable), "-u", "-m", module, *arguments],
            PROJECT_ROOT,
            cls._job_env(),
        )
