from __future__ import annotations

import csv
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.api import dashboard_package as module


class DashboardPackageTests(unittest.TestCase):
    def test_public_source_url_rejects_local_paths_but_keeps_web_links(self) -> None:
        self.assertEqual(module._public_source_url("https://example.com/app"), "https://example.com/app")
        self.assertEqual(module._public_source_url("file:///Users/test/private.json"), "")
        self.assertEqual(module._public_source_url("http://127.0.0.1:8000/internal"), "")
        self.assertEqual(module._public_source_url("https://user:secret@example.com/app"), "")
        self.assertEqual(module._public_source_name("data/raw/markdown/internal.md"), "公开招采数据")

    def test_builder_normalizes_records_and_exports_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tender_path = root / "announcement.csv"
            app_path = root / "app.csv"
            ai_path = root / "ai.json"
            export_path = root / "dashboard-data"

            with tender_path.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(
                    handle,
                    fieldnames=[
                        "document_sha1",
                        "broker_name",
                        "is_broker_project",
                        "publish_date",
                        "announcement_stage",
                        "project_name",
                        "procurement_category",
                        "project_subcategory",
                        "procurement_method",
                        "budget_amount_yuan",
                        "winning_supplier",
                        "raw_json_path",
                    ],
                )
                writer.writeheader()
                writer.writerow(
                    {
                        "document_sha1": "abc123",
                        "broker_name": "国泰君安",
                        "is_broker_project": "true",
                        "publish_date": "2026/07/01",
                        "announcement_stage": "招标公告",
                        "project_name": "AI平台建设项目招标公告",
                        "procurement_category": "IT软硬件",
                        "project_subcategory": "人工智能",
                        "procurement_method": "公开招标",
                        "budget_amount_yuan": "1000000",
                        "winning_supplier": "供应商甲",
                        "raw_json_path": "/private/internal.json",
                    }
                )
            with app_path.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(
                    handle,
                    fieldnames=[
                        "broker_code",
                        "broker_name",
                        "app_name",
                        "source_url",
                        "publish_date",
                        "update_type",
                        "update_summary",
                        "feature_tags",
                        "highlights",
                    ],
                )
                writer.writeheader()
                writer.writerow(
                    {
                        "broker_code": "gtzq",
                        "broker_name": "国投证券",
                        "app_name": "国投证券",
                        "source_url": "https://example.com/app",
                        "publish_date": "2026-07-02",
                        "update_type": "新功能",
                        "update_summary": "新增行情能力",
                        "feature_tags": '["行情"]',
                        "highlights": '["支持新行情"]',
                    }
                )
            ai_path.write_text(json.dumps({"content": "分析", "updated_at": "2026-07-03T00:00:00Z"}), encoding="utf-8")

            fake_settings = SimpleNamespace(
                announcement_csv_path=tender_path,
                app_releases_csv_path=app_path,
                ai_analysis_cache_path=ai_path,
                dashboard_data_export_dir=export_path,
            )
            with patch.object(module, "settings", fake_settings):
                builder = module.DashboardPackageBuilder()
                package = builder.build(force=True)
                self.assertEqual(package.manifest["schema_version"], "1.0.0")
                self.assertEqual(package.manifest["datasets"]["tender_projects"]["record_count"], 1)
                tender = json.loads(package.body("tender_projects"))[0]
                self.assertEqual(tender["broker_name"], "国泰海通证券")
                self.assertEqual(tender["announcement_stage"], "采购招标")
                self.assertNotIn("raw_json_path", tender)
                builder.export(package)

            manifest = json.loads((export_path / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["datasets"]["app_updates"]["record_count"], 1)
            self.assertEqual(json.loads((export_path / "ai_analysis.json").read_text(encoding="utf-8"))["updated_at"], "2026-07-03T00:00:00Z")
            with zipfile.ZipFile(export_path.with_suffix(".zip")) as archive:
                self.assertIn("dashboard-data/manifest.json", archive.namelist())
                self.assertIn("dashboard-data/tender_projects.json", archive.namelist())

    def test_optional_app_and_ai_sources_are_marked_unavailable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tender_path = root / "announcement.csv"
            tender_path.write_text("broker_name,project_name\n券商甲,项目甲\n", encoding="utf-8")
            fake_settings = SimpleNamespace(
                announcement_csv_path=tender_path,
                app_releases_csv_path=root / "missing-app.csv",
                ai_analysis_cache_path=root / "missing-ai.json",
                dashboard_data_export_dir=root / "dashboard-data",
            )
            with patch.object(module, "settings", fake_settings):
                package = module.DashboardPackageBuilder().build(force=True)
            self.assertFalse(package.manifest["datasets"]["app_updates"]["available"])
            self.assertFalse(package.manifest["datasets"]["ai_analysis"]["available"])
            self.assertEqual(json.loads(package.body("app_updates")), [])


if __name__ == "__main__":
    unittest.main()
