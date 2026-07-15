from __future__ import annotations

import csv
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.api.supplemental_seed import CANONICAL_FIELDS
from backend.llm_table.llm_markdown_table_builder import LLMApiConfig
from backend.matching import llm_matcher, project_matcher, project_merger


@dataclass
class MockClient:
    responses: list[dict[str, Any]]

    def __post_init__(self) -> None:
        self.config = LLMApiConfig(base_url="mock", api_key="mock", model="p13-smoke-mock")
        self.calls = 0

    def request_json(self, messages: list[dict[str, str]]) -> dict[str, Any]:
        self.calls += 1
        return self.responses.pop(0)


def decision(kind: str, procurement_id: str = "", confidence: float = 0.99) -> dict[str, Any]:
    return {
        "decision": kind,
        "procurement_notice_id": procurement_id,
        "confidence": confidence,
        "evidence": ["mock evidence"],
        "conflicts": [],
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


class P13PipelineSmokeTest(unittest.TestCase):
    def test_mock_pipeline_is_conservative_and_summaries_match_outputs(self) -> None:
        with tempfile.TemporaryDirectory(prefix="p13_smoke_") as temp_name:
            root = Path(temp_name)
            procurement_csv = root / "procurement.csv"
            result_csv = root / "result.csv"
            matching_dir = root / "matching"
            llm_dir = root / "llm_matching"
            final_dir = root / "final"

            duplicate = {
                "document_sha1": "p1",
                "project_name": "证券交易平台采购项目",
                "project_number": "P-001",
                "broker_name": "测试证券",
                "package_number": "",
                "publish_date": "2026-06-01",
                "procurement_scope_summary": "交易平台",
                "budget_amount_yuan": "2327300",
                "source_file": str(root / "p1.md"),
            }
            write_csv(
                procurement_csv,
                [
                    duplicate,
                    dict(duplicate),
                    {**duplicate, "document_sha1": "pm", "project_name": "证券机房采购项目第一包", "project_number": "P-002", "package_number": "第一包"},
                    {**duplicate, "document_sha1": "pm", "project_name": "证券机房采购项目第二包", "project_number": "P-002", "package_number": "第二包"},
                ],
            )
            results = [
                self.result("r1", "证券交易平台采购项目结果公告", "证券交易平台采购项目", "P-001"),
                self.result("r2", "证券机房采购项目结果公告", "证券机房采购项目", "P-002"),
                self.result("r3", "无对应采购的证券项目结果公告", "无对应采购的证券项目", "P-999"),
            ]
            write_csv(result_csv, results)

            matcher_summary = project_matcher.run_matcher(procurement_csv, result_csv, matching_dir, 3)
            candidates = read_csv(matching_dir / "candidate_scores.csv")
            self.assertTrue(all(sum(row["result_notice_id"] == rid for row in candidates) <= 3 for rid in {r["notice_id"] for r in results}))

            client = MockClient(
                [
                    decision("matched", "p1", 0.99), decision("matched", "p1", 0.98),
                    decision("matched", "pm", 0.80), decision("matched", "pm", 0.80),
                    decision("unmatched", confidence=0.99), decision("unmatched", confidence=0.99),
                ]
            )
            llm_summary = llm_matcher.run_llm_matching(
                result_csv, procurement_csv,
                matching_dir / "project_links.csv", matching_dir / "candidate_scores.csv",
                llm_dir, client, max_candidates=3, workers=1,
            )
            verified = read_csv(llm_dir / "llm_verified_links.csv")
            self.assertEqual(client.calls, 6)
            self.assertEqual(llm_summary["auto_matched_count"], sum(r["final_status"] == "auto_matched" for r in verified))
            self.assertEqual(llm_summary["needs_review_count"], 1)
            self.assertEqual(llm_summary["auto_unmatched_count"], 1)

            merge_summary = project_merger.run_merger(procurement_csv, result_csv, llm_dir / "llm_verified_links.csv", final_dir)
            accepted = read_csv(final_dir / "accepted_links.csv")
            excluded = read_csv(final_dir / "excluded_results.csv")
            merged = read_csv(final_dir / "announcement_table_merged_test.csv")
            with (final_dir / "announcement_table_merged_test.csv").open(
                "r", encoding="utf-8-sig", newline=""
            ) as file:
                self.assertEqual(next(csv.reader(file)), CANONICAL_FIELDS)
            self.assertEqual(merge_summary["deduplicated_count"], 1)
            self.assertEqual(len(merged), 3)
            self.assertEqual(merge_summary["accepted_link_count"], len(accepted))
            self.assertEqual(merge_summary["excluded_link_count"], len(excluded))
            self.assertEqual(len(accepted), 1)
            self.assertFalse(any(row["result_notice_id"] == "r2" for row in accepted))
            merged_record = next(row for row in merged if row["document_sha1"] == "p1")
            self.assertEqual(merged_record["budget_amount_yuan"], "2327300")
            self.assertEqual(merged_record["winner"], "测试供应商")
            self.assertEqual(merged_record["winning_amount"], "100")
            self.assertIsNone(project_merger.resolve_procurement_row(results[1], project_merger.prepare_rows(read_csv(procurement_csv))[1]["pm"]))
            self.assertEqual(matcher_summary["result_count"], 3)
            self.assertEqual(
                {path.name for path in final_dir.iterdir()},
                {"announcement_table_merged_test.csv", "accepted_links.csv", "excluded_results.csv", "run_summary.json"},
            )

    @staticmethod
    def result(notice_id: str, title: str, project_name: str, project_number: str) -> dict[str, str]:
        return {
            "notice_id": notice_id,
            "document_sha1": f"sha-{notice_id}",
            "title": title,
            "project_name": project_name,
            "project_number": project_number,
            "purchaser": "测试证券",
            "package_number": "",
            "publish_date": "2026-07-01",
            "result_type": "winning",
            "result_status": "completed",
            "winner": "测试供应商",
            "winner_candidates": "[]",
            "winning_amount": "100",
            "source_file": str(Path("missing") / f"{notice_id}.md"),
        }


if __name__ == "__main__":
    unittest.main()
