from __future__ import annotations

import csv
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api import main
from backend.api.supplemental_seed import CANONICAL_FIELDS
from backend.matching import project_merger


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


class MergedPublicationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="merged_publication_")
        self.root = Path(self.temp_dir.name)
        self.final_dir = self.root / "final"
        self.target_path = self.root / "announcement_table.csv"
        self.supplemental_dir = self.root / "supplemental"
        self.environment = patch.dict(
            os.environ,
            {
                "ADMIN_USERNAME": "merged-publication-admin",
                "ADMIN_PASSWORD": "merged-publication-password",
                "MATCHING_MERGED_OUTPUT_DIR": str(self.final_dir),
                "ANNOUNCEMENT_CSV_PATH": str(self.target_path),
                "SUPPLEMENTAL_DATA_DIR": str(self.supplemental_dir),
                "ANNOUNCEMENT_BACKUP_RETENTION": "3",
            },
            clear=False,
        )
        self.environment.start()
        main.session_tokens.clear()
        main.announcement_response_cache.invalidate(self.target_path)
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        main.session_tokens.clear()
        self.environment.stop()
        self.temp_dir.cleanup()

    def admin_headers(self) -> dict[str, str]:
        with patch.object(main, "write_audit_event_safely", return_value=False):
            response = self.client.post(
                "/api/login",
                json={"username": "merged-publication-admin", "password": "merged-publication-password"},
            )
        self.assertEqual(response.status_code, 200)
        return {"Authorization": f"Bearer {response.json()['token']}"}

    def test_publish_uses_merged_output_and_keeps_budget_and_verified_result_fields(self) -> None:
        procurement_csv = self.root / "procurement.csv"
        result_csv = self.root / "result.csv"
        links_csv = self.root / "llm_verified_links.csv"
        procurement_fields = [field for field in CANONICAL_FIELDS if field not in {
            "is_broker_project",
            "result_notice_id",
            "result_title",
            "result_type",
            "result_status",
            "result_publish_date",
            "winner",
            "winner_candidates",
            "winning_amount",
            "result_match_method",
            "result_match_confidence",
            "result_notice_count",
            "result_history_json",
        }]
        procurement = {
            "broker_folder": "notices",
            "markdown_file": "procurement.md",
            "document_sha1": "procurement-1",
            "processed_at": "2026-07-14T00:00:00+00:00",
            "raw_json_path": "staging/raw/procurement.json",
            "broker_name": "测试证券",
            "publish_date": "2026-07-01",
            "announcement_stage": "采购招标",
            "procurement_category": "IT软硬件",
            "project_subcategory": "网络",
            "project_name": "测试网络采购项目",
            "procurement_method": "公开招标",
            "procurement_action": "新购",
            "procurement_scope_summary": "测试采购范围",
            "budget_amount_yuan": "2327300",
            "ceiling_price_yuan": "",
            "winning_amount_yuan": "",
            "bid_deadline_at": "2026-07-20",
            "service_period_months": "",
            "delivery_period_days": "",
            "winning_supplier": "",
        }
        write_csv(procurement_csv, procurement_fields, [procurement])
        result_fields = [
            "notice_id", "document_sha1", "title", "publish_date", "project_name", "project_number",
            "purchaser", "package_number", "result_type", "result_status", "winner",
            "winner_candidates", "winning_amount",
        ]
        write_csv(
            result_csv,
            result_fields,
            [
                {
                    "notice_id": "result-verified",
                    "document_sha1": "result-verified-sha",
                    "title": "测试网络采购项目中标候选人公示",
                    "publish_date": "2026-07-10",
                    "project_name": "测试网络采购项目",
                    "project_number": "P-001",
                    "purchaser": "测试证券",
                    "package_number": "",
                    "result_type": "candidate",
                    "result_status": "候选人公示",
                    "winner": "",
                    "winner_candidates": '["候选供应商甲", "候选供应商乙"]',
                    "winning_amount": "1980000",
                },
                {
                    "notice_id": "result-review",
                    "document_sha1": "result-review-sha",
                    "title": "不应覆盖的结果公告",
                    "publish_date": "2026-07-11",
                    "project_name": "测试网络采购项目",
                    "project_number": "P-001",
                    "purchaser": "测试证券",
                    "package_number": "",
                    "result_type": "winning",
                    "result_status": "已中标",
                    "winner": "错误供应商",
                    "winner_candidates": "[]",
                    "winning_amount": "9999999",
                },
            ],
        )
        link_fields = [
            "result_notice_id", "procurement_notice_id", "final_status", "first_decision",
            "first_procurement_notice_id", "first_confidence", "second_decision",
            "second_procurement_notice_id", "second_confidence", "hard_conflict",
        ]
        write_csv(
            links_csv,
            link_fields,
            [
                {
                    "result_notice_id": "result-verified",
                    "procurement_notice_id": "procurement-1",
                    "final_status": "auto_matched",
                    "first_decision": "matched",
                    "first_procurement_notice_id": "procurement-1",
                    "first_confidence": "0.99",
                    "second_decision": "matched",
                    "second_procurement_notice_id": "procurement-1",
                    "second_confidence": "0.98",
                    "hard_conflict": "false",
                },
                {
                    "result_notice_id": "result-review",
                    "procurement_notice_id": "procurement-1",
                    "final_status": "needs_review",
                    "first_decision": "matched",
                    "first_procurement_notice_id": "procurement-1",
                    "first_confidence": "0.99",
                    "second_decision": "matched",
                    "second_procurement_notice_id": "procurement-1",
                    "second_confidence": "0.99",
                    "hard_conflict": "false",
                },
            ],
        )
        project_merger.run_merger(procurement_csv, result_csv, links_csv, self.final_dir)
        write_csv(self.target_path, CANONICAL_FIELDS, [{field: "" for field in CANONICAL_FIELDS}])

        headers = self.admin_headers()
        publish_response = self.client.post("/api/data/announcements/publish", headers=headers)
        self.assertEqual(publish_response.status_code, 200)
        self.assertIsNotNone(publish_response.json()["meta"]["backup_file"])

        published_rows = read_csv(self.target_path)
        self.assertEqual(len(published_rows), 2)
        published = next(row for row in published_rows if row["result_notice_id"] == "result-verified")
        self.assertEqual(published["budget_amount_yuan"], "2327300")
        self.assertEqual(published["winner_candidates"], '["候选供应商甲", "候选供应商乙"]')
        self.assertEqual(published["winning_amount"], "1980000")
        self.assertEqual(published["result_notice_id"], "result-verified")
        self.assertNotEqual(published["winning_amount"], "9999999")

        standalone = next(row for row in published_rows if row["result_notice_id"] == "result-review")
        self.assertEqual(standalone["announcement_stage"], "结果公示")
        self.assertEqual(standalone["result_match_method"], "unmatched_result_notice")
        self.assertEqual(standalone["project_name"], "测试网络采购项目")

        data_response = self.client.get("/api/data/announcements", headers=headers)
        self.assertEqual(data_response.status_code, 200)
        record = next(
            row for row in data_response.json()["records"] if row["result_notice_id"] == "result-verified"
        )
        self.assertEqual(record["budget_amount_yuan"], "2327300")
        self.assertEqual(record["winner_candidates"], '["候选供应商甲", "候选供应商乙"]')
        self.assertEqual(record["winning_amount"], "1980000")


if __name__ == "__main__":
    unittest.main()
