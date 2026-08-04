from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from backend.api import custom_intelligence_service as service
from backend.api.custom_intelligence_service import normalize_report, normalize_sources
from backend.api.custom_intelligence_store import ActiveExecutionError, IntelligenceNotFoundError, IntelligenceStore
from backend.api.qianfan_search import (
    QianfanReference,
    QianfanConfigurationError,
    QianfanSearchClient,
    QianfanSearchResult,
    QianfanTimeoutError,
    build_search_payload,
    parse_search_response,
    probe_auth_headers,
)


class CustomIntelligenceCoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runtime_dir = tempfile.TemporaryDirectory()
        os.environ["USER_DB_PATH"] = str(Path(self.runtime_dir.name) / "users.db")
        os.environ.pop("CUSTOM_INTELLIGENCE_DB_PATH", None)
        self.store = IntelligenceStore()
        self.store.ensure_schema()

    def tearDown(self) -> None:
        self.runtime_dir.cleanup()

    def test_owner_is_stable_integer_and_private(self) -> None:
        topic = self.store.create_topic(
            0,
            {
                "name": "管理员主题",
                "description": "证券行业动态",
                "keywords": [],
                "focus_objects": [],
                "analysis_perspective": "industry_research",
                "time_range": "month",
                "source_preference": "balanced",
                "specified_sites": [],
                "report_type": "industry_trends",
                "analysis_depth": "standard",
                "extra_requirements": "",
            },
            0,
        )
        self.assertEqual(topic["owner_user_id"], 0)
        with self.assertRaises(IntelligenceNotFoundError):
            self.store.get_topic(7, int(topic["id"]))
        updated = self.store.update_topic(
            0,
            int(topic["id"]),
            {**topic, "name": "管理员主题（更新）", "analysis_depth": "deep"},
            0,
        )
        self.assertEqual(updated["analysis_depth"], "deep")
        disabled = self.store.set_topic_enabled(0, int(topic["id"]), False, 0)
        self.assertFalse(disabled["enabled"])

    def test_deep_analysis_only_changes_top_k(self) -> None:
        for depth, top_k in (("concise", 6), ("standard", 8), ("deep", 10)):
            payload = build_search_payload("test", top_k=top_k)
            self.assertFalse(payload["enable_deep_search"])
            self.assertEqual(payload["resource_type_filter"][0]["top_k"], top_k)
            self.assertNotIn("max_search_query_num", payload)
            self.assertEqual(payload["search_source"], "baidu_search_v2")
            self.assertEqual(payload["search_mode"], "required")

    def test_search_payload_uses_top_level_instruction_and_v2_site_filter(self) -> None:
        payload = build_search_payload(
            "test",
            instruction="return text",
            specified_sites=["example.com", "news.example.com"],
        )
        self.assertEqual(payload["messages"], [{"role": "user", "content": "test"}])
        self.assertEqual(payload["instruction"], "return text")
        self.assertEqual(
            payload["search_filter"],
            {"match": {"site": ["example.com", "news.example.com"]}},
        )

    def test_auth_probe_and_official_response_fields(self) -> None:
        self.assertEqual(probe_auth_headers(lambda header: 400 if header == "Authorization" else 401), "Authorization")
        result = parse_search_response(
            {
                "request_Id": "request-1",
                "choices": [{"message": {"content": "answer"}}],
                "followup_queries": ["继续关注什么？"],
                "references": [
                    {"id": "ref-1", "title": "来源", "url": "https://example.com", "website": "示例网"}
                ],
            }
        )
        self.assertEqual(result.request_id, "request-1")
        self.assertEqual(result.followups, ["继续关注什么？"])
        self.assertEqual(result.references[0].site_name, "示例网")

    def test_client_configuration_missing_and_timeout_are_controlled(self) -> None:
        with patch.dict(os.environ, {"BAIDU_QIANFAN_API_KEY": "", "BAIDU_QIANFAN_MODEL": ""}):
            with self.assertRaises(QianfanConfigurationError):
                QianfanSearchClient().search(build_search_payload("test"))
        with (
            patch.dict(
                os.environ,
                {"BAIDU_QIANFAN_API_KEY": "test-only", "BAIDU_QIANFAN_MODEL": "test-model"},
            ),
            patch("backend.api.qianfan_search.httpx.Client.post", side_effect=httpx.ReadTimeout("timeout")),
        ):
            with self.assertRaises(QianfanTimeoutError):
                QianfanSearchClient().search(build_search_payload("test"))
        timeout_response = httpx.Response(
            502,
            json={"requestId": "request-timeout"},
            request=httpx.Request("POST", "https://example.com"),
        )
        with (
            patch.dict(
                os.environ,
                {"BAIDU_QIANFAN_API_KEY": "test-only", "BAIDU_QIANFAN_MODEL": "test-model"},
            ),
            patch("backend.api.qianfan_search.httpx.Client.post", return_value=timeout_response),
        ):
            with self.assertRaises(QianfanTimeoutError) as raised:
                QianfanSearchClient().search(build_search_payload("test"))
        self.assertEqual(raised.exception.request_id, "request-timeout")

    def test_source_aliases_preserve_provider_ids(self) -> None:
        result = QianfanSearchResult(
            answer="",
            references=[
                QianfanReference("r1", "同一来源", "https://example.com/a"),
                QianfanReference("r2", "同一来源", "https://example.com/a/"),
            ],
        )
        sources, aliases = normalize_sources(result)
        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0]["provider_reference_ids"], ["r1", "r2"])
        self.assertEqual(aliases, {"r1": "source-1", "r2": "source-1"})

    def test_duplicate_provider_id_does_not_create_duplicate_canonical_ids(self) -> None:
        result = QianfanSearchResult(
            answer="",
            references=[
                QianfanReference("r1", "来源一", "https://example.com/A"),
                QianfanReference("r1", "来源二", "https://other.example.com/B"),
                QianfanReference("r2", "大小写路径不同", "https://example.com/a"),
            ],
        )
        sources, aliases = normalize_sources(result)
        self.assertEqual([source["id"] for source in sources], ["source-1", "source-2"])
        self.assertEqual(sources[0]["provider_reference_ids"], ["r1"])
        self.assertEqual(aliases, {"r1": "source-1", "r2": "source-2"})

    def test_report_text_is_cleaned_and_invalid_json_falls_back(self) -> None:
        sources = [{"id": "r1", "provider_reference_ids": ["r1"], "title": "T", "url": "https://example.com"}]
        report = normalize_report("<script>alert(1)</script>plain", {"question": "q", "time_range": "month"}, sources, {"r1": "r1"}, [], "now")
        self.assertNotIn("<script>", json.dumps(report, ensure_ascii=False))
        self.assertEqual(report["valid_source_count"], 1)

    def test_html_entities_are_cleaned_before_persistence(self) -> None:
        report = normalize_report(
            "&lt;strong&gt;结论&lt;/strong&gt;",
            {"question": "q", "time_range": "month"},
            [],
            {},
            [],
            "now",
        )
        self.assertEqual(report["core_conclusion"], "结论")

    def test_execution_success_failure_and_duplicate_guard(self) -> None:
        snapshot = {
            "question": "近期证券行业变化",
            "analysis_perspective": "industry_research",
            "time_range": "month",
            "source_preference": "balanced",
            "report_type": "industry_trends",
            "analysis_depth": "concise",
        }
        succeeded = self.store.create_execution(5, snapshot, "instant", 5, original_query=snapshot["question"])
        with self.assertRaises(ActiveExecutionError):
            self.store.create_execution(5, snapshot, "instant", 5, original_query=snapshot["question"])
        fake_result = QianfanSearchResult(
            answer="综合结论",
            references=[QianfanReference("ref-1", "来源", "https://example.com")],
            request_id="request-1",
        )
        with patch.object(service.client, "search", return_value=fake_result):
            service._run_execution(int(succeeded["id"]))
        stored = self.store.get_execution(5, int(succeeded["id"]))
        self.assertEqual(stored["status"], "succeeded")
        self.assertEqual(stored["request_id"], "request-1")
        self.assertEqual(len(stored["sources"]), 1)

        failed = self.store.create_execution(5, snapshot, "rerun", 5, original_query=snapshot["question"])
        with patch.object(service.client, "search", side_effect=RuntimeError("secret upstream detail")):
            service._run_execution(int(failed["id"]))
        failed_stored = self.store.get_execution(5, int(failed["id"]))
        self.assertEqual(failed_stored["status"], "failed")
        self.assertNotIn("secret upstream detail", str(failed_stored["error_message"]))


if __name__ == "__main__":
    unittest.main()
