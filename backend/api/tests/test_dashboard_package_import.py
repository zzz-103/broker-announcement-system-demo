from __future__ import annotations

import csv
import copy
import hashlib
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.api import dashboard_package as package_module
from backend.api import dashboard_package_import as import_module


class DashboardPackageImportTests(unittest.TestCase):
    @staticmethod
    def _rewrite_zip(body: bytes, replacements: dict[str, bytes], *, omit: str | None = None) -> bytes:
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(body)) as source, zipfile.ZipFile(
            output, "w", compression=zipfile.ZIP_DEFLATED
        ) as target:
            for name in source.namelist():
                if name != omit:
                    target.writestr(name, replacements.get(name, source.read(name)))
        return output.getvalue()

    def _package_zip(self, root: Path) -> bytes:
        tender = root / "announcement.csv"
        app = root / "app.csv"
        analysis = root / "ai.json"
        export = root / "dashboard-data"
        tender.write_text(
            "document_sha1,broker_name,is_broker_project,publish_date,announcement_stage,project_name\n"
            "abc123,国泰君安,true,2026-07-01,招标公告,AI平台建设项目\n",
            encoding="utf-8",
        )
        app.write_text(
            "broker_code,broker_name,app_name,source_url,publish_date,update_type,update_summary,feature_tags,highlights\n"
            "gtzq,国投证券,国投证券,https://example.com/app,2026-07-02,新功能,新增行情能力,[],[]\n",
            encoding="utf-8",
        )
        analysis.write_text('{"content":"分析","updated_at":"2026-07-03"}', encoding="utf-8")
        live_settings = SimpleNamespace(
            announcement_csv_path=tender,
            app_releases_csv_path=app,
            ai_analysis_cache_path=analysis,
            dashboard_data_export_dir=export,
        )
        with patch.object(package_module, "settings", live_settings):
            package = package_module.DashboardPackageBuilder().build(force=True)
            return package_module.package_zip_bytes(package)

    def test_validate_generated_zip_has_exact_six_members(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            body = self._package_zip(Path(directory))
            validated = import_module.validate_zip_bytes(body)
            self.assertEqual(validated.warnings, ())
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                self.assertEqual(len(archive.infolist()), 6)
                self.assertEqual(
                    set(archive.namelist()),
                    {
                        "dashboard-data/manifest.json",
                        "dashboard-data/overview.json",
                        "dashboard-data/filters.json",
                        "dashboard-data/tender_projects.json",
                        "dashboard-data/app_updates.json",
                        "dashboard-data/ai_analysis.json",
                    },
                )

    def test_invalid_tender_json_is_import_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            original = self._package_zip(Path(directory))
            source: dict[str, bytes] = {}
            with zipfile.ZipFile(io.BytesIO(original)) as archive:
                source = {name: archive.read(name) for name in archive.namelist()}
            tender_name = "dashboard-data/tender_projects.json"
            source[tender_name] = b"not-json"
            manifest = json.loads(source["dashboard-data/manifest.json"])
            metadata = manifest["datasets"]["tender_projects"]
            metadata["bytes"] = len(source[tender_name])
            import hashlib

            metadata["sha256"] = hashlib.sha256(source[tender_name]).hexdigest()
            source["dashboard-data/manifest.json"] = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for name, body in source.items():
                    archive.writestr(name, body)
            with self.assertRaisesRegex(import_module.DashboardPackageImportError, "JSON"):
                import_module.validate_zip_bytes(output.getvalue())

    def test_missing_member_incompatible_schema_and_checksum_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            body = self._package_zip(Path(directory))
            manifest_name = "dashboard-data/manifest.json"
            tender_name = "dashboard-data/tender_projects.json"
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                manifest = json.loads(archive.read(manifest_name))
            incompatible = copy.deepcopy(manifest)
            incompatible["schema_version"] = "2.0.0"
            cases = (
                self._rewrite_zip(body, {}, omit="dashboard-data/app_updates.json"),
                self._rewrite_zip(body, {manifest_name: json.dumps(incompatible).encode("utf-8")}),
                self._rewrite_zip(body, {tender_name: b"[]\n"}),
            )
            for invalid in cases:
                with self.subTest(size=len(invalid)), self.assertRaises(import_module.DashboardPackageImportError):
                    import_module.validate_zip_bytes(invalid)

    def test_empty_required_dataset_is_rejected_and_old_duplicate_ids_warn(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            body = self._package_zip(Path(directory))
            manifest_name = "dashboard-data/manifest.json"
            overview_name = "dashboard-data/overview.json"
            tender_name = "dashboard-data/tender_projects.json"
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                manifest = json.loads(archive.read(manifest_name))
                overview = json.loads(archive.read(overview_name))
                rows = json.loads(archive.read(tender_name))

            empty_body = b"[]\n"
            empty_manifest = copy.deepcopy(manifest)
            empty_manifest["datasets"]["tender_projects"].update(
                {"record_count": 0, "bytes": len(empty_body), "sha256": hashlib.sha256(empty_body).hexdigest()}
            )
            empty_overview = copy.deepcopy(overview)
            empty_overview["tender_projects"].update({"record_count": 0, "broker_count": 0, "fintech_count": 0, "period": None})
            empty_overview_body = json.dumps(empty_overview).encode("utf-8")
            empty_manifest["datasets"]["overview"].update(
                {"bytes": len(empty_overview_body), "sha256": hashlib.sha256(empty_overview_body).hexdigest()}
            )
            empty_zip = self._rewrite_zip(body, {
                manifest_name: json.dumps(empty_manifest).encode("utf-8"),
                overview_name: empty_overview_body,
                tender_name: empty_body,
            })
            with self.assertRaisesRegex(import_module.DashboardPackageImportError, "非空"):
                import_module.validate_zip_bytes(empty_zip)

            duplicate_body = (json.dumps(rows + rows, ensure_ascii=False) + "\n").encode("utf-8")
            duplicate_manifest = copy.deepcopy(manifest)
            duplicate_manifest["datasets"]["tender_projects"].update(
                {"record_count": 2, "bytes": len(duplicate_body), "sha256": hashlib.sha256(duplicate_body).hexdigest()}
            )
            duplicate_overview = copy.deepcopy(overview)
            duplicate_overview["tender_projects"]["record_count"] = 2
            duplicate_overview_body = json.dumps(duplicate_overview).encode("utf-8")
            duplicate_manifest["datasets"]["overview"].update(
                {"bytes": len(duplicate_overview_body), "sha256": hashlib.sha256(duplicate_overview_body).hexdigest()}
            )
            duplicate_zip = self._rewrite_zip(body, {
                manifest_name: json.dumps(duplicate_manifest).encode("utf-8"),
                overview_name: duplicate_overview_body,
                tender_name: duplicate_body,
            })
            self.assertTrue(import_module.validate_zip_bytes(duplicate_zip).warnings)

    def test_persist_imported_atomically_sets_preference_and_backup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            body = self._package_zip(root)
            target = root / "imported-dashboard-data.zip"
            preference = root / "source-preference.json"
            fake_settings = SimpleNamespace(
                dashboard_data_imported_zip_path=target,
                dashboard_data_source_preference_path=preference,
            )
            with patch.object(import_module, "settings", fake_settings):
                import_module.imported_package_store.invalidate()
                first = import_module.persist_imported(body)
                self.assertEqual(first.package.manifest["schema_version"], "1.0.0")
                self.assertEqual(import_module.read_preference(), ("imported", None))
                self.assertTrue(target.exists())
                import_module.persist_imported(body)
                self.assertTrue(target.with_name("imported-dashboard-data.zip.bak").exists())

    def test_invalid_second_import_keeps_package_and_preference(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            body = self._package_zip(root)
            target = root / "imported-dashboard-data.zip"
            preference = root / "source-preference.json"
            fake_settings = SimpleNamespace(
                dashboard_data_imported_zip_path=target,
                dashboard_data_source_preference_path=preference,
            )
            with patch.object(import_module, "settings", fake_settings):
                import_module.persist_imported(body)
                before_body = target.read_bytes()
                before_preference = preference.read_bytes()
                with self.assertRaises(import_module.DashboardPackageImportError):
                    import_module.persist_imported(b"not-a-zip")
                self.assertEqual(target.read_bytes(), before_body)
                self.assertEqual(preference.read_bytes(), before_preference)

    def test_source_status_falls_back_between_live_and_imported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            body = self._package_zip(root)
            validated = import_module.validate_zip_bytes(body)
            target = root / "imported-dashboard-data.zip"
            preference = root / "source-preference.json"
            fake_settings = SimpleNamespace(
                dashboard_data_imported_zip_path=target,
                dashboard_data_source_preference_path=preference,
            )
            with patch.object(import_module, "settings", fake_settings):
                target.write_bytes(body)
                import_module.write_preference("live")
                import_module.imported_package_store.invalidate()
                live_bad_manifest = copy.deepcopy(validated.package.manifest)
                for key in ("tender_projects", "app_updates"):
                    live_bad_manifest["datasets"][key]["available"] = False
                    live_bad_manifest["datasets"][key]["record_count"] = 0
                live_bad = package_module.DashboardPackage(live_bad_manifest, validated.package.artifacts)
                status = import_module.source_status(live_bad)
                self.assertEqual(status["active_source"], "imported")
                self.assertIn("回退", status["fallback_reason"] or "")

                import_module.write_preference("imported")
                target.write_bytes(b"not-a-zip")
                import_module.imported_package_store.invalidate()
                status = import_module.source_status(validated.package)
                self.assertEqual(status["active_source"], "live")
                self.assertIn("回退", status["fallback_reason"] or "")

    def test_tender_collision_ids_are_stable_when_rows_reverse(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "announcement.csv"
            header = "document_sha1,broker_name,is_broker_project,publish_date,announcement_stage,project_name\n"
            rows = [
                "same,国泰君安,true,2026-07-01,招标公告,项目甲\n",
                "same,国泰君安,true,2026-07-02,结果公告,项目乙\n",
            ]
            path.write_text(header + "".join(rows), encoding="utf-8")
            first = package_module._build_tenders(path)
            path.write_text(header + "".join(reversed(rows)), encoding="utf-8")
            second = package_module._build_tenders(path)
            self.assertEqual({row["id"] for row in first}, {row["id"] for row in second})
            self.assertNotIn("same", {row["id"] for row in first})


if __name__ == "__main__":
    unittest.main()
