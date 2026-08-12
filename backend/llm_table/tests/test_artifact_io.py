import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.llm_table.artifact_io import atomic_write_text
from backend.llm_table.llm_markdown_table_builder import process_markdown_file


class _FakeConfig:
    timeout_seconds = 1


class _FakeClient:
    config = _FakeConfig()

    def __init__(self) -> None:
        self.calls = 0

    def extract(self, *, markdown: str, metadata: dict[str, str]) -> list[dict[str, str]]:
        self.calls += 1
        return [{"project_name": "重试后成功", "source_file": metadata["markdown_file"]}]


class ArtifactIoTests(unittest.TestCase):
    def test_atomic_write_preserves_previous_target_when_replace_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            target = Path(temporary_dir) / "run_summary.json"
            target.write_text("previous", encoding="utf-8")

            with patch(
                "backend.llm_table.artifact_io.os.replace",
                side_effect=OSError("replace failed"),
            ):
                with self.assertRaises(OSError):
                    atomic_write_text(target, "new")

            self.assertEqual(target.read_text(encoding="utf-8"), "previous")
            self.assertEqual(list(target.parent.glob(".run_summary.*.tmp.json")), [])

    def test_corrupt_raw_cache_is_retried_and_replaced_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            input_dir = root / "markdown"
            output_dir = root / "structured"
            markdown_path = input_dir / "broker_a" / "notice.md"
            markdown_path.parent.mkdir(parents=True)
            markdown_path.write_text("# Notice\n\nbody", encoding="utf-8")
            raw_json_path = output_dir / "raw_json" / "broker_a" / "notice.json"
            raw_json_path.parent.mkdir(parents=True)
            raw_json_path.write_text("{not valid json", encoding="utf-8")

            client = _FakeClient()
            result = process_markdown_file(
                markdown_path,
                input_dir,
                output_dir,
                client,  # type: ignore[arg-type]
                force_refresh=False,
                request_semaphore=threading.Semaphore(1),
                min_interval_seconds=0,
                request_start_lock=None,
                next_allowed_call_at=[0.0],
                request_log_interval_seconds=0,
            )

            self.assertEqual(client.calls, 1)
            self.assertEqual(result.rows[0]["project_name"], "重试后成功")
            self.assertEqual(
                json.loads(raw_json_path.read_text(encoding="utf-8"))[0]["project_name"],
                "重试后成功",
            )
            self.assertEqual(list(raw_json_path.parent.glob(".notice.*.tmp.json")), [])


if __name__ == "__main__":
    unittest.main()
