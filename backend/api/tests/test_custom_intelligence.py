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
    QianfanDisabledError,
    QianfanSearchClient,
    QianfanSearchResult,
    QianfanTimeoutError,
    build_search_payload,
    effective_search_config,
    parse_search_response,
    validate_configuration,
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

    def test_topic_list_includes_latest_execution_and_blocks_active_delete(self) -> None:
        topic = self.store.create_topic(
            5,
            {
                "name": "跟踪主题",
                "question": "关注什么",
                "description": "",
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
            5,
        )
        execution = self.store.create_execution(
            5,
            {"question": "关注什么"},
            "topic",
            5,
            topic_id=int(topic["id"]),
            topic_name=str(topic["name"]),
            original_query="关注什么",
        )
        topics = self.store.list_topics(5)
        self.assertEqual(topics[0]["latest_execution"]["id"], execution["id"])
        with self.assertRaises(ActiveExecutionError):
            self.store.delete_topic(5, int(topic["id"]))

    def test_deep_analysis_only_changes_top_k(self) -> None:
        for depth, top_k in (("concise", 10), ("standard", 20), ("deep", 30)):
            payload = build_search_payload("test", top_k=top_k)
            self.assertEqual(payload["resource_type_filter"][0]["top_k"], top_k)
            self.assertEqual(payload["search_source"], "baidu_search_v2")
            self.assertNotIn("model", payload)
            self.assertNotIn("search_mode", payload)
            self.assertEqual(payload["search_recency_filter"], "month")

        self.assertEqual(build_search_payload("test")["resource_type_filter"][0]["top_k"], 20)
        self.assertEqual(build_search_payload("test", top_k=100)["resource_type_filter"][0]["top_k"], 50)

    def test_search_payload_uses_concise_query_and_v2_site_filter(self) -> None:
        payload = build_search_payload(
            "test",
            specified_sites=["example.com", "news.example.com"],
        )
        self.assertEqual(payload["messages"], [{"role": "user", "content": "test"}])
        self.assertNotIn("instruction", payload)
        self.assertEqual(
            payload["search_filter"],
            {"match": {"site": ["example.com", "news.example.com"]}},
        )

    def test_admin_config_wins_and_disabled_overrides_env(self) -> None:
        with patch.dict(
            os.environ,
            {
                "BAIDU_QIANFAN_API_KEY": "env-key",
                "BAIDU_QIANFAN_ENDPOINT": "https://env.example.com",
            },
        ):
            self.assertEqual(effective_search_config().config_source, "env")
            self.store.save_search_config(
                enabled=False,
                endpoint="https://db.example.com",
                auth_header="X-Appbuilder-Authorization",
                timeout_seconds=30,
                updated_by_user_id=0,
            )
            config = effective_search_config()
            self.assertEqual(config.config_source, "admin")
            self.assertFalse(config.enabled)
            self.assertEqual(config.api_key, "env-key")
            self.assertEqual(config.auth_header, "X-Appbuilder-Authorization")
            self.assertEqual(
                config.endpoint,
                "https://qianfan.baidubce.com/v2/ai_search/web_search",
            )
            with self.assertRaises(QianfanDisabledError):
                validate_configuration()

    def test_options_payload_reflects_service_status(self) -> None:
        with patch.dict(
            os.environ,
            {
                "BAIDU_QIANFAN_API_KEY": "env-key",
                "BAIDU_QIANFAN_ENDPOINT": "https://env.example.com",
            },
        ):
            options = service.options_payload()
            self.assertTrue(options["service_enabled"])
            self.assertEqual(options["service_status"], "enabled")

    def test_options_payload_exposes_source_limits_and_depth_label(self) -> None:
        options = service.options_payload()
        self.assertEqual(
            options["max_sources_by_depth"],
            {"concise": 10, "standard": 20, "deep": 30},
        )
        depth_labels = {item["value"]: item["label"] for item in options["analysis_depths"]}
        self.assertEqual(depth_labels["deep"], "深度研究")

    def test_execution_payload_uses_depth_source_limit(self) -> None:
        fake_result = QianfanSearchResult(
            answer="综合结论",
            references=[QianfanReference("ref-1", "来源", "https://example.com")],
        )
        seen_payloads: list[dict[str, object]] = []

        def fake_search(payload: dict[str, object]) -> QianfanSearchResult:
            seen_payloads.append(payload)
            return fake_result

        for depth, expected_top_k in (("standard", 20), ("deep", 30)):
            snapshot = {
                "question": "近期证券行业变化",
                "analysis_perspective": "industry_research",
                "time_range": "month",
                "source_preference": "authoritative",
                "report_type": "industry_trends",
                "analysis_depth": depth,
            }
            execution = self.store.create_execution(
                5,
                snapshot,
                "instant",
                5,
                original_query=snapshot["question"],
            )
            with (
                patch.object(service.client, "search", side_effect=fake_search),
                patch.object(service, "_request_analysis", return_value={"title": "报告", "core_conclusion": "结论"}),
            ):
                service._run_execution(int(execution["id"]))

            self.assertEqual(
                seen_payloads[-1]["resource_type_filter"][0]["top_k"],
                expected_top_k,
            )
            self.assertNotIn("source_preference", seen_payloads[-1])

    def test_disabled_service_blocks_execution_before_creation(self) -> None:
        self.store.save_search_config(
            enabled=False,
            endpoint="https://db.example.com",
            auth_header="Authorization",
            timeout_seconds=30,
            updated_by_user_id=0,
        )
        before = self.store.list_executions(5)[0]
        snapshot = {
            "question": "近期证券行业变化",
            "analysis_perspective": "industry_research",
            "time_range": "month",
            "source_preference": "balanced",
            "report_type": "industry_trends",
            "analysis_depth": "concise",
        }
        with self.assertRaises(QianfanDisabledError):
            service.submit_execution(
                5,
                snapshot,
                5,
                trigger_type="instant",
            )
        after = self.store.list_executions(5)[0]
        self.assertEqual(len(after), len(before))

    def test_official_response_fields(self) -> None:
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
        with patch.dict(os.environ, {"BAIDU_QIANFAN_API_KEY": ""}):
            with self.assertRaises(QianfanConfigurationError):
                QianfanSearchClient().search(build_search_payload("test"))
        with (
            patch.dict(
                os.environ,
                {"BAIDU_QIANFAN_API_KEY": "test-only"},
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
                {"BAIDU_QIANFAN_API_KEY": "test-only"},
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
        report = normalize_report(
            "<script>alert(1)</script>plain",
            {"question": "q", "time_range": "month", "report_type": "industry_trends"},
            sources,
            {"r1": "r1"},
            [],
            "now",
            "request-fallback",
        )
        self.assertNotIn("<script>", json.dumps(report, ensure_ascii=False))
        self.assertEqual(report["valid_source_count"], 1)
        self.assertTrue(report["is_fallback"])
        self.assertEqual(report["report_type"], "industry_trends")
        self.assertEqual(report["request_id"], "request-fallback")
        self.assertEqual(report["core_conclusion"], "alert(1)plain")

    def test_deterministic_report_fields_override_model_values(self) -> None:
        snapshot = {
            "question": "原始问题",
            "time_range": "month",
            "report_type": "industry_trends",
        }
        sources = [{"id": "r1", "provider_reference_ids": ["r1"], "title": "T", "url": "https://example.com"}]
        answer = json.dumps(
            {
                "title": "模型标题",
                "question": "模型问题",
                "executed_at": "模型时间",
                "time_range": "year",
                "valid_source_count": 99,
                "report_type": "risk_monitoring",
                "service": "other",
                "request_id": "模型ID",
                "core_conclusion": "结论",
            },
            ensure_ascii=False,
        )
        report = normalize_report(
            answer,
            snapshot,
            sources,
            {"r1": "r1"},
            [],
            "2026-08-06T00:00:00Z",
            "request-real",
        )
        self.assertEqual(report["question"], "原始问题")
        self.assertEqual(report["executed_at"], "2026-08-06T00:00:00Z")
        self.assertEqual(report["time_range"], "month")
        self.assertEqual(report["valid_source_count"], 1)
        self.assertEqual(report["report_type"], "industry_trends")
        self.assertEqual(report["service"], "baidu_web_search+llm")
        self.assertEqual(report["search_service"], "baidu_web_search")
        self.assertEqual(report["analysis_service"], "openai_compatible_llm")
        self.assertEqual(report["request_id"], "request-real")
        self.assertFalse(report["is_fallback"])

    def test_report_missing_core_conclusion_uses_fallback(self) -> None:
        report = normalize_report(
            '{"title":"只有标题"}',
            {"question": "q", "time_range": "month", "report_type": "industry_trends"},
            [{"id": "source-1", "title": "来源", "url": "https://example.com"}],
            {},
            [],
            "now",
        )
        self.assertTrue(report["is_fallback"])
        self.assertNotEqual(report["core_conclusion"], "")

    def test_recover_stale_execution_closes_active_phase(self) -> None:
        snapshot = {"question": "q"}
        searching = self.store.create_execution(5, snapshot, "instant", 5, original_query="q")
        self.store.update_execution(int(searching["id"]), status="running", search_status="running")
        # A second owner is used because active executions are unique per owner.
        analyzing = self.store.create_execution(6, snapshot, "instant", 6, original_query="q")
        self.store.update_execution(
            int(analyzing["id"]),
            status="running",
            search_status="succeeded",
            analysis_status="running",
        )

        recovered = self.store.recover_stale_executions()
        self.assertEqual(recovered, 2)
        searching_row = self.store.get_execution(5, int(searching["id"]))
        analyzing_row = self.store.get_execution(6, int(analyzing["id"]))
        self.assertEqual((searching_row["search_status"], searching_row["analysis_status"]), ("failed", "not_run"))
        self.assertEqual((analyzing_row["search_status"], analyzing_row["analysis_status"]), ("succeeded", "failed"))

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
            followups=["还应关注哪些风险？"],
            request_id="request-1",
        )
        fake_report = normalize_report(
            '{"title":"测试报告","core_conclusion":"综合结论"}',
            snapshot,
            [{"id": "source-1", "provider_reference_ids": ["ref-1"], "title": "来源", "url": "https://example.com"}],
            {"ref-1": "source-1"},
            [],
            "now",
            "request-1",
        )
        with (
            patch.object(service.client, "search", return_value=fake_result),
            patch.object(service, "_request_analysis", return_value=fake_report),
        ):
            service._run_execution(int(succeeded["id"]))
        stored = self.store.get_execution(5, int(succeeded["id"]))
        self.assertEqual(stored["status"], "succeeded")
        self.assertEqual(stored["search_status"], "succeeded")
        self.assertEqual(stored["analysis_status"], "succeeded")
        self.assertEqual(stored["request_id"], "request-1")
        self.assertEqual(len(stored["sources"]), 1)
        self.assertEqual(stored["search_answer"], "综合结论")
        self.assertEqual(stored["search_followups"], ["还应关注哪些风险？"])

        failed = self.store.create_execution(5, snapshot, "rerun", 5, original_query=snapshot["question"])
        with patch.object(service.client, "search", side_effect=RuntimeError("secret upstream detail")):
            service._run_execution(int(failed["id"]))
        failed_stored = self.store.get_execution(5, int(failed["id"]))
        self.assertEqual(failed_stored["status"], "failed")
        self.assertNotIn("secret upstream detail", str(failed_stored["error_message"]))

    def test_reanalyze_uses_existing_sources_without_new_search(self) -> None:
        service.initialize_service()
        snapshot = {
            "question": "近期证券行业变化",
            "analysis_perspective": "industry_research",
            "time_range": "month",
            "source_preference": "balanced",
            "report_type": "industry_trends",
            "analysis_depth": "concise",
        }
        execution = self.store.create_execution(5, snapshot, "instant", 5, original_query=snapshot["question"])
        sources = [{"id": "source-1", "provider_reference_ids": ["ref-1"], "title": "来源", "url": "https://example.com"}]
        self.store.update_execution(
            int(execution["id"]),
            search_status="succeeded",
            analysis_status="failed",
            sources_json=json.dumps(sources, ensure_ascii=False),
            reference_aliases_json=json.dumps({"ref-1": "source-1"}, ensure_ascii=False),
            request_id="request-1",
        )
        fake_report = normalize_report(
            '{"title":"测试报告","core_conclusion":"结论"}',
            snapshot,
            sources,
            {"ref-1": "source-1"},
            [],
            "now",
            "request-1",
        )
        with (
            patch.object(service.client, "search") as search,
            patch.object(service, "_request_analysis", return_value=fake_report),
            patch.object(service._executor, "submit", side_effect=lambda fn, *args: fn(*args)),
        ):
            service.reanalyze_execution(5, int(execution["id"]))
            stored = self.store.get_execution(5, int(execution["id"]))
            self.assertEqual(stored["status"], "succeeded")
            self.assertEqual(stored["analysis_status"], "succeeded")
            search.assert_not_called()

    def test_search_success_analysis_failure_keeps_sources(self) -> None:
        snapshot = {
            "question": "近期证券行业变化",
            "analysis_perspective": "industry_research",
            "time_range": "month",
            "source_preference": "balanced",
            "report_type": "industry_trends",
            "analysis_depth": "concise",
        }
        execution = self.store.create_execution(5, snapshot, "instant", 5, original_query=snapshot["question"])
        fake_result = QianfanSearchResult(
            answer="",
            references=[QianfanReference("ref-1", "来源", "https://example.com")],
            request_id="request-analysis-fail",
        )
        with (
            patch.object(service.client, "search", return_value=fake_result),
            patch.object(service, "_request_analysis", side_effect=RuntimeError("deepseek timeout")),
        ):
            service._run_execution(int(execution["id"]))
        stored = self.store.get_execution(5, int(execution["id"]))
        self.assertEqual(stored["status"], "failed")
        self.assertEqual(stored["search_status"], "succeeded")
        self.assertEqual(stored["analysis_status"], "failed")
        self.assertEqual(len(stored["sources"]), 1)
        self.assertTrue(stored["report"]["is_fallback"])


if __name__ == "__main__":
    unittest.main()
