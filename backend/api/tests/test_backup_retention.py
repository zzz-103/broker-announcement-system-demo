from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.api.main import prune_old_announcement_backups


class BackupRetentionTests(unittest.TestCase):
    def test_only_strictly_matching_old_backups_are_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            target = directory / "announcement_table.csv"
            target.write_text("active", encoding="utf-8")
            valid_names = [
                "announcement_table-20260710-010101.backup.csv",
                "announcement_table-20260710-020202.backup.csv",
                "announcement_table-20260710-030303.backup.csv",
                "announcement_table-20260710-040404.backup.csv",
            ]
            unrelated_names = [
                "other-20260710-010101.backup.csv",
                "announcement_table-20260710-010101.csv",
                "announcement_table-20260710-010101.backup.xlsx",
                ".announcement_table.123.publish.tmp.csv",
                "staging.csv",
            ]
            for name in [*valid_names, *unrelated_names]:
                (directory / name).write_text(name, encoding="utf-8")

            removed = prune_old_announcement_backups(target, retention=2)

            self.assertEqual(
                set(removed),
                {
                    "announcement_table-20260710-010101.backup.csv",
                    "announcement_table-20260710-020202.backup.csv",
                },
            )
            self.assertTrue(target.exists())
            self.assertTrue(all((directory / name).exists() for name in unrelated_names))
            self.assertTrue((directory / valid_names[2]).exists())
            self.assertTrue((directory / valid_names[3]).exists())


if __name__ == "__main__":
    unittest.main()
