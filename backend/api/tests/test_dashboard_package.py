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
    @staticmethod
    def _write_app_rows(path: Path, rows: list[dict[str, str]]) -> None:
        fields = [
            "broker_code", "broker_name", "app_name", "source_url", "content_sha256",
            "crawl_time", "app_version", "platform", "publish_date", "update_type",
            "update_summary", "feature_tags", "highlights", "processed_at",
        ]
        with path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)

    def test_fintech_system_titles_override_noisy_non_fintech_metadata(self) -> None:
        cases = (
            (
                "中信证券联合风控系统信创及适配升级采购",
                "工程建设与装修",
                "其他",
                "中信证券联合风控系统信创及适配升级采购",
                "网络安全与监管科技",
            ),
            (
                "中信证券恒生 NanoExpress 期货行情系统软件-26年度续签",
                "工程建设与装修",
                "其他",
                "中信证券恒生 NanoExpress 期货行情系统软件-26年度续签",
                "投研资讯与金融数据",
            ),
            (
                "世纪证券有限责任公司投行质控内核等改造需求项目采购中选公示",
                "工程建设与装修",
                "其他",
                "世纪证券有限责任公司投行质控内核等改造需求项目采购中选公示",
                "投行与资本市场",
            ),
            (
                "华西证券股份有限公司智能风控助手建设项目",
                "工程建设与装修",
                "其他",
                "华西证券股份有限公司智能风控助手建设项目采购公告",
                "网络安全与监管科技",
            ),
            (
                "ARC异常交易事前风控程序化新规改造采购项目",
                "工程建设与装修",
                "其他",
                "ARC异常交易事前风控程序化新规改造采购项目采购结果公告",
                "网络安全与监管科技",
            ),
        )
        for project, subcategory, category, scope_summary, expected_domain in cases:
            self.assertEqual(
                module._classify(project, subcategory, category, scope_summary),
                (expected_domain, True),
            )

    def test_non_fintech_project_is_not_promoted_by_generic_object_words(self) -> None:
        self.assertEqual(
            module._classify("办公区装修项目", "工程建设与装修", "其他", "办公区装修施工"),
            ("非金融科技及其他", False),
        )

    def test_sparse_financial_titles_are_promoted_without_category_metadata(self) -> None:
        cases = (
            ("2026年二季度顶点财富管家系统升级改造项目", "财富管理与客户经营"),
            ("聚安一站通系统（含VTM）开户及业务权限开通流程改造项目", "APP与数字化渠道"),
            ("国泰海通2026年财务风险识别系统数据采购项目", "网络安全与监管科技"),
            ("浙商证券股份有限公司全链路流量分析维护服务采购项目", "网络安全与监管科技"),
            ("深交所交易网关连续竞价网络优化服务询比", "交易、柜台与核心系统"),
            ("营运管理部财务账套电子附件自动采集RPA需求项目", "IT运维与技术服务"),
            ("新基金绩效分析系统信创改造项目", "财富管理与客户经营"),
            ("企业微信会话存档账号采购项目", "网络安全与监管科技"),
        )
        for project, expected_domain in cases:
            self.assertEqual(
                module._classify(project, "", "工程建设与装修", project, False),
                (expected_domain, True),
            )

    def test_expanded_hard_exclusions_remain_non_fintech(self) -> None:
        cases = (
            "中信建投证券2026年荣耀应用市场投放项目",
            "国泰海通证券2026年金融数据港公共区域联动安保服务",
            "华能长城资管集团公司法务系统服务项目",
            "关于固定资产管理系统开发的请示",
            "中信证券2026年量化比赛系统采购",
            "中信建投证券新一代财务总账系统采购项目",
            "国泰君安证券2026年投顾IP孵化与巨量引擎推广代理框架协议",
        )
        for project in cases:
            self.assertEqual(
                module._classify(project, "", "IT软硬件", project, True),
                ("非金融科技及其他", False),
            )

    def test_advertising_words_do_not_override_a_customer_platform_context(self) -> None:
        self.assertEqual(
            module._classify(
                "中信证券股份有限公司智能获客管理平台项目",
                "业务系统与软件",
                "IT软硬件",
                "采购智能获客管理平台，实现人群洞察、智能投放与闭环优化",
                True,
            ),
            ("财富管理与客户经营", True),
        )
        self.assertEqual(
            module._classify(
                "信息流平台流量运营项目",
                "营销与投研数据",
                "专业及金融服务",
                "采购广告平台信息流广告投放服务",
                True,
            ),
            ("非金融科技及其他", False),
        )
        self.assertEqual(
            module._classify(
                "浙商证券与北京天相财富管理顾问有限公司广告投放采购项目",
                "",
                "专业及金融服务",
                "广告投放采购服务",
                True,
            ),
            ("非金融科技及其他", False),
        )

    def test_public_source_url_rejects_local_paths_but_keeps_web_links(self) -> None:
        self.assertEqual(module._public_source_url("https://example.com/app"), "https://example.com/app")
        self.assertEqual(module._public_source_url("file:///Users/test/private.json"), "")
        self.assertEqual(module._public_source_url("http://127.0.0.1:8000/internal"), "")
        self.assertEqual(module._public_source_url("https://user:secret@example.com/app"), "")
        self.assertEqual(module._public_source_name("data/raw/markdown/internal.md"), "公开招采数据")
        self.assertEqual(module._public_source_name(""), "公开招采数据")

    def test_app_updates_merge_same_version_across_platforms_and_snapshots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.csv"
            self._write_app_rows(
                path,
                [
                    {
                        "broker_code": "GTZQ", "broker_name": "安信证券", "app_name": "国投证券",
                        "source_url": "https://example.com/android", "content_sha256": "android-old",
                        "crawl_time": "2026-08-01T00:00:00Z", "app_version": "v9.7.0", "platform": "安卓",
                        "publish_date": "2026-07-31", "update_type": "体验优化", "update_summary": "运行环境：需要 Android 6.0 或更高版本",
                        "feature_tags": '["行情"]', "highlights": '["文件大小：120 MB"]', "processed_at": "2026-08-01T00:00:00Z",
                    },
                    {
                        "broker_code": "gtzq", "broker_name": "国投证券", "app_name": "国投证券",
                        "source_url": "https://example.com/ios", "content_sha256": "ios-new",
                        "crawl_time": "2026-08-04T00:00:00Z", "app_version": "9.7.0", "platform": "苹果",
                        "publish_date": "2026-08-03", "update_type": "新功能", "update_summary": "新增行情自选分组功能",
                        "feature_tags": '["行情", "交易"]', "highlights": '["支持自定义行情分组"]', "processed_at": "2026-08-04T00:00:00Z",
                    },
                    {
                        "broker_code": "gtzq", "broker_name": "国投证券", "app_name": "国投证券",
                        "source_url": "https://example.com/android", "content_sha256": "android-new",
                        "crawl_time": "2026-08-04T00:00:00Z", "app_version": "9.7.0", "platform": "Android",
                        "publish_date": "2026-08-03", "update_type": "新功能", "update_summary": "新增行情自选分组功能",
                        "feature_tags": '["行情"]', "highlights": '["支持自定义行情分组"]', "processed_at": "2026-08-04T00:00:00Z",
                    },
                ],
            )
            records = module._build_app_updates(path)
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["app_version"], "9.7.0")
            self.assertEqual(records[0]["platform"], "全平台")
            self.assertEqual(records[0]["publish_date"], "2026-08-03")
            self.assertEqual(records[0]["update_summary"], "新增行情自选分组功能")
            self.assertEqual(records[0]["highlights"], ["支持自定义行情分组"])
            self.assertEqual(records[0]["broker_name"], "国投证券")

    def test_low_value_app_text_cannot_win_representative_summary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.csv"
            self._write_app_rows(
                path,
                [
                    {
                        "broker_code": "gtzq", "broker_name": "国投证券", "app_name": "国投证券",
                        "source_url": "https://example.com/old", "content_sha256": "old",
                        "crawl_time": "2026-08-01", "app_version": "9.7.0", "platform": "Android",
                        "publish_date": "2026-08-01", "update_type": "其他", "update_summary": "软件介绍：国投证券APP是一款提供行情和交易服务的平台",
                        "feature_tags": "[]", "highlights": '["运行环境：需要 Android 6.0 或更高版本", "文件大小：120 MB"]', "processed_at": "2026-08-01",
                    },
                    {
                        "broker_code": "gtzq", "broker_name": "国投证券", "app_name": "国投证券",
                        "source_url": "https://example.com/new", "content_sha256": "new",
                        "crawl_time": "2026-08-02", "app_version": "9.7.0", "platform": "Android",
                        "publish_date": "2026-08-02", "update_type": "体验优化", "update_summary": "优化登录流程，提升交易稳定性",
                        "feature_tags": "[]", "highlights": '["修复部分行情刷新失败问题"]', "processed_at": "2026-08-02",
                    },
                ],
            )
            record = module._build_app_updates(path)[0]
            self.assertEqual(record["update_summary"], "优化登录流程，提升交易稳定性")
            self.assertEqual(record["highlights"], ["修复部分行情刷新失败问题"])
            self.assertNotIn("运行环境", record["search_text"])
            self.assertNotIn("文件大小", record["search_text"])

    def test_unversioned_records_use_conservative_platform_and_snapshot_keys(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.csv"
            common = {
                "broker_code": "gtzq", "broker_name": "国投证券", "app_name": "国投证券",
                "source_url": "https://example.com/app", "crawl_time": "2026-08-01",
                "app_version": "", "publish_date": "2026-08-01", "update_type": "体验优化",
                "feature_tags": "[]", "highlights": "[]", "processed_at": "2026-08-01",
            }
            rows = [
                {**common, "content_sha256": "same", "platform": "Android", "update_summary": "优化行情加载速度"},
                {**common, "content_sha256": "same", "platform": "Android", "update_summary": "优化行情加载速度"},
                {**common, "content_sha256": "different", "platform": "Android", "update_summary": "新增行情筛选功能"},
                {**common, "content_sha256": "same", "platform": "iOS", "update_summary": "优化行情加载速度"},
            ]
            self._write_app_rows(path, rows)
            records = module._build_app_updates(path)
            self.assertEqual(len(records), 3)
            self.assertEqual(len({record["id"] for record in records}), 3)
            self.assertEqual({record["platform"] for record in records}, {"Android", "iOS"})
            self.assertIn("新增行情筛选功能", {record["update_summary"] for record in records})

    def test_app_update_ids_are_stable_and_unique_after_grouping(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "first.csv"
            second = root / "second.csv"
            rows = [
                {
                    "broker_code": "gtzq", "broker_name": "国投证券", "app_name": "国投证券",
                    "source_url": "https://example.com/app", "content_sha256": "a", "crawl_time": "2026-08-01",
                    "app_version": "1.0.0", "platform": "Android", "publish_date": "2026-08-01",
                    "update_type": "新功能", "update_summary": "新增交易入口", "feature_tags": "[]", "highlights": "[]", "processed_at": "2026-08-01",
                },
                {
                    "broker_code": "gtzq", "broker_name": "国投证券", "app_name": "国投证券",
                    "source_url": "https://example.com/app", "content_sha256": "b", "crawl_time": "2026-08-02",
                    "app_version": "2.0.0", "platform": "Android", "publish_date": "2026-08-02",
                    "update_type": "升级", "update_summary": "优化交易流程", "feature_tags": "[]", "highlights": "[]", "processed_at": "2026-08-02",
                },
            ]
            self._write_app_rows(first, rows)
            self._write_app_rows(second, list(reversed(rows)))
            first_records = module._build_app_updates(first)
            second_records = module._build_app_updates(second)
            self.assertEqual({record["id"] for record in first_records}, {record["id"] for record in second_records})
            self.assertEqual(len({record["id"] for record in first_records}), 2)

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
