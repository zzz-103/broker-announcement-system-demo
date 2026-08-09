from __future__ import annotations

import unittest
from collections import deque

from backend.api.job_manager import Job, JobManager, utc_now
from backend.api.session_store import SessionStore


class RuntimeBoundsTests(unittest.TestCase):
    def test_session_store_evicts_oldest_entry(self) -> None:
        store = SessionStore(limit=2)
        store["first"] = {"role": "user"}
        store["second"] = {"role": "user"}
        store["third"] = {"role": "admin"}
        self.assertNotIn("first", store)
        self.assertEqual(set(store), {"second", "third"})

    def test_job_event_is_stored_once(self) -> None:
        manager = JobManager()
        job = Job("job", "scraper", "running", utc_now())
        manager._jobs[job.job_id] = job
        manager._events[job.job_id] = deque(maxlen=500)
        manager._event_sequences[job.job_id] = 0
        manager._append_event(job.job_id, {"type": "log", "timestamp": utc_now()})
        self.assertEqual(len(manager._events[job.job_id]), 1)
        self.assertEqual(manager._event_sequences[job.job_id], 1)

    def test_job_history_prunes_only_terminal_jobs(self) -> None:
        manager = JobManager()
        manager._history_limit = 2
        manager._jobs["old"] = Job("old", "scraper", "succeeded", utc_now())
        manager._jobs["active"] = Job("active", "llm", "running", utc_now())
        manager._events["old"] = deque()
        manager._events["active"] = deque()
        manager._event_sequences.update({"old": 0, "active": 0})
        manager._running_job_id = "active"
        manager._prune_history_locked()
        self.assertNotIn("old", manager._jobs)
        self.assertIn("active", manager._jobs)


if __name__ == "__main__":
    unittest.main()
