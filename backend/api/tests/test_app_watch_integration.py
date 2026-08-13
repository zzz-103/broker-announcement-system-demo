from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api import main, scheduler
from backend.api.config import PROJECT_ROOT
from backend.api.job_commands import JobCommandFactory
from backend.api.job_manager import Job, JobManager, utc_now
from backend.api.routes import jobs


class AppWatchIntegrationTests(unittest.TestCase):
    def test_successful_app_watch_promotes_imported_working_package(self) -> None:
        manager = JobManager()
        job = Job("app-success", "app-watch", "running", utc_now())
        manager._jobs[job.job_id] = job
        manager._events[job.job_id] = __import__("collections").deque()
        manager._event_sequences[job.job_id] = 0

        class Process:
            pid = 101
            stdout = iter(())
            stderr = iter(())

            def wait(self) -> int:
                return 0

            def poll(self) -> int:
                return 0

        process = Process()
        with (
            patch.object(manager, "_read_stream"),
            patch("backend.api.job_manager.subprocess.Popen", return_value=process),
            patch("backend.api.dashboard_package.dashboard_package_builder.build", return_value=object()),
            patch("backend.api.dashboard_package_import.promote_active_imported_package", return_value={"package_version": "next"}) as promote,
        ):
            manager._run_job(job.job_id, lambda: (["python", "app"], PROJECT_ROOT, {}))
        self.assertEqual(manager.get_job(job.job_id)["status"], "succeeded")
        promote.assert_called_once()

    def test_failed_app_watch_does_not_promote_working_package(self) -> None:
        manager = JobManager()
        job = Job("app-failed", "app-watch", "running", utc_now())
        manager._jobs[job.job_id] = job
        manager._events[job.job_id] = __import__("collections").deque()
        manager._event_sequences[job.job_id] = 0

        class Process:
            pid = 102
            stdout = iter(())
            stderr = iter(())

            def wait(self) -> int:
                return 1

            def poll(self) -> int:
                return 1

        with (
            patch.object(manager, "_read_stream"),
            patch("backend.api.job_manager.subprocess.Popen", return_value=Process()),
            patch("backend.api.dashboard_package_import.promote_active_imported_package") as promote,
        ):
            manager._run_job(job.job_id, lambda: (["python", "app"], PROJECT_ROOT, {}))
        self.assertEqual(manager.get_job(job.job_id)["status"], "failed")
        promote.assert_not_called()

    def test_job_command_uses_backend_module_and_shared_runtime(self) -> None:
        factory = JobCommandFactory()
        with tempfile.TemporaryDirectory() as directory:
            temp_dir = Path(directory)
            llm_config = temp_dir / "llm.json"
            llm_config.write_text("{}", encoding="utf-8")
            export_path = temp_dir / "app_releases.csv"
            values = {
                "APP_WATCH_PYTHON_EXECUTABLE": sys.executable,
                "APP_WATCH_WORKING_DIR": str(PROJECT_ROOT),
                "APP_WATCH_LLM_CONFIG_PATH": str(llm_config),
                "APP_RELEASES_CSV_PATH": str(export_path),
            }
            with (
                patch.dict(os.environ, values, clear=False),
                patch.object(factory, "_validate_app_watch_dependencies"),
            ):
                command, working_dir, env = factory._build_app_watch_command()

        self.assertEqual(command[3:5], ["backend.broker_app_watch.cli", "refresh"])
        self.assertEqual(working_dir, PROJECT_ROOT)
        self.assertEqual(Path(command[-1]), export_path.resolve())
        self.assertIn(str(PROJECT_ROOT), env["PYTHONPATH"].split(os.pathsep))

    def test_internal_scheduler_route_starts_app_watch(self) -> None:
        fake_job = SimpleNamespace(job_id="scheduled-app-1", job_type="app-watch", status="running")
        with (
            patch.dict(os.environ, {"SCHEDULER_TOKEN": "test-scheduler-token"}),
            patch.object(jobs.job_manager, "start_app_watch", return_value=fake_job),
        ):
            response = TestClient(main.app).post(
                "/api/internal/scheduled-app-watch",
                headers={"X-Scheduler-Token": "test-scheduler-token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["job_type"], "app-watch")

    def test_scheduler_targets_internal_app_watch_route(self) -> None:
        with patch.object(scheduler, "_post_scheduled_job") as post_job:
            scheduler._post_scheduled_app_watch()
        post_job.assert_called_once_with(
            "/api/internal/scheduled-app-watch",
            "App Watch",
        )

    def test_scheduler_registers_optional_app_watch_job(self) -> None:
        registered: list[str] = []

        class FakeScheduler:
            def __init__(self, **_kwargs: object) -> None:
                pass

            def add_job(self, _func: object, **kwargs: object) -> None:
                registered.append(str(kwargs["id"]))

            def start(self) -> None:
                pass

        with (
            patch("apscheduler.schedulers.blocking.BlockingScheduler", FakeScheduler),
            patch("apscheduler.triggers.cron.CronTrigger", return_value=object()),
            patch.object(scheduler, "SCHEDULER_ENABLED", "true"),
            patch.object(scheduler, "SCHEDULER_TOKEN", "test-scheduler-token"),
            patch.object(scheduler, "APP_WATCH_SCHEDULER_ENABLED", "true"),
            patch.object(scheduler, "SCHEDULER_CRON", "0 12 * * sun"),
            patch.object(scheduler, "APP_WATCH_SCHEDULER_CRON", "30 12 * * sun"),
        ):
            scheduler.main()

        self.assertEqual(registered, ["weekly_pipeline", "weekly_app_watch"])


if __name__ == "__main__":
    unittest.main()
