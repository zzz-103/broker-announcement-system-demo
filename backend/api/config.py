from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = PROJECT_ROOT / ".env"
load_dotenv(ENV_PATH)


def resolve_project_path(value: str | None, default: Path) -> Path:
    path = Path(value) if value else default
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


def bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)).strip())
    except (AttributeError, ValueError):
        return default
    return value if minimum <= value <= maximum else default


@dataclass(frozen=True, slots=True)
class Settings:
    """Lightweight environment-backed settings shared by API and workers.

    Properties read the environment when accessed so tests and local launchers
    can safely override values without recreating a global settings object.
    """

    @property
    def admin_username(self) -> str:
        return os.getenv("ADMIN_USERNAME", "admin")

    @property
    def admin_password(self) -> str | None:
        return os.getenv("ADMIN_PASSWORD")

    @property
    def frontend_origins(self) -> list[str]:
        configured = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
        origins = [value.strip() for value in configured.split(",") if value.strip()]
        return origins or ["http://localhost:3000"]

    @property
    def announcement_csv_path(self) -> Path:
        return resolve_project_path(
            os.getenv("ANNOUNCEMENT_CSV_PATH"),
            PROJECT_ROOT / "backend" / "data" / "announcement_table.csv",
        )

    @property
    def app_releases_csv_path(self) -> Path:
        return resolve_project_path(
            os.getenv("APP_RELEASES_CSV_PATH"),
            PROJECT_ROOT
            / "backend"
            / "data"
            / "broker_app_watch"
            / "exports"
            / "app_releases.csv",
        )

    @property
    def ai_analysis_cache_path(self) -> Path:
        return resolve_project_path(
            os.getenv("AI_ANALYSIS_CACHE_PATH"),
            PROJECT_ROOT / "backend" / "data" / "ai-analysis.json",
        )

    @property
    def dashboard_data_export_dir(self) -> Path:
        return resolve_project_path(
            os.getenv("DASHBOARD_DATA_EXPORT_DIR"),
            PROJECT_ROOT / "backend" / "data" / "dashboard-data",
        )

    @property
    def dashboard_data_imported_zip_path(self) -> Path:
        return resolve_project_path(
            os.getenv("DASHBOARD_DATA_IMPORTED_ZIP_PATH"),
            self.dashboard_data_export_dir / "imported-dashboard-data.zip",
        )

    @property
    def dashboard_data_source_preference_path(self) -> Path:
        return resolve_project_path(
            os.getenv("DASHBOARD_DATA_SOURCE_PREFERENCE_PATH"),
            self.dashboard_data_export_dir / "source-preference.json",
        )

    @property
    def matching_procurement_csv_path(self) -> Path:
        return resolve_project_path(
            os.getenv("LLM_OUTPUT_DIR"),
            PROJECT_ROOT / "backend" / "data" / "staging",
        ) / "announcement_table.csv"

    @property
    def matching_result_csv_path(self) -> Path:
        return resolve_project_path(
            os.getenv("LLM_RESULT_OUTPUT_DIR"),
            PROJECT_ROOT / "backend" / "data" / "staging" / "result",
        ) / "result_table.csv"

    @property
    def matching_verified_links_path(self) -> Path:
        return resolve_project_path(
            os.getenv("LLM_MATCHING_OUTPUT_DIR"),
            PROJECT_ROOT / "backend" / "data" / "staging" / "llm_matching",
        ) / "llm_verified_links.csv"

    @property
    def matching_state_path(self) -> Path:
        return self.matching_verified_links_path.with_name("matching_state.json")

    @property
    def imported_matching_baseline_path(self) -> Path:
        return resolve_project_path(
            os.getenv("IMPORTED_MATCHING_BASELINE_PATH"),
            PROJECT_ROOT / "backend" / "data" / "staging" / "imported_matching_baseline.json",
        )

    @property
    def merged_announcement_csv_path(self) -> Path:
        output_dir = resolve_project_path(
            os.getenv("MATCHING_MERGED_OUTPUT_DIR"),
            PROJECT_ROOT / "backend" / "data" / "staging" / "final",
        )
        return output_dir / "announcement_table_merged_test.csv"

    @property
    def frontend_dist_path(self) -> Path:
        return resolve_project_path(
            os.getenv("FRONTEND_DIST_PATH"),
            PROJECT_ROOT / "frontend" / "out",
        )

    @property
    def announcement_backup_retention(self) -> int:
        return bounded_int("ANNOUNCEMENT_BACKUP_RETENTION", 3, 1, 100)

    @property
    def publish_min_retain_ratio(self) -> float:
        try:
            value = float(os.getenv("PUBLISH_MIN_RETAIN_RATIO", "0.5"))
        except (TypeError, ValueError):
            return 0.5
        return value if 0 < value <= 1 else 0.5

    @property
    def session_limit(self) -> int:
        return bounded_int("SESSION_LIMIT", 1000, 10, 100_000)

    @property
    def job_history_limit(self) -> int:
        return bounded_int("JOB_HISTORY_LIMIT", 100, 10, 10_000)

    @property
    def scheduler_enabled(self) -> str:
        return os.getenv("SCHEDULER_ENABLED", "true").strip().lower()

    @property
    def scheduler_timezone(self) -> str:
        return os.getenv("SCHEDULER_TIMEZONE", "Asia/Shanghai").strip()

    @property
    def scheduler_cron(self) -> str:
        return os.getenv("SCHEDULER_CRON", "0 12 * * sun").strip()

    @property
    def app_watch_scheduler_enabled(self) -> str:
        return os.getenv("APP_WATCH_SCHEDULER_ENABLED", "false").strip().lower()

    @property
    def app_watch_scheduler_cron(self) -> str:
        return os.getenv("APP_WATCH_SCHEDULER_CRON", "30 12 * * sun").strip()

    @property
    def scheduler_api_url(self) -> str:
        return os.getenv("SCHEDULER_API_URL", "http://localhost:8000").rstrip("/")

    @property
    def scheduler_token(self) -> str:
        return os.getenv("SCHEDULER_TOKEN", "")

    @property
    def custom_intelligence_db_path(self) -> Path:
        """Database used by the custom intelligence module.

        The feature intentionally shares the existing user database unless a
        deployment explicitly supplies an override.  Importing the resolver
        lazily avoids a config -> user_store import cycle.
        """
        configured = os.getenv("CUSTOM_INTELLIGENCE_DB_PATH")
        if configured:
            return resolve_project_path(configured, PROJECT_ROOT / "backend" / "data" / "users.db")
        from .user_store import resolve_user_db_path

        return resolve_user_db_path()

    @property
    def baidu_qianfan_api_key(self) -> str:
        return os.getenv("BAIDU_QIANFAN_API_KEY", "").strip()

    @property
    def baidu_qianfan_timeout_seconds(self) -> float:
        try:
            value = float(os.getenv("BAIDU_QIANFAN_TIMEOUT_SECONDS", "120"))
        except (TypeError, ValueError):
            return 120.0
        return value if 1 <= value <= 600 else 120.0

    @property
    def custom_intelligence_max_workers(self) -> int:
        return bounded_int("CUSTOM_INTELLIGENCE_MAX_WORKERS", 2, 1, 8)

    @property
    def llm_config_path(self) -> Path:
        return resolve_project_path(
            os.getenv("LLM_CONFIG_PATH"),
            PROJECT_ROOT / "backend" / "config" / "llm_api_config.json",
        )

    @property
    def llm_config_override_path(self) -> Path:
        return resolve_project_path(
            os.getenv("LLM_CONFIG_OVERRIDE_PATH"),
            PROJECT_ROOT / "backend" / "data" / "llm_api_config.override.json",
        )

    @property
    def smtp_enabled(self) -> bool:
        return os.getenv("CUSTOM_INTELLIGENCE_EMAIL_ENABLED", "true").strip().casefold() in {
            "1",
            "true",
            "yes",
            "on",
        }

    @property
    def smtp_host(self) -> str:
        return os.getenv("SMTP_HOST", "smtp.csco.com.cn").strip() or "smtp.csco.com.cn"

    @property
    def smtp_port(self) -> int:
        return bounded_int("SMTP_PORT", 465, 1, 65_535)

    @property
    def smtp_use_ssl(self) -> bool:
        return os.getenv("SMTP_USE_SSL", "true").strip().casefold() in {
            "1",
            "true",
            "yes",
            "on",
        }

    @property
    def smtp_username(self) -> str:
        return os.getenv("SMTP_USERNAME", "").strip()

    @property
    def smtp_from_address(self) -> str:
        return os.getenv("SMTP_FROM_ADDRESS", "").strip() or self.smtp_username

    @property
    def smtp_authorization_code(self) -> str:
        return os.getenv("SMTP_AUTHORIZATION_CODE", "").strip()

    @property
    def smtp_timeout_seconds(self) -> float:
        try:
            value = float(os.getenv("SMTP_TIMEOUT_SECONDS", "30"))
        except (TypeError, ValueError):
            return 30.0
        return value if 1 <= value <= 180 else 30.0

    @property
    def smtp_allowed_domain(self) -> str:
        return "csco.com.cn"

    @property
    def smtp_max_recipients(self) -> int:
        return 5


settings = Settings()
