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
from backend.broker_app_watch.storage.models import APP_RELEASE_CSV_COLUMNS
from backend.matching import project_matcher
from backend.llm_table import llm_markdown_table_builder as table_builder


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

    def test_validate_generated_zip_has_complete_app_watch_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            body = self._package_zip(Path(directory))
            validated = import_module.validate_zip_bytes(body)
            self.assertEqual(validated.warnings, ())
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                self.assertEqual(len(archive.infolist()), 7)
                self.assertEqual(
                    set(archive.namelist()),
                    {
                        "dashboard-data/manifest.json",
                        "dashboard-data/overview.json",
                        "dashboard-data/filters.json",
                        "dashboard-data/tender_projects.json",
                        "dashboard-data/app_updates.json",
                        "dashboard-data/ai_analysis.json",
                        "dashboard-data/app_watch_baseline.csv",
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

    def test_duplicate_app_events_warn_and_invalid_app_arrays_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            body = self._package_zip(Path(directory))
            names = {
                "manifest": "dashboard-data/manifest.json",
                "overview": "dashboard-data/overview.json",
                "apps": "dashboard-data/app_updates.json",
            }
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                manifest = json.loads(archive.read(names["manifest"]))
                overview = json.loads(archive.read(names["overview"]))
                apps = json.loads(archive.read(names["apps"]))
            apps[0]["app_version"] = "9.7.0"

            duplicate_apps_body = (json.dumps(apps + apps, ensure_ascii=False) + "\n").encode("utf-8")
            duplicate_manifest = copy.deepcopy(manifest)
            duplicate_manifest["datasets"]["app_updates"].update({
                "record_count": 2,
                "bytes": len(duplicate_apps_body),
                "sha256": hashlib.sha256(duplicate_apps_body).hexdigest(),
            })
            duplicate_overview = copy.deepcopy(overview)
            duplicate_overview["app_updates"]["record_count"] = 2
            duplicate_overview_body = json.dumps(duplicate_overview).encode("utf-8")
            duplicate_manifest["datasets"]["overview"].update({
                "bytes": len(duplicate_overview_body),
                "sha256": hashlib.sha256(duplicate_overview_body).hexdigest(),
            })
            duplicate_zip = self._rewrite_zip(body, {
                names["manifest"]: json.dumps(duplicate_manifest).encode("utf-8"),
                names["overview"]: duplicate_overview_body,
                names["apps"]: duplicate_apps_body,
            })
            warnings = import_module.validate_zip_bytes(duplicate_zip).warnings
            self.assertTrue(any("重复 App id" in warning for warning in warnings))
            self.assertTrue(any("重复 App 版本事件" in warning for warning in warnings))

            invalid_apps = copy.deepcopy(apps)
            invalid_apps[0]["highlights"] = "not-an-array"
            invalid_apps_body = json.dumps(invalid_apps, ensure_ascii=False).encode("utf-8")
            invalid_manifest = copy.deepcopy(manifest)
            invalid_manifest["datasets"]["app_updates"].update({
                "bytes": len(invalid_apps_body),
                "sha256": hashlib.sha256(invalid_apps_body).hexdigest(),
            })
            invalid_zip = self._rewrite_zip(body, {
                names["manifest"]: json.dumps(invalid_manifest).encode("utf-8"),
                names["apps"]: invalid_apps_body,
            })
            with self.assertRaisesRegex(import_module.DashboardPackageImportError, "字符串数组"):
                import_module.validate_zip_bytes(invalid_zip)

    def test_persist_imported_atomically_sets_preference_and_backup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            body = self._package_zip(root)
            target = root / "imported-dashboard-data.zip"
            preference = root / "source-preference.json"
            fake_settings = SimpleNamespace(
                dashboard_data_imported_zip_path=target,
                dashboard_data_source_preference_path=preference,
                app_releases_csv_path=root / "app-releases.csv",
                imported_matching_baseline_path=root / "matching-baseline.json",
            )
            with patch.object(import_module, "settings", fake_settings):
                import_module.imported_package_store.invalidate()
                first = import_module.persist_imported(body)
                self.assertEqual(first.package.manifest["schema_version"], "1.0.0")
                self.assertEqual(import_module.read_preference(), ("imported", None))
                self.assertTrue(target.exists())
                self.assertTrue((root / "current-dashboard-data.zip").exists())
                import_module.persist_imported(body)
                self.assertTrue(target.with_name("imported-dashboard-data.zip.bak").exists())

    def test_full_package_restores_incremental_matching_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tender = root / "announcement.csv"
            app = root / "app.csv"
            analysis = root / "ai.json"
            procurement = root / "source" / "announcement_table.csv"
            result = root / "source" / "result_table.csv"
            verified = root / "source" / "llm_verified_links.csv"
            state = root / "source" / "matching_state.json"
            procurement.parent.mkdir(parents=True)
            procurement_markdown = "# 交易系统建设项目\n\n采购正文"
            result_markdown = "# 交易系统建设项目结果公告\n\n结果正文"
            procurement_sha = table_builder.sha1_text(
                table_builder.normalized_markdown_body(procurement_markdown)
            )
            result_sha = table_builder.sha1_text(
                table_builder.normalized_markdown_body(result_markdown)
            )
            tender.write_text(
                "document_sha1,broker_name,is_broker_project,publish_date,announcement_stage,project_name\n"
                "p1,测试证券,true,2026-01-01,采购公告,交易系统建设项目\n",
                encoding="utf-8",
            )
            app.write_text(
                "broker_code,broker_name,app_name,source_url,publish_date,update_type,update_summary,feature_tags,highlights\n"
                "test,测试证券,测试App,https://example.com/app,2026-01-02,新功能,更新,[],[]\n",
                encoding="utf-8",
            )
            analysis.write_text('{"content":null,"updated_at":null,"meta":null}', encoding="utf-8")
            procurement.write_text(
                "notice_id,document_sha1,broker_folder,markdown_file,project_name,project_number,purchaser,publish_date\n"
                f"p1,{procurement_sha},test,p1.md,交易系统建设项目,P-1,测试证券,2026-01-01\n",
                encoding="utf-8",
            )
            result.write_text(
                "notice_id,document_sha1,broker_folder,markdown_file,title,project_name,project_number,purchaser,publish_date\n"
                f"r1,{result_sha},test,r1.md,交易系统建设项目结果公告,交易系统建设项目,P-1,测试证券,2026-02-01\n",
                encoding="utf-8",
            )
            verified.write_text(
                "result_notice_id,procurement_notice_id,final_status,result_source_file,procurement_source_file\n"
                "r1,p1,auto_matched,/srv/private/r1.md,C:\\\\private\\\\p1.md\n",
                encoding="utf-8",
            )
            export_settings = SimpleNamespace(
                announcement_csv_path=tender,
                app_releases_csv_path=app,
                ai_analysis_cache_path=analysis,
                dashboard_data_export_dir=root / "export",
                matching_procurement_csv_path=procurement,
                matching_result_csv_path=result,
                matching_verified_links_path=verified,
                matching_state_path=state,
            )
            with patch.object(package_module, "settings", export_settings):
                package = package_module.DashboardPackageBuilder().build(force=True)
                body = package_module.package_zip_bytes(package)
            self.assertTrue(package.manifest["matching_baseline"]["available"])
            baseline_payload = json.loads(package.matching_baseline_body or b"{}")
            self.assertEqual(baseline_payload["verified_links"][0]["result_source_file"], "r1.md")
            self.assertEqual(baseline_payload["verified_links"][0]["procurement_source_file"], "p1.md")
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                self.assertIn("dashboard-data/matching_baseline.json", archive.namelist())

            restored = root / "restored"
            import_settings = SimpleNamespace(
                dashboard_data_imported_zip_path=restored / "imported.zip",
                dashboard_data_source_preference_path=restored / "preference.json",
                matching_procurement_csv_path=restored / "staging" / "announcement_table.csv",
                matching_result_csv_path=restored / "staging" / "result" / "result_table.csv",
                matching_verified_links_path=restored / "staging" / "llm_matching" / "llm_verified_links.csv",
                matching_state_path=restored / "staging" / "llm_matching" / "matching_state.json",
                imported_matching_baseline_path=restored / "staging" / "imported_matching_baseline.json",
                app_releases_csv_path=restored / "app-releases.csv",
            )
            with patch.object(import_module, "settings", import_settings):
                validated = import_module.persist_imported(body)
            self.assertIsNotNone(validated.matching_baseline)
            summary = project_matcher.run_matcher(
                import_settings.matching_procurement_csv_path,
                import_settings.matching_result_csv_path,
                restored / "matching",
                5,
                verified_links_csv=import_settings.matching_verified_links_path,
                state_path=import_settings.matching_state_path,
            )
            self.assertEqual(summary["reused_count"], 1)
            self.assertEqual(summary["processed_count"], 0)
            selected = restored / "selected" / "test" / "p1.md"
            selected.parent.mkdir(parents=True)
            selected.write_text(procurement_markdown, encoding="utf-8")
            existing_rows = table_builder.load_existing_output_rows(
                import_settings.matching_procurement_csv_path.parent,
                output_stem="announcement_table",
            )
            selection = table_builder.select_files_for_processing(
                [selected],
                import_settings.matching_procurement_csv_path.parent,
                incremental=True,
                overwrite=False,
                existing_rows=existing_rows,
            )
            self.assertEqual(selection.plans, [])
            self.assertEqual(selection.skipped_files, [selected])

    def test_invalid_second_import_keeps_package_and_preference(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            body = self._package_zip(root)
            target = root / "imported-dashboard-data.zip"
            preference = root / "source-preference.json"
            fake_settings = SimpleNamespace(
                dashboard_data_imported_zip_path=target,
                dashboard_data_source_preference_path=preference,
                app_releases_csv_path=root / "app-releases.csv",
                imported_matching_baseline_path=root / "matching-baseline.json",
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

    def test_import_restores_app_history_and_promotes_only_updated_dataset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def build_package(folder: str, tender_id: str, app_hash: str, version: str) -> tuple[package_module.DashboardPackage, bytes]:
                source = root / folder
                source.mkdir()
                tender = source / "announcement.csv"
                app = source / "app.csv"
                analysis = source / "ai.json"
                tender.write_text(
                    "document_sha1,broker_name,is_broker_project,publish_date,announcement_stage,project_name\n"
                    f"{tender_id},测试证券,true,2026-08-01,招标公告,{tender_id}项目\n",
                    encoding="utf-8",
                )
                app.write_text(
                    ",".join(APP_RELEASE_CSV_COLUMNS) + "\n"
                    + f"test,测试证券,测试App,https://example.com/app,{app_hash},2026-08-02T00:00:00+08:00,raw/test/app.md,2026-08-02T01:00:00+08:00,{version},Android,2026-08-02,新功能,新增交易能力,[] ,[]\n",
                    encoding="utf-8",
                )
                analysis.write_text('{"content":"分析","updated_at":"2026-08-02","meta":null}', encoding="utf-8")
                build_settings = SimpleNamespace(
                    announcement_csv_path=tender,
                    app_releases_csv_path=app,
                    ai_analysis_cache_path=analysis,
                    dashboard_data_export_dir=source / "export",
                )
                with patch.object(package_module, "settings", build_settings):
                    package = package_module.DashboardPackageBuilder().build(force=True)
                return package, package_module.package_zip_bytes(package)

            base_package, base_body = build_package("base", "base-tender", "a" * 64, "1.0.0")
            live_package, _ = build_package("live", "live-tender", "b" * 64, "2.0.0")
            imported = root / "imported.zip"
            working = root / "current.zip"
            restored_app = root / "runtime" / "app_releases.csv"
            settings = SimpleNamespace(
                dashboard_data_imported_zip_path=imported,
                dashboard_data_working_zip_path=working,
                dashboard_data_source_preference_path=root / "preference.json",
                app_releases_csv_path=restored_app,
                imported_matching_baseline_path=root / "imported_matching.json",
            )
            with patch.object(import_module, "settings", settings):
                import_module.imported_package_store.invalidate()
                imported_result = import_module.persist_imported(base_body)
                self.assertFalse(imported_result.app_watch_baseline_synthesized)
                restored_text = restored_app.read_text(encoding="utf-8-sig")
                self.assertIn("a" * 64, restored_text)
                self.assertIn("https://example.com/app", restored_text)
                original_body = imported.read_bytes()
                origin = import_module.immutable_origin_path(base_body)
                self.assertEqual(origin.read_bytes(), base_body)

                manifest = import_module.promote_active_imported_package(
                    live_package,
                    {"app_updates"},
                )
                self.assertIsNotNone(manifest)
                self.assertEqual(imported.read_bytes(), original_body)
                self.assertEqual(origin.read_bytes(), base_body)
                self.assertTrue(working.is_file())
                current, error, _ = import_module.imported_package_store.inspect()
                self.assertIsNone(error)
                self.assertIsNotNone(current)
                assert current is not None
                self.assertEqual(
                    json.loads(current.body("tender_projects"))[0]["id"],
                    json.loads(base_package.body("tender_projects"))[0]["id"],
                )
                app_versions = {row["app_version"] for row in json.loads(current.body("app_updates"))}
                self.assertEqual(app_versions, {"1.0.0", "2.0.0"})
                app_history = import_module.validate_app_watch_baseline(
                    current.app_watch_baseline_body or b""
                )
                self.assertEqual({row.content_sha256 for row in app_history}, {"a" * 64, "b" * 64})

    def test_corrupt_working_package_falls_back_to_immutable_import(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            body = self._package_zip(root)
            settings = SimpleNamespace(
                dashboard_data_imported_zip_path=root / "imported.zip",
                dashboard_data_working_zip_path=root / "current.zip",
                dashboard_data_source_preference_path=root / "preference.json",
                app_releases_csv_path=root / "app-releases.csv",
                imported_matching_baseline_path=root / "matching.json",
            )
            with patch.object(import_module, "settings", settings):
                import_module.imported_package_store.invalidate()
                import_module.persist_imported(body)
                settings.dashboard_data_working_zip_path.write_bytes(b"corrupt")
                import_module.imported_package_store.invalidate()
                package, error, warnings = import_module.imported_package_store.inspect()
                self.assertIsNotNone(package)
                self.assertIsNone(error)
                self.assertTrue(any("回退不可变原始导入包" in warning for warning in warnings))

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
