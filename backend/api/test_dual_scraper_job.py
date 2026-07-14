from __future__ import annotations

import threading
import time
import unittest
from unittest.mock import patch

from backend.api.job_manager import JobManager


class DualScraperJobTests(unittest.TestCase):
    def test_scraper_runs_procurement_then_result_without_llm_stages(self) -> None:
        manager = JobManager()
        stages: list[str] = []
        finished = threading.Event()

        def run_stage(job_id: str, _builder: object, stage_label: str) -> int:
            stages.append(stage_label)
            if stage_label == "result-scraper":
                finished.set()
            return 0

        with patch.object(manager, "_execute_stage", side_effect=run_stage):
            job = manager.start_scraper()
            self.assertTrue(finished.wait(timeout=2))

            deadline = time.monotonic() + 2
            snapshot = manager.get_job(job.job_id)
            while snapshot["status"] == "running" and time.monotonic() < deadline:
                time.sleep(0.01)
                snapshot = manager.get_job(job.job_id)

        self.assertEqual(snapshot["status"], "succeeded")
        self.assertEqual(stages, ["procurement-scraper", "result-scraper"])

    def test_normal_llm_runs_matching_and_merger_after_both_notice_types(self) -> None:
        manager = JobManager()
        stages: list[str] = []
        finished = threading.Event()

        def run_stage(job_id: str, _builder: object, stage_label: str) -> int:
            stages.append(stage_label)
            if stage_label == "project-merger":
                finished.set()
            return 0

        with patch.object(manager, "_execute_stage", side_effect=run_stage):
            job = manager.start_llm()
            self.assertTrue(finished.wait(timeout=2))

            deadline = time.monotonic() + 2
            snapshot = manager.get_job(job.job_id)
            while snapshot["status"] == "running" and time.monotonic() < deadline:
                time.sleep(0.01)
                snapshot = manager.get_job(job.job_id)

        self.assertEqual(snapshot["status"], "succeeded")
        self.assertEqual(
            stages,
            [
                "procurement-llm",
                "result-llm",
                "rule-matching",
                "llm-matching",
                "project-merger",
            ],
        )


if __name__ == "__main__":
    unittest.main()
