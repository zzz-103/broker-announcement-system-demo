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
    def baidu_qianfan_model(self) -> str:
        return os.getenv("BAIDU_QIANFAN_MODEL", "").strip()

    @property
    def baidu_qianfan_endpoint(self) -> str:
        return os.getenv(
            "BAIDU_QIANFAN_ENDPOINT",
            "https://qianfan.baidubce.com/v2/ai_search/chat/completions",
        ).strip().rstrip("/")

    @property
    def baidu_qianfan_auth_header(self) -> str:
        value = os.getenv("BAIDU_QIANFAN_AUTH_HEADER", "Authorization").strip()
        supported = {
            "authorization": "Authorization",
            "x-appbuilder-authorization": "X-Appbuilder-Authorization",
        }
        return supported.get(value.casefold(), "Authorization")

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


settings = Settings()
