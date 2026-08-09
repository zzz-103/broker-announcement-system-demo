from __future__ import annotations

import unittest

from backend.api.supplemental_seed import _normalize_legacy_business_system_fields
from backend.matching.project_merger import standalone_result_classification, standalone_result_row


class FintechClassificationTests(unittest.TestCase):
    def test_standalone_financial_system_result_is_enriched(self) -> None:
        cases = [
            (
                "联合风控系统信创及适配升级采购",
                "网络安全与监管科技",
                "升级改造",
            ),
            (
                "恒生NanoExpress期货行情系统软件-26年度续签",
                "投研资讯与金融数据",
                "续采续约",
            ),
        ]
        for title, _expected_domain, expected_action in cases:
            result = {"project_name": title, "title": f"{title} - 采购结果公告"}
            classification = standalone_result_classification(result)
            self.assertEqual(classification["procurement_category"], "IT软硬件")
            self.assertEqual(classification["project_subcategory"], "业务系统与软件")
            self.assertEqual(classification["procurement_action"], expected_action)
            self.assertEqual(classification["procurement_scope_summary"], title)
            published = standalone_result_row(result, "result-id")
            self.assertEqual(published["procurement_category"], "IT软硬件")
            self.assertEqual(published["project_subcategory"], "业务系统与软件")

    def test_legacy_investment_banking_system_label_is_normalized(self) -> None:
        row = {
            "procurement_category": "专业及金融服务",
            "project_subcategory": "投行与资本市场",
            "project_name": "世纪证券投行质控内核等改造需求项目",
            "procurement_scope_summary": "世纪证券投行质控内核等改造需求项目",
        }
        _normalize_legacy_business_system_fields(row)
        self.assertEqual(row["procurement_category"], "IT软硬件")
        self.assertEqual(row["project_subcategory"], "业务系统与软件")

    def test_non_fintech_result_is_not_promoted_by_upgrade_word(self) -> None:
        classification = standalone_result_classification(
            {"project_name": "办公楼装修升级采购项目", "title": "办公楼装修升级采购项目"}
        )
        self.assertEqual(classification, {})


if __name__ == "__main__":
    unittest.main()
