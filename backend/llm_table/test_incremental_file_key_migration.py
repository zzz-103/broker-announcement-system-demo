import csv
import hashlib
import tempfile
import unittest
from pathlib import Path

from backend.llm_table.llm_markdown_table_builder import (
    RESULT_TABLE_FIELDS,
    migrate_legacy_file_keys,
    select_files_for_processing,
)


def _sha1(markdown: str) -> str:
    normalized = markdown.replace("\r\n", "\n").replace("\r", "\n").strip()
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()


class IncrementalFileKeyMigrationTests(unittest.TestCase):
    def _write_result_csv(
        self,
        output_dir: Path,
        *,
        filename: str,
        document_sha1: str,
    ) -> list[dict[str, str]]:
        output_dir.mkdir(parents=True)
        row = {field: "" for field in RESULT_TABLE_FIELDS}
        row.update(
            {
                "broker_folder": "notices",
                "markdown_file": filename,
                "document_sha1": document_sha1,
            }
        )
        with (output_dir / "result_table.csv").open(
            "w", encoding="utf-8-sig", newline=""
        ) as file:
            writer = csv.DictWriter(file, fieldnames=RESULT_TABLE_FIELDS)
            writer.writeheader()
            writer.writerow(row)
        return [row]

    def test_unchanged_legacy_flat_row_is_skipped_after_broker_directory_migration(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            input_dir = root / "selected" / "result" / "notices"
            markdown_path = input_dir / "broker_abc" / "result.md"
            markdown_path.parent.mkdir(parents=True)
            markdown = "# Result\n\nunchanged"
            markdown_path.write_text(markdown, encoding="utf-8")
            existing_rows = self._write_result_csv(
                root / "output",
                filename=markdown_path.name,
                document_sha1=_sha1(markdown),
            )

            migrated_rows, migrated_count = migrate_legacy_file_keys(
                existing_rows, [markdown_path]
            )
            selection = select_files_for_processing(
                [markdown_path],
                root / "output",
                incremental=True,
                overwrite=False,
                table_fields=RESULT_TABLE_FIELDS,
                output_stem="result_table",
                existing_rows=migrated_rows,
            )

            self.assertEqual(migrated_count, 1)
            self.assertEqual(migrated_rows[0]["broker_folder"], "broker_abc")
            self.assertEqual(selection.plans, [])
            self.assertEqual(selection.skipped_files, [markdown_path])

    def test_changed_legacy_flat_row_is_rekeyed_and_processed_as_changed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            input_dir = root / "selected" / "result" / "notices"
            markdown_path = input_dir / "broker_abc" / "result.md"
            markdown_path.parent.mkdir(parents=True)
            markdown_path.write_text("# Result\n\nnew body", encoding="utf-8")
            existing_rows = self._write_result_csv(
                root / "output",
                filename=markdown_path.name,
                document_sha1=_sha1("# Result\n\nold body"),
            )

            migrated_rows, migrated_count = migrate_legacy_file_keys(
                existing_rows, [markdown_path]
            )
            selection = select_files_for_processing(
                [markdown_path],
                root / "output",
                incremental=True,
                overwrite=False,
                table_fields=RESULT_TABLE_FIELDS,
                output_stem="result_table",
                existing_rows=migrated_rows,
            )

            self.assertEqual(migrated_count, 1)
            self.assertEqual(len(selection.plans), 1)
            self.assertEqual(selection.plans[0].reason, "content_changed")

    def test_duplicate_filename_requires_unique_content_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            input_dir = root / "selected" / "result" / "notices"
            first = input_dir / "broker_a" / "same.md"
            second = input_dir / "broker_b" / "same.md"
            first.parent.mkdir(parents=True)
            second.parent.mkdir(parents=True)
            first.write_text("# A", encoding="utf-8")
            second.write_text("# B", encoding="utf-8")
            existing_rows = self._write_result_csv(
                root / "output",
                filename="same.md",
                document_sha1=_sha1("# B"),
            )

            migrated_rows, migrated_count = migrate_legacy_file_keys(
                existing_rows, [first, second]
            )

            self.assertEqual(migrated_count, 1)
            self.assertEqual(migrated_rows[0]["broker_folder"], "broker_b")


if __name__ == "__main__":
    unittest.main()
