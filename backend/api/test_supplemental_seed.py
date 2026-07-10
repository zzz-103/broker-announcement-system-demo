from __future__ import annotations

import json
import unittest
from pathlib import Path

from backend.api.supplemental_seed import (
    CANONICAL_FIELDS,
    SupplementalDataError,
    canonical_csv_sha256,
    import_temporary_seed,
    merge_for_publication,
    sha256_file,
    write_csv_atomically,
)


TEST_TEMP_PARENT = Path(__file__).resolve().parents[1] / "data" / "supplemental-test"


def test_workspace(name: str) -> Path:
    path = TEST_TEMP_PARENT / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def make_row(sha: str, project: str) -> dict[str, str]:
    row = {field: "" for field in CANONICAL_FIELDS}
    row.update(
        {
            "broker_folder": "notices",
            "markdown_file": "notice.md",
            "document_sha1": sha,
            "broker_name": "Test Broker",
            "is_broker_project": "true",
            "publish_date": "2026-07-10",
            "announcement_stage": "tender",
            "procurement_category": "IT",
            "project_subcategory": "network",
            "project_name": project,
            "procurement_method": "open",
        }
    )
    return row


class SupplementalSeedTests(unittest.TestCase):
    def test_staging_wins_without_dropping_other_rows_from_the_same_notice(self) -> None:
        root = test_workspace("same-notice")
        staging_path = root / "staging.csv"
        source_path = root / "source.csv"
        supplemental_dir = root / "supplemental"
        write_csv_atomically(
            staging_path,
            CANONICAL_FIELDS,
            [make_row("same-sha", "project-one"), make_row("same-sha", "project-two")],
        )
        write_csv_atomically(
            source_path,
            CANONICAL_FIELDS,
            [make_row("same-sha", "project-one"), make_row("same-sha", "project-three")],
        )
        import_temporary_seed(source_path, supplemental_dir)

        first = merge_for_publication(staging_path, supplemental_dir)
        second = merge_for_publication(staging_path, supplemental_dir)

        self.assertEqual(len(first.records), 3)
        self.assertEqual(first.meta["exact_duplicate_count"], 1)
        self.assertEqual(len(second.records), 3)
        self.assertEqual(
            {row["project_name"] for row in first.records},
            {"project-one", "project-two", "project-three"},
        )
        write_csv_atomically(staging_path, CANONICAL_FIELDS, [make_row("new-staging", "project-four")])
        after_staging_update = merge_for_publication(staging_path, supplemental_dir)
        self.assertTrue((supplemental_dir / "temporary_seed.csv").exists())
        self.assertEqual(
            {row["project_name"] for row in after_staging_update.records},
            {"project-one", "project-three", "project-four"},
        )

    def test_active_manifest_with_missing_seed_is_rejected(self) -> None:
        root = test_workspace("missing-seed")
        staging_path = root / "staging.csv"
        source_path = root / "source.csv"
        supplemental_dir = root / "supplemental"
        write_csv_atomically(staging_path, CANONICAL_FIELDS, [make_row("stage", "project-one")])
        write_csv_atomically(source_path, CANONICAL_FIELDS, [make_row("seed", "project-two")])
        import_temporary_seed(source_path, supplemental_dir)
        (supplemental_dir / "temporary_seed.csv").unlink()

        with self.assertRaisesRegex(SupplementalDataError, "missing"):
            merge_for_publication(staging_path, supplemental_dir)

    def test_inactive_manifest_skips_seed(self) -> None:
        root = test_workspace("inactive-seed")
        staging_path = root / "staging.csv"
        source_path = root / "source.csv"
        supplemental_dir = root / "supplemental"
        write_csv_atomically(staging_path, CANONICAL_FIELDS, [make_row("stage", "project-one")])
        write_csv_atomically(source_path, CANONICAL_FIELDS, [make_row("seed", "project-two")])
        import_temporary_seed(source_path, supplemental_dir)
        manifest_path = supplemental_dir / "temporary_seed_manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["active"] = False
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        result = merge_for_publication(staging_path, supplemental_dir)
        self.assertEqual(len(result.records), 1)
        self.assertFalse(result.meta["temporary_seed_active"])

    def test_legacy_byte_hash_migrates_after_newline_conversion(self) -> None:
        root = test_workspace("legacy-newlines")
        staging_path = root / "staging.csv"
        source_path = root / "source.csv"
        supplemental_dir = root / "supplemental"
        write_csv_atomically(staging_path, CANONICAL_FIELDS, [make_row("stage", "project-one")])
        write_csv_atomically(source_path, CANONICAL_FIELDS, [make_row("seed", "project-two")])
        import_temporary_seed(source_path, supplemental_dir)
        seed_path = supplemental_dir / "temporary_seed.csv"
        manifest_path = supplemental_dir / "temporary_seed_manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["sha256"] = sha256_file(seed_path)
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        seed_path.write_bytes(seed_path.read_bytes().replace(b"\r\n", b"\n"))

        result = merge_for_publication(staging_path, supplemental_dir)
        migrated_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        self.assertEqual(len(result.records), 2)
        self.assertEqual(migrated_manifest["sha256"], canonical_csv_sha256(result.records[1:]))

    def test_changed_seed_content_is_rejected_even_when_source_archive_exists(self) -> None:
        root = test_workspace("changed-seed")
        staging_path = root / "staging.csv"
        source_path = root / "source.csv"
        supplemental_dir = root / "supplemental"
        write_csv_atomically(staging_path, CANONICAL_FIELDS, [make_row("stage", "project-one")])
        write_csv_atomically(source_path, CANONICAL_FIELDS, [make_row("seed", "project-two")])
        import_temporary_seed(source_path, supplemental_dir)
        write_csv_atomically(
            supplemental_dir / "temporary_seed.csv",
            CANONICAL_FIELDS,
            [make_row("changed", "project-three")],
        )

        with self.assertRaisesRegex(SupplementalDataError, "checksum"):
            merge_for_publication(staging_path, supplemental_dir)


if __name__ == "__main__":
    unittest.main()
