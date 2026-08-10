from __future__ import annotations

import threading
import time
import unittest
import os
from unittest.mock import patch

from backend.api.job_manager import JobManager
from backend.api.job_commands import PROJECT_ROOT


class DualScraperJobTests(unittest.TestCase):
    def test_legacy_result_input_env_is_migrated_to_selected_directory(self) -> None:
        manager = JobManager()
        legacy_path = str(PROJECT_ROOT / "backend" / "python-http-www-cfcpn-com-jcw" / "output" / "result" / "notices")
        with (
            patch.dict(os.environ, {"LLM_RESULT_INPUT_DIR": legacy_path}),
            patch("backend.api.job_commands.llm_config_available", return_value=True),
        ):
            command, _working_dir, _env = manager._build_llm_command(notice_type="result")
        input_index = command.index("--input-dir") + 1
        self.assertTrue(
            command[input_index]
            .replace("\\", "/")
            .endswith("output/selected/result/notices")
        )

    def test_llm_matcher_receives_selected_markdown_directories(self) -> None:
        manager = JobManager()
        command, _working_dir, _env = manager._build_llm_matching_command()

        procurement_index = command.index("--procurement-markdown-dir") + 1
        result_index = command.index("--result-markdown-dir") + 1
        self.assertTrue(
            command[procurement_index]
            .replace("\\", "/")
            .endswith("output/selected/procurement/notices")
        )
        self.assertTrue(
            command[result_index]
            .replace("\\", "/")
            .endswith("output/selected/result/notices")
        )

    def test_scraper_runs_jincai_and_direct_sources_in_parallel_then_prepares_input(self) -> None:
        manager = JobManager()
        stages: list[str] = []
        finished = threading.Event()
        first_branches_started = threading.Event()
        stage_lock = threading.Lock()

        def run_stage(job_id: str, _builder: object, stage_label: str) -> int:
            with stage_lock:
                stages.append(stage_label)
                if {"jincai:procurement", "direct"}.issubset(stages):
                    first_branches_started.set()
            if stage_label in {"jincai:procurement", "direct"}:
                self.assertTrue(first_branches_started.wait(timeout=2))
            if stage_label == "source-prepare":
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
        self.assertEqual(set(stages[:2]), {"jincai:procurement", "direct"})
        self.assertLess(stages.index("jincai:procurement"), stages.index("jincai:result"))
        self.assertLess(stages.index("jincai:result"), stages.index("source-prepare"))
        self.assertLess(stages.index("direct"), stages.index("source-prepare"))

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
