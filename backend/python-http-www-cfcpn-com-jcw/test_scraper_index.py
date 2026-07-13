from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


SCRAPER_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRAPER_ROOT))
SPEC = importlib.util.spec_from_file_location("cfcpn_scraper_cli", SCRAPER_ROOT / "cfcpn_scraper.py")
if SPEC is None or SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("failed to load scraper module")
scraper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scraper)


class ScraperIndexTests(unittest.TestCase):
    def test_single_scan_supplies_existing_paths_resume_metadata_and_index(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            notices_dir = root / "notices"
            notices_dir.mkdir()
            notice_path = notices_dir / "2026-07-10_a_notice.md"
            notice_path.write_text(
                """---
notice_id: "notice-1"
notice_type: "procurement"
keyword: "证券"
title: "测试公告"
publish_time: "2026-07-10 09:00:00"
purchaser: "测试券商"
region: "深圳"
---

# 测试公告
""",
                encoding="utf-8",
            )

            paths, records = scraper.scan_existing_notices(notices_dir, "procurement")
            self.assertEqual(paths["procurement:notice-1"], notice_path)
            self.assertEqual(records["notice-1"]["keyword"], "证券")
            self.assertEqual(records["notice-1"]["publish_time"], "2026-07-10 09:00:00")

            index_path = root / "index.md"
            scraper.rebuild_index(records, index_path)
            index_text = index_path.read_text(encoding="utf-8")
            self.assertIn("测试公告", index_text)
            self.assertIn("notices/2026-07-10_a_notice.md", index_text)

    def test_legacy_procurement_notice_type_remains_supported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            notices_dir = Path(temp_dir)
            (notices_dir / "legacy.md").write_text(
                """---
notice_id: "legacy-1"
title: "旧公告"
publish_time: "2026-01-01"
---
""",
                encoding="utf-8",
            )
            paths, _ = scraper.scan_existing_notices(notices_dir, "procurement")
            self.assertIn("procurement:legacy-1", paths)


if __name__ == "__main__":
    unittest.main()
