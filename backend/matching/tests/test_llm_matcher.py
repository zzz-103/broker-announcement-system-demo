from __future__ import annotations

import csv
import json
import shutil
import unittest
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.llm_table.llm_markdown_table_builder import LLMApiConfig
from backend.matching import llm_matcher, project_matcher

TEST_TEMP_ROOT = (
    Path(__file__).resolve().parents[2]
    / "data"
    / "staging"
    / "llm_matching_test_tmp"
)


@dataclass
class FakeClient:
    responses: list[Any]
    model: str = "mock-model"

    def __post_init__(self) -> None:
        self.config = LLMApiConfig(base_url="mock", api_key="mock", model=self.model)
        self.calls = 0

    def request_json(self, messages: list[dict[str, str]]) -> Any:
        self.calls += 1
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class LLMMatcherTests(unittest.TestCase):
    def test_rule_unmatched_skips_llm_requests(self) -> None:
        client = FakeClient([])
        with fixture() as paths:
            paths["scores"].write_text(
                "result_notice_id,procurement_notice_id\n",
                encoding="utf-8-sig",
            )
            summary = run_fixture(paths, client)
            self.assertEqual(client.calls, 0)
            self.assertEqual(summary["skipped_count"], 1)
            self.assertEqual(summary["llm_request_count"], 0)
            self.assertEqual(summary["auto_unmatched_count"], 1)

    def test_auto_matched_when_two_passes_select_same_high_confidence_candidate(self) -> None:
        client = FakeClient([
            matched("p1", 0.98),
            matched("p1", 0.97),
        ])
        with fixture() as paths:
            summary = run_fixture(paths, client)
            self.assertEqual(summary["auto_matched_count"], 1)
            rows = read_csv(paths["output"] / "llm_verified_links.csv")
            self.assertEqual(rows[0]["final_status"], "auto_matched")
            self.assertEqual(rows[0]["procurement_notice_id"], "p1")

    def test_auto_unmatched_requires_two_successful_high_confidence_unmatched(self) -> None:
        client = FakeClient([
            unmatched(0.95),
            unmatched(0.91),
        ])
        with fixture() as paths:
            summary = run_fixture(paths, client)
            self.assertEqual(summary["auto_unmatched_count"], 1)
            unlinked = read_csv(paths["output"] / "unlinked_results.csv")
            self.assertEqual(unlinked[0]["final_status"], "result_only")

    def test_different_llm_choices_need_review(self) -> None:
        client = FakeClient([
            matched("p1", 0.99),
            matched("p2", 0.99),
        ])
        with fixture(extra_candidate=True) as paths:
            summary = run_fixture(paths, client)
            self.assertEqual(summary["needs_review_count"], 1)
            reviews = read_csv(paths["output"] / "needs_review.csv")
            self.assertIn("两次 LLM 选择候选不同", reviews[0]["review_reason"])

    def test_hard_conflict_prevents_auto_match(self) -> None:
        client = FakeClient([
            matched("p1", 0.99),
            matched("p1", 0.99),
        ])
        with fixture(procurement_date="2026-08-01") as paths:
            summary = run_fixture(paths, client)
            self.assertEqual(summary["needs_review_count"], 1)
            rows = read_csv(paths["output"] / "llm_verified_links.csv")
            self.assertEqual(rows[0]["final_status"], "needs_review")
            self.assertIn("结果日期早于采购公告", rows[0]["hard_conflict"])

    def test_llm_failure_outputs_failed_not_unmatched(self) -> None:
        client = FakeClient([
            RuntimeError("network down"),
            unmatched(0.99),
        ])
        with fixture() as paths:
            summary = run_fixture(paths, client)
            self.assertEqual(summary["failed_count"], 1)
            self.assertEqual(summary["auto_unmatched_count"], 0)
            rows = read_csv(paths["output"] / "llm_verified_links.csv")
            self.assertEqual(rows[0]["final_status"], "failed")

    def test_invalid_json_shape_outputs_failed_not_unmatched(self) -> None:
        client = FakeClient([
            {"decision": "matched", "procurement_notice_id": "outside", "confidence": 1},
            unmatched(0.99),
        ])
        with fixture() as paths:
            summary = run_fixture(paths, client)
            self.assertEqual(summary["failed_count"], 1)
            self.assertEqual(summary["auto_unmatched_count"], 0)

    def test_uses_at_most_five_candidates(self) -> None:
        client = FakeClient([
            unmatched(0.99),
            unmatched(0.99),
        ])
        with fixture(candidate_count=7) as paths:
            run_fixture(paths, client)
            self.assertEqual(client.calls, 2)
            first_prompt = json.loads(client_seen_prompt(client_index=0, output=paths["output"]))
            self.assertLessEqual(len(first_prompt["procurement_candidates"]), 5)

    def test_reads_result_and_procurement_text_from_selected_directories(self) -> None:
        client = CapturingFakeClient([
            unmatched(0.99),
            unmatched(0.99),
        ])
        with fixture() as paths:
            run_fixture(paths, client)
            prompt = json.loads(client.prompts[0])
            self.assertIn(
                "RESULT_SELECTED_MARKDOWN",
                prompt["result_announcement"]["text_excerpt"],
            )
            self.assertIn(
                "PROCUREMENT_SELECTED_MARKDOWN",
                prompt["procurement_candidates"][0]["text_excerpt"],
            )

    def test_cache_reuse_skips_llm_requests(self) -> None:
        with fixture() as paths:
            first_client = FakeClient([matched("p1", 0.99), matched("p1", 0.99)])
            first_summary = run_fixture(paths, first_client)
            self.assertEqual(first_summary["cached_count"], 0)
            second_client = FakeClient([])
            second_summary = run_fixture(paths, second_client)
            self.assertEqual(second_summary["cached_count"], 1)
            self.assertEqual(second_client.calls, 0)

    def test_confirmed_unchanged_match_skips_rule_candidates_and_llm_processing(self) -> None:
        with fixture() as paths:
            first_client = FakeClient([matched("p1", 0.99), matched("p1", 0.99)])
            run_fixture(paths, first_client)
            incremental_rules = paths["output"].parent / "incremental_rules"
            rule_summary = project_matcher.run_matcher(
                paths["procurement"],
                paths["result"],
                incremental_rules,
                5,
                verified_links_csv=paths["output"] / "llm_verified_links.csv",
                state_path=paths["output"] / "matching_state.json",
            )
            self.assertEqual(rule_summary["reused_count"], 1)
            self.assertEqual(read_csv(incremental_rules / "candidate_scores.csv"), [])
            second_client = FakeClient([])
            second_summary = llm_matcher.run_llm_matching(
                paths["result"],
                paths["procurement"],
                incremental_rules / "project_links.csv",
                incremental_rules / "candidate_scores.csv",
                paths["output"],
                second_client,
                workers=1,
                procurement_markdown_dir=paths["procurement_markdown"],
                result_markdown_dir=paths["result_markdown"],
            )
            self.assertEqual(second_summary["reused_count"], 1)
            self.assertEqual(second_client.calls, 0)

    def test_full_refresh_rejects_broad_output_dir(self) -> None:
        TEST_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        temp_dir = TEST_TEMP_ROOT / f"refresh_{uuid.uuid4().hex}"
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            output = temp_dir / "staging"
            with self.assertRaises(ValueError):
                llm_matcher.safe_full_refresh(output)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


