"""Independent scheduler process for backend jobs.

Start with::

    python -m backend.api.scheduler

The scheduler does **not** run inside FastAPI. It calls authenticated internal
FastAPI routes on configurable cron schedules.

Environment variables
---------------------
SCHEDULER_ENABLED       true (default) or false to skip startup
SCHEDULER_TIMEZONE      IANA timezone name, e.g. Asia/Shanghai
SCHEDULER_CRON          APScheduler cron expression, e.g. ``0 12 * * sun``
APP_WATCH_SCHEDULER_ENABLED  true to enable the optional App Watch schedule
APP_WATCH_SCHEDULER_CRON     App Watch cron expression
SCHEDULER_API_URL       Base URL of the FastAPI service
SCHEDULER_TOKEN         Shared secret sent as X-Scheduler-Token
"""

from __future__ import annotations

import json
import logging
import sys
import time
import urllib.error
import urllib.request

from .config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [scheduler] %(levelname)s %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("scheduler")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCHEDULER_ENABLED = settings.scheduler_enabled
SCHEDULER_TIMEZONE = settings.scheduler_timezone
SCHEDULER_CRON = settings.scheduler_cron
APP_WATCH_SCHEDULER_ENABLED = settings.app_watch_scheduler_enabled
APP_WATCH_SCHEDULER_CRON = settings.app_watch_scheduler_cron
SCHEDULER_API_URL = settings.scheduler_api_url
SCHEDULER_TOKEN = settings.scheduler_token

_REQUEST_TIMEOUT = 10          # seconds per attempt
_RETRY_MAX = 3
_RETRY_DELAY = 30              # seconds between retries


# ---------------------------------------------------------------------------
# HTTP helper (stdlib only — no extra dependency)
# ---------------------------------------------------------------------------

def _post_scheduled_job(endpoint: str, label: str) -> None:
    """Call one internal scheduled-job endpoint with retry logic."""
    if not SCHEDULER_TOKEN:
        logger.error("SCHEDULER_TOKEN is not set; skipping trigger")
        return

    url = f"{SCHEDULER_API_URL}{endpoint}"
    headers = {
        "Content-Type": "application/json",
        "X-Scheduler-Token": SCHEDULER_TOKEN,
    }
    body = b"{}"

    for attempt in range(1, _RETRY_MAX + 1):
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=_REQUEST_TIMEOUT) as resp:
                raw = resp.read()
                try:
                    payload = json.loads(raw)
                    job_id = payload.get("job_id", "unknown")
                except Exception:
                    job_id = "unknown"
                logger.info("%s accepted, job_id=%s", label, job_id)
                return  # success
        except urllib.error.HTTPError as exc:
            if exc.code == 409:
                logger.warning("%s blocked by another task (409); will not retry", label)
                return
            if exc.code in (401, 403):
                logger.error(
                    "Scheduler token rejected by server (HTTP %d); check SCHEDULER_TOKEN config",
                    exc.code,
                )
                return
            # 5xx or other unexpected codes — retry
            logger.warning(
                "HTTP %d on attempt %d/%d; %s",
                exc.code,
                attempt,
                _RETRY_MAX,
                "retrying…" if attempt < _RETRY_MAX else "giving up",
            )
        except (urllib.error.URLError, OSError) as exc:
            logger.warning(
                "Connection error on attempt %d/%d: %s; %s",
                attempt,
                _RETRY_MAX,
                exc,
                "retrying…" if attempt < _RETRY_MAX else "giving up",
            )

        if attempt < _RETRY_MAX:
            time.sleep(_RETRY_DELAY)


def _post_scheduled_pipeline() -> None:
    _post_scheduled_job("/api/internal/scheduled-pipeline", "Pipeline")


def _post_scheduled_app_watch() -> None:
    _post_scheduled_job("/api/internal/scheduled-app-watch", "App Watch")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    if SCHEDULER_ENABLED in ("false", "0", "no", "off"):
        logger.info("SCHEDULER_ENABLED=false; exiting")
        return

    # Lazy import so the rest of the module can be imported without APScheduler
    try:
        from apscheduler.schedulers.blocking import BlockingScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError as exc:
        logger.error("APScheduler is not installed: %s", exc)
        sys.exit(1)

    # Parse cron fields: "min hour dom mon dow"
    cron_parts = SCHEDULER_CRON.split()
    if len(cron_parts) != 5:
        logger.error(
            "SCHEDULER_CRON must have exactly 5 fields (got %r)", SCHEDULER_CRON
        )
        sys.exit(1)
    minute, hour, day, month, day_of_week = cron_parts

    try:
        trigger = CronTrigger(
            minute=minute,
            hour=hour,
            day=day,
            month=month,
            day_of_week=day_of_week,
            timezone=SCHEDULER_TIMEZONE,
        )
    except Exception as exc:
        logger.error(
            "Invalid SCHEDULER_CRON=%r or SCHEDULER_TIMEZONE=%r: %s",
            SCHEDULER_CRON,
            SCHEDULER_TIMEZONE,
            exc,
        )
        sys.exit(1)

    scheduler = BlockingScheduler(timezone=SCHEDULER_TIMEZONE)
    scheduler.add_job(
        _post_scheduled_pipeline,
        trigger=trigger,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
        id="weekly_pipeline",
        name="Weekly broker announcement pipeline",
    )

    app_watch_enabled = APP_WATCH_SCHEDULER_ENABLED not in ("false", "0", "no", "off")
    if app_watch_enabled:
        app_watch_parts = APP_WATCH_SCHEDULER_CRON.split()
        if len(app_watch_parts) != 5:
            logger.error(
                "APP_WATCH_SCHEDULER_CRON must have exactly 5 fields (got %r)",
                APP_WATCH_SCHEDULER_CRON,
            )
            sys.exit(1)
        app_minute, app_hour, app_day, app_month, app_day_of_week = app_watch_parts
        try:
            app_watch_trigger = CronTrigger(
                minute=app_minute,
                hour=app_hour,
                day=app_day,
                month=app_month,
                day_of_week=app_day_of_week,
                timezone=SCHEDULER_TIMEZONE,
            )
        except Exception as exc:
            logger.error(
                "Invalid APP_WATCH_SCHEDULER_CRON=%r or SCHEDULER_TIMEZONE=%r: %s",
                APP_WATCH_SCHEDULER_CRON,
                SCHEDULER_TIMEZONE,
                exc,
            )
            sys.exit(1)
        scheduler.add_job(
            _post_scheduled_app_watch,
            trigger=app_watch_trigger,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=3600,
            id="weekly_app_watch",
            name="Weekly broker App update refresh",
        )

    logger.info(
        "Scheduler starting — cron=%r timezone=%r api=%s",
        SCHEDULER_CRON,
        SCHEDULER_TIMEZONE,
        SCHEDULER_API_URL,
    )
    if app_watch_enabled:
        logger.info("App Watch schedule enabled — cron=%r", APP_WATCH_SCHEDULER_CRON)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped")


if __name__ == "__main__":
    main()
