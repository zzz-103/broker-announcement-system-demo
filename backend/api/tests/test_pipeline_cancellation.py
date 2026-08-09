from __future__ import annotations

import threading
import time
import unittest
from collections import deque
from unittest.mock import patch

from backend.api.job_manager import Job, JobManager, utc_now


class PipelineCancellationTests(unittest.TestCase):
    def test_cancelling_parallel_collection_terminates_both_processes(self) -> None:
        manager = JobManager()

        class Process:
            def __init__(self, pid: int) -> None:
                self.pid = pid

            @staticmethod
            def poll() -> None:
                return None

        first = Process(101)
        second = Process(102)
        manager._jobs["parallel-job"] = Job(
            "parallel-job", "pipeline", "running", utc_now()
        )
        manager._events["parallel-job"] = deque()
        manager._event_sequences["parallel-job"] = 0
        manager._processes["parallel-job"] = {
            "jincai:procurement": first,  # type: ignore[dict-item]
            "direct": second,  # type: ignore[dict-item]
        }

        with patch.object(manager, "_terminate_process_tree") as terminate:
            result = manager.cancel_job("parallel-job")

        self.assertEqual(result["status"], "cancelling")
        self.assertEqual(
            [call.args[0] for call in terminate.call_args_list],
            [first, second],
        )

    def test_cancelling_pipeline_stops_before_later_stages_and_releases_lock(self) -> None:
        manager = JobManager()
        stage_started = threading.Event()
        release_stage = threading.Event()
        stages: list[str] = []

        def run_collection(job_id: str, _log: object) -> int:
            stages.append("collection")
            stage_started.set()
            self.assertTrue(release_stage.wait(timeout=2))
            return -15

        with patch.object(manager, "_execute_collection_branches", side_effect=run_collection):
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
        self.assertEqual(stages, ["collection"])
        manager.acquire_operation("publish")
        manager.release_operation("publish")


if __name__ == "__main__":
    unittest.main()