class CapturingFakeClient(FakeClient):
    def __post_init__(self) -> None:
        super().__post_init__()
        self.prompts: list[str] = []

    def request_json(self, messages: list[dict[str, str]]) -> Any:
        self.prompts.append(messages[-1]["content"])
        return super().request_json(messages)


def matched(procurement_id: str, confidence: float) -> dict[str, Any]:
    return {
        "decision": "matched",
        "procurement_notice_id": procurement_id,
        "confidence": confidence,
        "evidence": ["字段一致"],
        "conflicts": [],
    }


def unmatched(confidence: float) -> dict[str, Any]:
    return {
        "decision": "unmatched",
        "procurement_notice_id": "",
        "confidence": confidence,
        "evidence": ["候选不足以确认"],
        "conflicts": [],
    }


class fixture:
    def __init__(
        self,
        *,
        extra_candidate: bool = False,
        procurement_date: str = "2026-05-01",
        candidate_count: int = 1,
    ) -> None:
        self.extra_candidate = extra_candidate
        self.procurement_date = procurement_date
        self.candidate_count = candidate_count
        self.temp_dir: Path | None = None
        self.paths: dict[str, Path] = {}

    def __enter__(self) -> dict[str, Path]:
        TEST_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
        root = TEST_TEMP_ROOT / f"case_{uuid.uuid4().hex}"
        root.mkdir(parents=True, exist_ok=True)
        self.temp_dir = root
        self.paths = {
            "result": root / "result.csv",
            "procurement": root / "procurement.csv",
            "links": root / "links.csv",
            "scores": root / "scores.csv",
            "output": root / "llm_matching",
            "result_markdown": root / "selected" / "result" / "notices",
            "procurement_markdown": root / "selected" / "procurement" / "notices",
        }
        self.paths["result_markdown"].mkdir(parents=True, exist_ok=True)
        self.paths["procurement_markdown"].mkdir(parents=True, exist_ok=True)
        (self.paths["result_markdown"] / "r1.md").write_text(
            "RESULT_SELECTED_MARKDOWN",
            encoding="utf-8",
        )
        (self.paths["procurement_markdown"] / "p1.md").write_text(
            "PROCUREMENT_SELECTED_MARKDOWN",
            encoding="utf-8",
        )
        write_csv(
            self.paths["result"],
            [
                {
                    "notice_id": "r1",
                    "title": "项目结果公告",
                    "project_name": "项目",
                    "project_number": "NO-1",
                    "purchaser": "采购人",
                    "package_number": "",
                    "publish_date": "2026-07-01",
                    "result_type": "winning",
                    "winner": "供应商",
                    "winner_candidates": "[]",
                    "winning_amount": "100",
                    "source_file": "r1.md",
                }
            ],
        )
        procurement_rows = []
        score_rows = []
        total = max(self.candidate_count, 2 if self.extra_candidate else 1)
        for index in range(1, total + 1):
            pid = f"p{index}"
            procurement_rows.append(
                {
                    "document_sha1": pid,
                    "project_name": f"项目{index}",
                    "project_number": "NO-1" if index == 1 else f"NO-{index}",
                    "broker_name": "采购人",
                    "publish_date": self.procurement_date,
                    "procurement_scope_summary": "采购内容",
                    "source_file": f"{pid}.md",
                }
            )
            score_rows.append(
                {
                    "result_notice_id": "r1",
                    "procurement_notice_id": pid,
                    "rank": str(index),
                    "rule_score": str(1 - index * 0.01),
                    "title_similarity": "1",
                    "project_number_match": "1" if index == 1 else "0",
                    "purchaser_match": "1",
                    "package_match": "1",
                    "date_score": "1",
                    "score_reason": "规则候选",
                    "result_project_name": "项目",
                    "procurement_project_name": f"项目{index}",
                    "result_purchaser": "采购人",
                    "procurement_purchaser": "采购人",
                    "result_package_number": "",
                    "procurement_package_number": "",
                    "result_publish_date": "2026-07-01",
                    "procurement_publish_date": self.procurement_date,
                    "result_source_file": "r1.md",
                    "procurement_source_file": f"{pid}.md",
                }
            )
        write_csv(self.paths["procurement"], procurement_rows)
        write_csv(
            self.paths["links"],
            [
                {
                    "result_notice_id": "r1",
                    "procurement_notice_id": "p1",
                    "match_status": "matched",
                    "rule_score": "0.99",
                    "score_margin": "0.2",
                }
            ],
        )
        write_csv(self.paths["scores"], score_rows)
        return self.paths

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        if self.temp_dir is not None:
            try:
                shutil.rmtree(self.temp_dir, ignore_errors=True)
            finally:
                shutil.rmtree(TEST_TEMP_ROOT, ignore_errors=True)


