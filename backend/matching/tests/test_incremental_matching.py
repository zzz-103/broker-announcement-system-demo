from __future__ import annotations

import unittest

from backend.matching import incremental_state, project_matcher


def procurement(
    notice_id: str,
    *,
    name: str = "交易系统建设项目",
    number: str = "P-001",
    date: str = "2026-01-01",
    sha: str | None = None,
) -> dict[str, str]:
    return {
        "notice_id": notice_id,
        "document_sha1": sha or f"sha-{notice_id}",
        "project_name": name,
        "project_number": number,
        "purchaser": "测试证券",
        "publish_date": date,
    }


def result(
    notice_id: str,
    *,
    name: str = "交易系统建设项目结果公告",
    number: str = "P-001",
    date: str = "2026-06-30",
    sha: str | None = None,
) -> dict[str, str]:
    return {
        "notice_id": notice_id,
        "document_sha1": sha or f"sha-{notice_id}",
        "title": name,
        "project_name": name,
        "project_number": number,
        "purchaser": "测试证券",
        "publish_date": date,
    }


def verified(result_id: str, status: str, procurement_id: str = "") -> dict[str, str]:
    return {
        "result_notice_id": result_id,
        "procurement_notice_id": procurement_id,
        "final_status": status,
    }


class IncrementalMatchingTests(unittest.TestCase):
    def test_stable_match_is_reused_and_only_new_result_is_processed(self) -> None:
        procurements = [procurement("p1")]
        old_result = result("r1")
        old_verified = [verified("r1", "auto_matched", "p1")]
        state = incremental_state.build_state(procurements, [old_result], old_verified)

        links, candidates, _unmatched, summary = project_matcher.match_projects(
            procurements,
            [old_result, result("r2", number="P-002", name="新项目结果公告")],
            previous_state=state,
            previous_verified_rows=old_verified,
        )

        self.assertEqual(summary["reused_count"], 1)
        self.assertEqual(summary["processed_count"], 1)
        self.assertEqual(links[0]["match_status"], "reused")
        self.assertFalse(any(row["result_notice_id"] == "r1" for row in candidates))

    def test_new_procurement_retries_only_relevant_unmatched_result(self) -> None:
        old_procurements = [procurement("old", name="无关项目", number="OLD-1")]
        unmatched_result = result("r1")
        old_verified = [verified("r1", "auto_unmatched")]
        state = incremental_state.build_state(old_procurements, [unmatched_result], old_verified)

        links, candidates, _unmatched, summary = project_matcher.match_projects(
            [*old_procurements, procurement("p1")],
            [unmatched_result],
            previous_state=state,
            previous_verified_rows=old_verified,
        )

        self.assertEqual(summary["processed_count"], 1)
        self.assertEqual(summary["reused_count"], 0)
        self.assertEqual(links[0]["procurement_notice_id"], "p1")
        self.assertIn("p1", {row["procurement_notice_id"] for row in candidates})

    def test_same_result_id_with_changed_content_is_reprocessed(self) -> None:
        procurements = [procurement("p1")]
        previous_result = result("r1", sha="old-content")
        old_verified = [verified("r1", "auto_matched", "p1")]
        state = incremental_state.build_state(procurements, [previous_result], old_verified)

        links, candidates, _unmatched, summary = project_matcher.match_projects(
            procurements,
            [result("r1", sha="changed-content")],
            previous_state=state,
            previous_verified_rows=old_verified,
        )

        self.assertEqual(summary["processed_count"], 1)
        self.assertEqual(summary["reused_count"], 0)
        self.assertNotEqual(links[0]["match_status"], "reused")
        self.assertTrue(candidates)

    def test_strict_180_day_window_excludes_older_procurement(self) -> None:
        candidates = project_matcher.recall_candidates(
            project_matcher.normalize_result(result("r1", date="2026-07-01")),
            [project_matcher.normalize_procurement(procurement("p1", date="2026-01-01"))],
            5,
        )
        self.assertEqual(candidates, [])
        boundary = project_matcher.recall_candidates(
            project_matcher.normalize_result(result("r2", date="2026-06-30")),
            [project_matcher.normalize_procurement(procurement("p2", date="2026-01-01"))],
            5,
        )
        self.assertEqual(len(boundary), 1)

    def test_dated_candidate_pool_does_not_scan_older_history(self) -> None:
        rows = [
            project_matcher.normalize_procurement(procurement("old", date="2025-01-01")),
            project_matcher.normalize_procurement(procurement("boundary", date="2026-01-01")),
            project_matcher.normalize_procurement(procurement("future", date="2026-07-01")),
            project_matcher.normalize_procurement(procurement("undated", date="")),
        ]
        pool = project_matcher.procurement_candidate_pool(
            project_matcher.normalize_result(result("r1", date="2026-06-30")),
            project_matcher.build_procurement_date_index(rows),
        )
        self.assertEqual({row.notice_id for row in pool}, {"boundary", "undated"})

    def test_missing_date_requires_and_accepts_strong_project_number(self) -> None:
        candidates = project_matcher.recall_candidates(
            project_matcher.normalize_result(result("r1", date="")),
            [project_matcher.normalize_procurement(procurement("p1", date=""))],
            5,
        )
        self.assertEqual(len(candidates), 1)
        weak = project_matcher.recall_candidates(
            project_matcher.normalize_result(result("r2", date="", number="")),
            [project_matcher.normalize_procurement(procurement("p2", date="", number="", name="交易系统采购"))],
            5,
        )
        self.assertEqual(weak, [])


if __name__ == "__main__":
    unittest.main()
