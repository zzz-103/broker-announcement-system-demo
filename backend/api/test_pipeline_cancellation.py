from __future__ import annotations

import threading
import time
import unittest
from unittest.mock import patch

from backend.api.job_manager import JobManager


class PipelineCancellationTests(unittest.TestCase):
    def test_cancelling_pipeline_stops_before_later_stages_and_releases_lock(self) -> None:
        manager = JobManager()
        stage_started = threading.Event()
        release_stage = threading.Event()
        stages: list[str] = []

        def run_stage(job_id: str, _builder: object, stage_label: str) -> int:
            stages.append(stage_label)
            stage_started.set()
            self.assertTrue(release_stage.wait(timeout=2))
            return -15

        with patch.object(manager, "_execute_stage", side_effect=run_stage):
            job = manager.start_pipeline()
            self.assertTrue(stage_started.wait(timeout=2))
            self.assertEqual(manager.cancel_job(job.job_id)["status"], "cancelling")
            release_stage.set()

            deadline = time.monotonic() + 2
            snapshot = manager.get_job(job.job_id)
            while snapshot["status"] == "running" and time.monotonic() < deadline:
                time.sleep(0.01)
                snapshot = manager.get_job(job.job_id)

        self.assertEqual(snapshot["status"], "cancelled")
        self.assertEqual(stages, ["procurement-scraper"])
        manager.acquire_operation("publish")
        manager.release_operation("publish")


if __name__ == "__main__":
    unittest.main()
