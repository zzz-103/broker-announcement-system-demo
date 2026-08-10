from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx

from backend.api import custom_intelligence_service as service
from backend.api.custom_intelligence_service import (
    _normalize_query_plan,
    _search_with_queries,
    build_planner_messages,
    normalize_report,
    normalize_sources,
)
from backend.api.custom_intelligence_store import (
    EXECUTIONS_RETENTION,
    ActiveExecutionError,
    IntelligenceNotFoundError,
    IntelligenceStore,
)
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

    def test_execution_history_retains_30_per_user_and_prunes_oldest(self) -> None:
        self.assertEqual(EXECUTIONS_RETENTION, 30)
        created_ids: list[int] = []
        for index in range(EXECUTIONS_RETENTION + 1):
            snapshot = {"question": f"历史问题 {index}"}
            execution = self.store.create_execution(
                5,
                snapshot,
                "instant",
                5,
                original_query=snapshot["question"],
            )
            created_ids.append(int(execution["id"]))
            if index == 0:
                self.store.create_delivery_log(
                    execution_id=int(execution["id"]),
                    owner_user_id=5,
                    recipient="recipient@csco.com.cn",
                    format="html",
                    status="sent",
                    message_id=None,
                    error_message=None,
                    external_confirmed=False,
                    sent_at="2026-08-10T00:00:00+00:00",
                )
            if index == EXECUTIONS_RETENTION:
                active_executions, active_meta = self.store.list_executions(5, 1, 100)
                self.assertEqual(active_meta["total"], EXECUTIONS_RETENTION)
                self.assertIn(int(execution["id"]), {int(item["id"]) for item in active_executions})
                self.assertNotIn(created_ids[0], {int(item["id"]) for item in active_executions})
            self.store.update_execution(
                int(execution["id"]),
                status="succeeded",
                search_status="succeeded",
                analysis_status="succeeded",
                completed_at=f"2026-08-10T00:00:{index:02d}+00:00",
            )

        executions, meta = self.store.list_executions(5, 1, 100)
        self.assertEqual(meta["total"], EXECUTIONS_RETENTION)
        self.assertEqual({int(item["id"]) for item in executions}, set(created_ids[1:]))
        with self.assertRaises(IntelligenceNotFoundError):
            self.store.get_execution(5, created_ids[0])
        self.assertEqual(self.store.list_delivery_logs(created_ids[0]), [])

        first_page, first_meta = self.store.list_executions(5, 1, 10)
        second_page, second_meta = self.store.list_executions(5, 2, 10)
        third_page, third_meta = self.store.list_executions(5, 3, 10)
        self.assertEqual(first_meta["total_pages"], 3)
        self.assertEqual(second_meta["page"], 2)
        self.assertEqual(third_meta["page"], 3)
        self.assertEqual([len(first_page), len(second_page), len(third_page)], [10, 10, 10])
        self.assertEqual(
            {item["id"] for item in first_page + second_page + third_page},
            {item["id"] for item in executions},
        )

        other_user_execution = self.store.create_execution(
            6,
            {"question": "其他用户记录"},
            "instant",
            6,
            original_query="其他用户记录",
        )
        other_user_executions, other_meta = self.store.list_executions(6, 1, 100)
        self.assertEqual(other_meta["total"], 1)
        self.assertEqual(other_user_executions[0]["id"], other_user_execution["id"])

    def test_each_query_uses_fixed_top_k(self) -> None:
        for depth, top_k in (("concise", 10), ("standard", 20), ("deep", 30)):
            payload = build_search_payload("test", top_k=top_k)
            self.assertEqual(payload["resource_type_filter"][0]["top_k"], 10)
            self.assertEqual(payload["search_source"], "baidu_search_v2")
            self.assertNotIn("model", payload)
            self.assertNotIn("search_mode", payload)
            self.assertEqual(payload["search_recency_filter"], "month")

        self.assertEqual(build_search_payload("test")["resource_type_filter"][0]["top_k"], 10)
        self.assertEqual(build_search_payload("test", top_k=100)["resource_type_filter"][0]["top_k"], 10)

    def test_search_payload_uses_concise_query_without_user_site_filter(self) -> None:
        payload = build_search_payload("test")
        self.assertEqual(payload["messages"], [{"role": "user", "content": "test"}])
        self.assertNotIn("instruction", payload)
        self.assertNotIn("search_filter", payload)

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
                auth_header="Legacy-Unsupported-Header",
                timeout_seconds=30,
                updated_by_user_id=0,
            )
            config = effective_search_config()
            self.assertEqual(config.config_source, "admin")
            self.assertFalse(config.enabled)
            self.assertEqual(config.api_key, "env-key")
            self.assertEqual(config.auth_header, "Authorization")
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
            with patch.object(service, "analysis_service_configured", return_value=True):
                options = service.options_payload()
            self.assertEqual(options, {"service_status": "enabled"})

    def test_options_payload_hides_search_and_model_parameters(self) -> None:
        options = service.options_payload()
        self.assertEqual(set(options), {"service_status"})

    def test_report_length_does_not_change_planner_query_count_or_search_top_k(self) -> None:
        fake_result = QianfanSearchResult(
            answer="综合结论",
            references=[QianfanReference("ref-1", "来源", "https://example.com")],
        )
        seen_payloads: list[dict[str, object]] = []

        def fake_search(payload: dict[str, object]) -> QianfanSearchResult:
            seen_payloads.append(payload)
            return fake_result

        for report_length in ("standard", "deep"):
            seen_payloads.clear()
            snapshot = {
                "audience": "industry_research",
                "audience_detail": "",
                "focus_tags": ["同业竞争"],
                "focus": "近期证券行业变化",
                "extra_focus": "",
                "time_range": "month",
                "report_length": report_length,
            }
            execution = self.store.create_execution(
                5,
                snapshot,
                "instant",
                5,
                original_query=snapshot["focus"],
            )
            with (
                patch.object(
                    service,
                    "_request_query_plan",
                    return_value={
                        "intent": "证券行业变化",
                        "queries": [
                            {"query": "证券行业监管变化", "purpose": "监管"},
                            {"query": "券商同业经营变化", "purpose": "同业"},
                        ],
                    },
                ),
                patch.object(service.client, "search", side_effect=fake_search),
                patch.object(
                    service,
                    "_request_analysis",
                    return_value={
                        "version": 2,
                        "title": "报告",
                        "core_judgment": [
                            {"type": "analysis", "text": "结论", "source_ids": ["source-1"]}
                        ],
                        "key_developments": [],
                        "impact_analysis": [],
                        "company_implications": [],
                        "risks_and_watch_items": [],
                    },
                ),
            ):
                service._run_execution(int(execution["id"]))

            self.assertEqual(len(seen_payloads), 2)
            self.assertTrue(
                all(payload["resource_type_filter"][0]["top_k"] == 10 for payload in seen_payloads)
            )
            self.assertTrue(all("source_preference" not in payload for payload in seen_payloads))
            self.assertEqual(
                len({payload["messages"][0]["content"] for payload in seen_payloads}),
                2,
            )

    def test_planned_queries_merge_until_unique_source_limit(self) -> None:
        first_result = QianfanSearchResult(
            answer="首轮结论",
            references=[
                QianfanReference("1", "同一来源", "https://example.com/article", provider_reference_id_is_fallback=True),
                QianfanReference("2", "同一来源", "https://example.com/article/", provider_reference_id_is_fallback=True),
            ],
            request_id="request-primary",
        )
        second_result = QianfanSearchResult(
            answer="补充结论",
            references=[
                QianfanReference(
                    str(index),
                    f"补充来源 {index}",
                    f"https://domain{index}.example.com/{index}",
                    provider_reference_id_is_fallback=True,
                )
                for index in range(1, 11)
            ],
            request_id="request-secondary",
        )
        with patch.object(service.client, "search", side_effect=[first_result, second_result]):
            merged, sources, aliases, payloads, errors, rounds, diagnostics = _search_with_queries(
                [
                    {"query": "监管变化", "purpose": "监管"},
                    {"query": "同业动态", "purpose": "同业"},
                ],
                time_range="month",
                target_sources=15,
            )
        self.assertEqual(len(payloads), 2)
        self.assertTrue(all(item["resource_type_filter"][0]["top_k"] == 10 for item in payloads))
        self.assertEqual(len(sources), 11)
        self.assertEqual(diagnostics["raw_reference_count"], 12)
        self.assertEqual(diagnostics["deduplicated_count"], 11)
        self.assertEqual(diagnostics["duplicate_removed_count"], 1)
        self.assertEqual(diagnostics["selected_count"], 11)
        self.assertEqual(diagnostics["final_source_ids"], [item["id"] for item in sources])
        self.assertEqual(rounds[-1]["request_id"], "request-secondary")
        self.assertEqual(errors, [])

    def test_explicit_numeric_provider_ids_deduplicate_across_queries(self) -> None:
        first = QianfanSearchResult(
            answer="第一轮",
            references=[QianfanReference("123", "来源甲", "https://one.example.com/a")],
        )
        second = QianfanSearchResult(
            answer="第二轮",
            references=[QianfanReference("123", "来源乙", "https://two.example.com/b")],
        )
        with patch.object(service.client, "search", side_effect=[first, second]):
            _merged, sources, _aliases, _payloads, _errors, _rounds, diagnostics = _search_with_queries(
                [
                    {"query": "第一轮", "purpose": "一"},
                    {"query": "第二轮", "purpose": "二"},
                ],
                time_range="month",
                target_sources=15,
            )
        self.assertEqual(len(sources), 1)
        self.assertEqual(diagnostics["duplicate_removed_count"], 1)

    def test_parser_generated_rank_ids_are_scoped_per_query(self) -> None:
        parsed_first = parse_search_response(
            {"references": [{"title": "来源甲", "url": "https://one.example.com/a"}]}
        )
        parsed_second = parse_search_response(
            {"references": [{"title": "来源乙", "url": "https://two.example.com/b"}]}
        )
        self.assertTrue(parsed_first.references[0].provider_reference_id_is_fallback)
        with patch.object(service.client, "search", side_effect=[parsed_first, parsed_second]):
            _merged, sources, _aliases, _payloads, _errors, _rounds, diagnostics = _search_with_queries(
                [
                    {"query": "第一轮", "purpose": "一"},
                    {"query": "第二轮", "purpose": "二"},
                ],
                time_range="month",
                target_sources=15,
            )
        self.assertEqual(len(sources), 2)
        self.assertEqual(diagnostics["duplicate_removed_count"], 0)

    def test_all_planned_queries_run_even_when_first_query_reaches_source_cap(self) -> None:
        full_result = QianfanSearchResult(
            answer="首轮",
            references=[
                QianfanReference(f"id-{index}", f"来源 {index}", f"https://domain{index}.example.com/{index}")
                for index in range(15)
            ],
            request_id="request-1",
        )
        later_results = [
            QianfanSearchResult(answer=f"第 {index} 轮", references=[], request_id=f"request-{index}")
            for index in range(2, 6)
        ]
        plans = [
            {"query": f"查询 {index}", "purpose": f"目的 {index}"}
            for index in range(1, 6)
        ]
        with patch.object(service.client, "search", side_effect=[full_result, *later_results]) as search:
            _merged, sources, _aliases, payloads, errors, rounds, diagnostics = _search_with_queries(
                plans,
                time_range="month",
            )
        self.assertEqual(search.call_count, 5)
        self.assertEqual(len(payloads), 5)
        self.assertEqual(len(rounds), 5)
        self.assertEqual(len(sources), 15)
        self.assertEqual(diagnostics["selected_count"], 15)
        self.assertEqual(errors, [])

    def test_provider_match_indexes_all_observed_urls_for_later_deduplication(self) -> None:
        result = QianfanSearchResult(
            answer="结果",
            references=[
                QianfanReference("stable-id", "第一个来源标题", "https://example.com/a"),
                QianfanReference("stable-id", "第二个来源标题", "https://example.com/b"),
                QianfanReference("different-id", "第三个来源标题", "https://example.com/b"),
            ],
        )
        sources, aliases = normalize_sources(result)
        self.assertEqual(len(sources), 1)
        self.assertEqual(aliases["stable-id"], sources[0]["id"])
        self.assertEqual(aliases["different-id"], sources[0]["id"])

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

    def test_client_uses_fixed_bearer_authorization_and_web_search_payload(self) -> None:
        response = httpx.Response(
            200,
            json={
                "request_id": "request-auth",
                "choices": [{"message": {"content": "answer"}}],
                "references": [{"id": "r1", "title": "来源", "url": "https://example.com/a"}],
            },
            request=httpx.Request("POST", "https://example.com"),
        )
        with (
            patch.dict(os.environ, {"BAIDU_QIANFAN_API_KEY": "bce-v3/test-key"}),
            patch("backend.api.qianfan_search.httpx.Client.post", return_value=response) as post,
        ):
            result = QianfanSearchClient().search(build_search_payload("监管变化", top_k=50))
        self.assertEqual(result.request_id, "request-auth")
        kwargs = post.call_args.kwargs
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer bce-v3/test-key")
        self.assertEqual(kwargs["json"]["search_source"], "baidu_search_v2")
        self.assertEqual(kwargs["json"]["resource_type_filter"][0]["top_k"], 10)

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

    def test_same_title_on_different_hosts_is_not_collapsed(self) -> None:
        result = QianfanSearchResult(
            answer="",
            references=[
                QianfanReference("r1", "证券行业数字化转型最新进展", "https://first.example.com/a"),
                QianfanReference("r2", "证券行业数字化转型最新进展", "https://second.example.com/b"),
            ],
        )
        sources, aliases = normalize_sources(result)
        self.assertEqual(len(sources), 2)
        self.assertEqual(aliases, {"r1": "source-1", "r2": "source-2"})

    def test_tracking_query_parameters_do_not_create_duplicate_sources(self) -> None:
        result = QianfanSearchResult(
            answer="",
            references=[
                QianfanReference("r1", "来源", "https://example.com/article?utm_source=baidu"),
                QianfanReference("r2", "来源", "https://example.com/article?utm_medium=search"),
            ],
        )
        sources, aliases = normalize_sources(result)
        self.assertEqual(len(sources), 1)
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

    def test_invalid_report_json_is_analysis_failure(self) -> None:
        sources = [{"id": "source-1", "provider_reference_ids": ["r1"], "title": "T", "url": "https://example.com"}]
        with self.assertRaises(ValueError):
            normalize_report(
                "<script>alert(1)</script>plain",
                {"question": "q", "time_range": "month", "report_type": "industry_trends"},
                sources,
                {"r1": "source-1"},
                [],
                "now",
                "request-fallback",
            )

    def test_deterministic_report_fields_override_model_values(self) -> None:
        snapshot = {
            "question": "原始问题",
            "time_range": "month",
            "report_type": "industry_trends",
        }
        sources = [{"id": "r1", "provider_reference_ids": ["r1"], "title": "T", "url": "https://example.com"}]
        answer = json.dumps(
            {
                "version": 2,
                "title": "模型标题",
                "executed_at": "模型时间",
                "time_range": "year",
                "core_judgment": [{"type": "analysis", "text": "结论", "source_ids": ["r1"]}],
                "key_developments": [],
                "impact_analysis": [],
                "company_implications": [],
                "risks_and_watch_items": [],
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
        self.assertEqual(report["version"], 2)
        self.assertEqual(report["title"], "模型标题")
        self.assertEqual(report["executed_at"], "2026-08-06T00:00:00Z")
        self.assertEqual(report["time_range"], "month")
        self.assertEqual(report["core_judgment"][0]["source_ids"], ["r1"])

    def test_report_accepts_canonical_source_ids_from_model(self) -> None:
        snapshot = {
            "question": "原始问题",
            "time_range": "month",
            "report_type": "industry_trends",
        }
        sources = [
            {
                "id": "source-1",
                "provider_reference_ids": ["ref-1"],
                "title": "来源",
                "url": "https://example.com",
            }
        ]
        answer = json.dumps(
            {
                "version": 2,
                "title": "报告",
                "core_judgment": [{"type": "analysis", "text": "结论", "source_ids": ["source-1"]}],
                "key_developments": [{"type": "fact", "text": "动态", "source_ids": ["source-1"]}],
            },
            ensure_ascii=False,
        )
        report = normalize_report(answer, snapshot, sources, {"ref-1": "source-1"}, [], "now", "request-1")
        self.assertEqual(report["version"], 2)
        self.assertEqual(report["key_developments"][0]["source_ids"], ["source-1"])

    def test_report_missing_grounded_core_is_analysis_failure(self) -> None:
        with self.assertRaises(ValueError):
            normalize_report(
                '{"title":"只有标题","core_judgment":[{"type":"analysis","text":"无来源"}]}',
                {"question": "q", "time_range": "month", "report_type": "industry_trends"},
                [{"id": "source-1", "title": "来源", "url": "https://example.com"}],
                {},
                [],
                "now",
            )

    def test_analysis_uses_json_mode_and_rejects_plain_text(self) -> None:
        request: dict[str, object] = {}
        config = SimpleNamespace(
            model="test-model",
            temperature=0.1,
            top_p=1.0,
            max_tokens=1024,
            frequency_penalty=0.0,
            presence_penalty=0.0,
            use_json_object=True,
        )

        class FakeAnalysisClient:
            def __init__(self) -> None:
                self.config = config

            def _request_json(self, request_kwargs: dict[str, object], *, fallback_to_text: bool = False) -> str:
                request.update(request_kwargs)
                request["fallback_to_text"] = fallback_to_text
                return "模型返回的普通文本结论"

        snapshot = {"question": "q", "time_range": "month", "report_type": "industry_trends"}
        sources = [{"id": "source-1", "title": "来源", "url": "https://example.com"}]
        with patch.object(service, "_load_analysis_client", return_value=FakeAnalysisClient()):
            with self.assertRaises(ValueError):
                service._request_analysis(snapshot, sources, {}, "request-1")

        self.assertEqual(request["response_format"], {"type": "json_object"})
        self.assertTrue(request["fallback_to_text"])
        self.assertNotIn("version", request)

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
        sources = [{"id": "source-1", "title": "来源", "url": "https://example.com"}]
        report = normalize_report(
            json.dumps(
                {
                    "title": "报告",
                    "core_judgment": [
                        {"type": "analysis", "text": "&lt;strong&gt;结论&lt;/strong&gt;", "source_ids": ["source-1"]}
                    ],
                },
                ensure_ascii=False,
            ),
            {"question": "q", "time_range": "month"},
            sources,
            {"source-1": "source-1"},
            [],
            "now",
        )
        self.assertEqual(report["core_judgment"][0]["text"], "结论")

    def test_execution_success_failure_and_duplicate_guard(self) -> None:
        snapshot = {
            "audience": "industry_research",
            "audience_detail": "",
            "focus_tags": ["同业竞争"],
            "focus": "近期证券行业变化",
            "extra_focus": "",
            "time_range": "month",
            "report_length": "concise",
        }
        succeeded = self.store.create_execution(5, snapshot, "instant", 5, original_query=snapshot["focus"])
        with self.assertRaises(ActiveExecutionError):
            self.store.create_execution(5, snapshot, "instant", 5, original_query=snapshot["focus"])
        fake_result = QianfanSearchResult(
            answer="综合结论",
            references=[QianfanReference("ref-1", "来源", "https://example.com")],
            followups=["还应关注哪些风险？"],
            request_id="request-1",
        )
        fake_report = normalize_report(
            json.dumps({
                "title": "测试报告",
                "core_judgment": [{"type": "analysis", "text": "综合结论", "source_ids": ["source-1"]}],
            }, ensure_ascii=False),
            snapshot,
            [{"id": "source-1", "provider_reference_ids": ["ref-1"], "title": "来源", "url": "https://example.com"}],
            {"ref-1": "source-1"},
            [],
            "now",
            "request-1",
        )
        with (
            patch.object(
                service,
                "_request_query_plan",
                return_value={
                    "intent": "证券行业变化",
                    "queries": [
                        {"query": "证券行业监管变化", "purpose": "监管"},
                        {"query": "券商同业经营变化", "purpose": "同业"},
                    ],
                },
            ),
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

        failed = self.store.create_execution(5, snapshot, "rerun", 5, original_query=snapshot["focus"])
        with (
            patch.object(
                service,
                "_request_query_plan",
                return_value={
                    "intent": "证券行业变化",
                    "queries": [
                        {"query": "证券行业监管变化", "purpose": "监管"},
                        {"query": "券商同业经营变化", "purpose": "同业"},
                    ],
                },
            ),
            patch.object(service.client, "search", side_effect=RuntimeError("secret upstream detail")),
        ):
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
            status="failed",
            search_status="succeeded",
            analysis_status="failed",
            sources_json=json.dumps(sources, ensure_ascii=False),
            reference_aliases_json=json.dumps({"ref-1": "source-1"}, ensure_ascii=False),
            request_id="request-1",
        )
        fake_report = normalize_report(
            json.dumps({
                "title": "测试报告",
                "core_judgment": [{"type": "analysis", "text": "结论", "source_ids": ["source-1"]}],
            }, ensure_ascii=False),
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

    def test_reanalyze_claim_is_atomic_and_blocks_active_execution(self) -> None:
        service.initialize_service()
        snapshot = {
            "question": "近期证券行业变化",
            "analysis_perspective": "industry_research",
            "time_range": "month",
            "source_preference": "balanced",
            "report_type": "industry_trends",
            "analysis_depth": "concise",
        }
        sources = [
            {
                "id": "source-1",
                "provider_reference_ids": ["ref-1"],
                "title": "来源",
                "url": "https://example.com",
            }
        ]
        execution = self.store.create_execution(5, snapshot, "instant", 5, original_query=snapshot["question"])
        self.store.update_execution(
            int(execution["id"]),
            status="failed",
            search_status="succeeded",
            analysis_status="failed",
            sources_json=json.dumps(sources, ensure_ascii=False),
            reference_aliases_json=json.dumps({"ref-1": "source-1"}, ensure_ascii=False),
            error_message="previous analysis failed",
            completed_at="2026-08-10T00:00:00+00:00",
        )
        active = self.store.create_execution(5, snapshot, "instant", 5, original_query="active")
        with self.assertRaises(ActiveExecutionError):
            service.reanalyze_execution(5, int(execution["id"]))
        self.store.update_execution(
            int(active["id"]),
            status="failed",
            search_status="failed",
            analysis_status="not_run",
            error_message="cleanup",
            completed_at="2026-08-10T00:00:01+00:00",
        )
        with patch.object(service._executor, "submit", return_value=None):
            claimed = service.reanalyze_execution(5, int(execution["id"]))
        self.assertEqual(claimed["status"], "running")
        with self.assertRaises(ActiveExecutionError):
            service.reanalyze_execution(5, int(execution["id"]))
        self.store.update_execution(
            int(execution["id"]),
            status="failed",
            analysis_status="failed",
            error_message="cleanup",
            completed_at="2026-08-10T00:00:02+00:00",
        )

    def test_search_success_analysis_failure_keeps_sources(self) -> None:
        snapshot = {
            "audience": "industry_research",
            "audience_detail": "",
            "focus_tags": ["同业竞争"],
            "focus": "近期证券行业变化",
            "extra_focus": "",
            "time_range": "month",
            "report_length": "concise",
        }
        execution = self.store.create_execution(5, snapshot, "instant", 5, original_query=snapshot["focus"])
        fake_result = QianfanSearchResult(
            answer="",
            references=[QianfanReference("ref-1", "来源", "https://example.com")],
            request_id="request-analysis-fail",
        )
        with (
            patch.object(
                service,
                "_request_query_plan",
                return_value={
                    "intent": "证券行业变化",
                    "queries": [
                        {"query": "证券行业监管变化", "purpose": "监管"},
                        {"query": "券商同业经营变化", "purpose": "同业"},
                    ],
                },
            ),
            patch.object(service.client, "search", return_value=fake_result),
            patch.object(service, "_request_analysis", side_effect=RuntimeError("deepseek timeout")),
        ):
            service._run_execution(int(execution["id"]))
        stored = self.store.get_execution(5, int(execution["id"]))
        self.assertEqual(stored["status"], "failed")
        self.assertEqual(stored["search_status"], "succeeded")
        self.assertEqual(stored["analysis_status"], "failed")
        self.assertEqual(len(stored["sources"]), 1)
        self.assertEqual(stored["report"]["version"], 2)
        self.assertEqual(stored["report"]["core_judgment"][0]["type"], "recommendation")
        self.assertEqual(stored["report"]["core_judgment"][0]["source_ids"], [])

    def test_planner_requires_intent_and_bounds_dynamic_queries(self) -> None:
        plan = _normalize_query_plan(
            {
                "intent": "监管与同业变化",
                "queries": [
                    {"query": f"查询 {index}", "purpose": f"目的 {index}"}
                    for index in range(1, 7)
                ],
            }
        )
        self.assertEqual(plan["intent"], "监管与同业变化")
        self.assertEqual(len(plan["queries"]), 5)
        with self.assertRaises(ValueError):
            _normalize_query_plan({"queries": [{"query": "缺少意图", "purpose": "x"}]})
        messages = build_planner_messages({"focus": "证券行业变化"})
        self.assertIn("intent", messages[0]["content"])
        self.assertIn("2 到 5", messages[0]["content"])
        concise_messages = build_planner_messages({"focus": "证券行业变化", "report_length": "concise"})
        deep_messages = build_planner_messages({"focus": "证券行业变化", "report_length": "deep"})
        self.assertEqual(concise_messages, deep_messages)

    def test_planner_failure_is_degraded_and_searches_focus_once(self) -> None:
        snapshot = {"focus": "近期监管变化", "time_range": "month"}
        execution = self.store.create_execution(5, snapshot, "instant", 5, original_query=snapshot["focus"])
        result = QianfanSearchResult(
            answer="检索摘要",
            references=[QianfanReference("r1", "来源标题", "https://example.com/a")],
            request_id="request-degraded",
        )
        report = {
            "version": 2,
            "title": "报告",
            "core_judgment": [{"type": "analysis", "text": "结论", "source_ids": ["source-1"]}],
            "key_developments": [],
            "impact_analysis": [],
            "company_implications": [],
            "risks_and_watch_items": [],
        }
        with (
            patch.object(service, "_request_query_plan", side_effect=RuntimeError("planner unavailable")),
            patch.object(service.client, "search", return_value=result) as search,
            patch.object(service, "_request_analysis", return_value=report),
        ):
            service._run_execution(int(execution["id"]))
        search.assert_called_once()
        stored = self.store.get_execution(5, int(execution["id"]))
        payload = stored["request_payload"]
        self.assertEqual(payload["planning_status"], "degraded")
        self.assertEqual(payload["query_plan"]["intent"], "研究重点降级检索")
        self.assertEqual(len(payload["query_plan"]["queries"]), 1)
        self.assertEqual(payload["query_plan"]["queries"][0]["query"], "近期监管变化")

    def test_submit_rejects_missing_deepseek_before_creating_or_searching(self) -> None:
        with (
            patch.object(service, "initialize_service"),
            patch.object(service, "validate_configuration"),
            patch.object(service, "analysis_service_configured", return_value=False),
            patch.object(service.store, "create_execution") as create_execution,
            self.assertRaises(service.AnalysisConfigurationError),
        ):
            service.submit_execution(
                5,
                {"audience": "management", "focus": "监管变化", "time_range": "month", "report_length": "standard"},
                5,
                trigger_type="instant",
            )
        create_execution.assert_not_called()

    def test_failed_query_continues_and_records_per_round_diagnostics(self) -> None:
        successful = QianfanSearchResult(
            answer="第二轮",
            references=[QianfanReference("r1", "来源标题", "https://example.com/a")],
            request_id="request-2",
        )
        with patch.object(service.client, "search", side_effect=[RuntimeError("upstream"), successful]):
            _merged, sources, _aliases, _payloads, errors, rounds, diagnostics = _search_with_queries(
                [
                    {"query": "第一轮", "purpose": "第一目的"},
                    {"query": "第二轮", "purpose": "第二目的"},
                ],
                time_range="month",
            )
        self.assertEqual(len(sources), 1)
        self.assertEqual(len(errors), 1)
        self.assertEqual([item["status"] for item in rounds], ["failed", "succeeded"])
        self.assertEqual(rounds[0]["raw_reference_count"], 0)
        self.assertEqual(rounds[1]["request_id"], "request-2")
        self.assertEqual(diagnostics["raw_reference_count"], 1)
        self.assertEqual(diagnostics["deduplicated_count"], 1)
        self.assertEqual(diagnostics["selected_count"], 1)
        self.assertEqual(diagnostics["final_source_ids"], ["source-1"])

    def test_all_queries_fail_and_execution_persists_failure_diagnostics(self) -> None:
        snapshot = {"focus": "全部失败测试", "time_range": "month"}
        execution = self.store.create_execution(5, snapshot, "instant", 5, original_query=snapshot["focus"])
        with (
            patch.object(
                service,
                "_request_query_plan",
                return_value={
                    "intent": "失败测试",
                    "queries": [
                        {"query": "失败一", "purpose": "一"},
                        {"query": "失败二", "purpose": "二"},
                    ],
                },
            ),
            patch.object(service.client, "search", side_effect=[RuntimeError("one"), RuntimeError("two")]),
        ):
            service._run_execution(int(execution["id"]))
        stored = self.store.get_execution(5, int(execution["id"]))
        self.assertEqual(stored["status"], "failed")
        self.assertEqual(stored["search_status"], "failed")
        self.assertEqual(len(stored["request_payload"]["search_rounds"]), 2)
        self.assertEqual(stored["request_payload"]["search_summary"]["failed_query_count"], 2)
        self.assertEqual(stored["request_payload"]["search_summary"]["selected_count"], 0)

    def test_report_drops_uncited_fact_analysis_but_keeps_recommendation(self) -> None:
        sources = [{"id": "source-1", "title": "来源", "url": "https://example.com/a"}]
        answer = json.dumps(
            {
                "version": 2,
                "title": "报告",
                "core_judgment": [{"type": "analysis", "text": "有来源结论", "source_ids": ["source-1"]}],
                "key_developments": [{"type": "fact", "text": "无来源事实", "source_ids": []}],
                "impact_analysis": [{"type": "analysis", "text": "无来源分析", "source_ids": []}],
                "company_implications": [{"type": "recommendation", "text": "建议跟踪", "source_ids": []}],
            },
            ensure_ascii=False,
        )
        report = normalize_report(answer, {"audience": "管理层", "time_range": "month"}, sources, {}, [], "now")
        self.assertEqual(report["version"], 2)
        self.assertEqual(report["key_developments"], [])
        self.assertEqual(report["impact_analysis"], [])
        self.assertEqual(report["company_implications"][0]["type"], "recommendation")
        self.assertIn("未引用来源", " ".join(report["reference_warnings"]))

    def test_search_filters_stale_sources_and_caps_each_domain_at_three(self) -> None:
        result = QianfanSearchResult(
            answer="结果",
            references=[
                QianfanReference("old", "旧来源标题", "https://old.example.com/a", date="2020-01-01"),
                *[
                    QianfanReference(str(index), f"近期来源标题 {index}", f"https://same.example.com/{index}", date="2099-01-01")
                    for index in range(1, 6)
                ],
            ],
            request_id="request-filter",
        )
        with patch.object(service.client, "search", return_value=result):
            _merged, sources, _aliases, _payloads, _errors, _rounds, diagnostics = _search_with_queries(
                [{"query": "过滤", "purpose": "过滤"}],
                time_range="month",
            )
        self.assertEqual(diagnostics["stale_removed_count"], 1)
        self.assertEqual(diagnostics["domain_removed_count"], 2)
        self.assertEqual(diagnostics["selected_count"], 3)
        self.assertEqual(len(sources), 3)

    def test_admin_default_rules_only_constrain_report_not_query_planner(self) -> None:
        with patch.object(
            service.store,
            "get_default_rules",
            return_value={"rules": {"analysis_instructions": "优先说明业务影响"}},
            create=True,
        ):
            planner_system = build_planner_messages({"focus": "监管变化"})[0]["content"]
            report_system = service.build_analysis_messages(
                {"focus": "监管变化"},
                [{"id": "source-1", "title": "来源", "url": "https://example.com/a"}],
            )[0]["content"]
        self.assertNotIn("优先说明业务影响", planner_system)
        self.assertIn("优先说明业务影响", report_system)


if __name__ == "__main__":
    unittest.main()
