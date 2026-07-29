from __future__ import annotations

import csv
import gzip
import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from backend.api.announcement_cache import (
    AnnouncementResponseCache,
    accepts_gzip,
    etag_matches,
)


class AnnouncementResponseCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.csv_path = Path(self.temp_dir.name) / "announcement_table.csv"
        self.cache = AnnouncementResponseCache()
        self._write_rows([{"project_name": "项目A", "broker_name": "券商A"}])

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _write_rows(self, rows: list[dict[str, str]]) -> None:
        temp_path = self.csv_path.with_suffix(".tmp")
        with temp_path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["project_name", "broker_name"])
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temp_path, self.csv_path)

    def test_cached_body_is_json_equivalent_and_gzip_round_trips(self) -> None:
        first = self.cache.get(self.csv_path)
        second = self.cache.get(self.csv_path)

        self.assertIs(first, second)
        self.assertEqual(self.cache.build_count, 1)
        self.assertEqual(gzip.decompress(first.gzip_body), first.raw_body)
        payload = json.loads(first.raw_body)
        self.assertEqual(payload["records"], [{"project_name": "项目A", "broker_name": "券商A"}])
        self.assertEqual(payload["meta"]["count"], 1)

    def test_atomic_replacement_rebuilds_cache(self) -> None:
        first = self.cache.get(self.csv_path)
        self._write_rows([{"project_name": "项目B", "broker_name": "券商B"}])
        second = self.cache.get(self.csv_path)

        self.assertNotEqual(first.etag, second.etag)
        self.assertEqual(json.loads(second.raw_body)["records"][0]["project_name"], "项目B")
        self.assertEqual(self.cache.build_count, 2)

    def test_concurrent_reads_build_once(self) -> None:
        with ThreadPoolExecutor(max_workers=8) as executor:
            entries = list(executor.map(lambda _: self.cache.get(self.csv_path), range(16)))
        self.assertEqual(self.cache.build_count, 1)
        self.assertTrue(all(entry is entries[0] for entry in entries))

    def test_projection_and_entry_bound(self) -> None:
        projected = self.cache.get(self.csv_path, ("project_name",))
        self.assertEqual(
            json.loads(projected.raw_body)["records"],
            [{"project_name": "项目A"}],
        )
        second_path = Path(self.temp_dir.name) / "second.csv"
        second_path.write_text("value\n1\n", encoding="utf-8")
        self.cache.get(second_path)
        self.assertEqual(self.cache.entry_count, 2)

    def test_encoding_and_validator_helpers(self) -> None:
        self.assertTrue(accepts_gzip("br, gzip;q=0.8"))
        self.assertFalse(accepts_gzip("gzip;q=0, *;q=1"))
        self.assertFalse(accepts_gzip(None))
        self.assertTrue(etag_matches('W/"abc"', 'W/"abc"'))
        self.assertTrue(etag_matches('"abc"', 'W/"abc"'))
        self.assertFalse(etag_matches('"other"', 'W/"abc"'))


if __name__ == "__main__":
    unittest.main()
