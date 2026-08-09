from __future__ import annotations

import csv
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.api.job_manager import JobManager
from backend.api.publication_service import PublicationError, publish_merged_announcements
from backend.api.supplemental_seed import CANONICAL_FIELDS, MergeResult


def write_rows(path: Path, count: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=CANONICAL_FIELDS)
        writer.writeheader()
        for index in range(count):
            row = {field: "" for field in CANONICAL_FIELDS}
            row["document_sha1"] = f"row-{index}"
            row["project_name"] = f"Project {index}"
            writer.writerow(row)


class PublicationServiceTests(unittest.TestCase):
    def test_retain_ratio_guard_preserves_previous_dataset(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            target = root / "announcement_table.csv"
            merged_dir = root / "merged"
            merged_path = merged_dir / "announcement_table_merged_test.csv"
            write_rows(target, 10)
            write_rows(merged_path, 1)
            candidate = {field: "" for field in CANONICAL_FIELDS}
            candidate["document_sha1"] = "candidate-1"
            candidate["project_name"] = "Candidate"

            with patch.dict(
                os.environ,
                {
                    "ANNOUNCEMENT_CSV_PATH": str(target),
                    "MATCHING_MERGED_OUTPUT_DIR": str(merged_dir),
                    "SUPPLEMENTAL_DATA_DIR": str(root / "supplemental"),
                    "PUBLISH_MIN_RETAIN_RATIO": "0.5",
                },
            ), patch(
                "backend.api.publication_service.merge_for_publication",
                return_value=MergeResult(
                    records=[candidate],
                    meta={"staging_count": 1},
                ),
            ):
                with self.assertRaises(PublicationError):
                    publish_merged_announcements()

            with target.open("r", encoding="utf-8-sig", newline="") as file:
                self.assertEqual(len(list(csv.DictReader(file))), 10)
            self.assertEqual(list(root.glob("*.backup.csv")), [])

    def test_pipeline_publishes_before_finishing(self) -> None:
        manager = JobManager()
        publish_meta = {
            "published_count": 12,
            "retain_ratio": 0.8,
        }
        with patch.dict(os.environ, {"PIPELINE_ANALYSIS_ENABLED": "false"}), patch.object(
            manager,
            "_execute_collection_branches",
            return_value=0,
        ), patch.object(manager, "_execute_stage", return_value=0), patch(
            "backend.api.publication_service.publish_merged_announcements",
            return_value=publish_meta,
        ) as publish:
            job = manager.start_pipeline()
            deadline = time.monotonic() + 3
            snapshot = manager.get_job(job.job_id)
            while snapshot["status"] == "running" and time.monotonic() < deadline:
                time.sleep(0.01)
                snapshot = manager.get_job(job.job_id)

        self.assertEqual(snapshot["status"], "succeeded")
        publish.assert_called_once_with()
        self.assertTrue(
            any("[publish] 完成" in event.get("message", "") for event in snapshot["events"])
        )


if __name__ == "__main__":
    unittest.main()