def run_fixture(paths: dict[str, Path], client: FakeClient) -> dict[str, Any]:
    if not isinstance(client, CapturingFakeClient):
        capture = CapturingFakeClient(client.responses, client.model)
        summary = llm_matcher.run_llm_matching(
            result_csv=paths["result"],
            procurement_csv=paths["procurement"],
            links_csv=paths["links"],
            candidate_scores_csv=paths["scores"],
            output_dir=paths["output"],
            client=capture,
            max_candidates=5,
            workers=1,
            procurement_markdown_dir=paths["procurement_markdown"],
            result_markdown_dir=paths["result_markdown"],
        )
        client.calls = capture.calls
        client.responses = capture.responses
        if capture.prompts:
            (paths["output"] / "captured_prompt.txt").write_text(capture.prompts[0], encoding="utf-8")
        return summary
    return llm_matcher.run_llm_matching(
        result_csv=paths["result"],
        procurement_csv=paths["procurement"],
        links_csv=paths["links"],
        candidate_scores_csv=paths["scores"],
        output_dir=paths["output"],
        client=client,
        max_candidates=5,
        workers=1,
        procurement_markdown_dir=paths["procurement_markdown"],
        result_markdown_dir=paths["result_markdown"],
    )


def client_seen_prompt(client_index: int, output: Path) -> str:
    return (output / "captured_prompt.txt").read_text(encoding="utf-8")


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fieldnames = list(rows[0].keys())
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


if __name__ == "__main__":
    unittest.main()
