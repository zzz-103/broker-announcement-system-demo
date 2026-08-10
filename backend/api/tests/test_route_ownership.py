from __future__ import annotations

import os
import csv
import json
import threading
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient


_RUNTIME_DIR = tempfile.TemporaryDirectory()
os.environ["ADMIN_USERNAME"] = "route-audit-admin"
os.environ["ADMIN_PASSWORD"] = "route-audit-password"
os.environ["USER_DB_PATH"] = str(Path(_RUNTIME_DIR.name) / "users.db")
os.environ["AUDIT_DB_PATH"] = str(Path(_RUNTIME_DIR.name) / "audit.db")

from backend.api import main  # noqa: E402
from backend.api.routes import accounts  # noqa: E402
from backend.api.routes import ai  # noqa: E402
from backend.api.routes import datasets  # noqa: E402
from backend.api.routes import custom_intelligence as custom_intelligence_routes  # noqa: E402
from backend.api import custom_intelligence_service as custom_intelligence_service  # noqa: E402
from backend.api.qianfan_search import QianfanReference, QianfanSearchResult  # noqa: E402


class RouteOwnershipTests(unittest.TestCase):
    def setUp(self) -> None:
        main.session_tokens.clear()
        self.client = TestClient(main.app)

    def _admin_headers(self) -> dict[str, str]:
        with patch.object(accounts, "write_audit_event_safely", return_value=False):
            response = self.client.post(
                "/api/login",
                json={"username": "route-audit-admin", "password": "route-audit-password"},
            )
        self.assertEqual(response.status_code, 200)
        return {"Authorization": f"Bearer {response.json()['token']}"}

    def test_fastapi_owns_all_frontend_feature_routes(self) -> None:
        registered = {
            (method, route.path)
            for route in main.app.routes
            for method in getattr(route, "methods", set())
        }
        expected = {
            ("POST", "/api/login"),
            ("POST", "/api/users/apply"),
            ("POST", "/api/audit/qr-visit"),
            ("POST", "/api/audit/dashboard-view"),
            ("POST", "/api/feedback"),
            ("GET", "/api/data/announcements"),
            ("POST", "/api/data/announcements/publish"),
            ("GET", "/api/ai-analysis"),
            ("POST", "/api/ai-analysis"),
            ("GET", "/api/admin/users"),
            ("POST", "/api/admin/users"),
            ("DELETE", "/api/admin/users/{user_id}"),
            ("GET", "/api/admin/audit/summary"),
            ("GET", "/api/admin/audit/events"),
            ("GET", "/api/admin/feedback"),
            ("POST", "/api/admin/feedback/{feedback_id}/status"),
            ("POST", "/api/jobs/scraper"),
            ("POST", "/api/jobs/llm"),
            ("POST", "/api/jobs/pipeline"),
            ("POST", "/api/jobs/app-watch"),
            ("POST", "/api/internal/scheduled-pipeline"),
            ("POST", "/api/internal/scheduled-app-watch"),
            ("GET", "/api/app-releases"),
            ("GET", "/api/dashboard-data/manifest"),
            ("GET", "/api/dashboard-data/files/{dataset}"),
            ("GET", "/api/dashboard-data/export-status"),
            ("POST", "/api/dashboard-data/export"),
            ("GET", "/api/dashboard-data/export.zip"),
            ("GET", "/api/jobs/{job_id}"),
            ("POST", "/api/jobs/{job_id}/cancel"),
            ("GET", "/api/jobs/{job_id}/events"),
            ("GET", "/api/custom-intelligence/options"),
            ("POST", "/api/custom-intelligence/keyword-suggestions"),
            ("GET", "/api/custom-intelligence/topics"),
            ("POST", "/api/custom-intelligence/topics"),
            ("GET", "/api/custom-intelligence/topics/{topic_id}"),
            ("POST", "/api/custom-intelligence/topics/{topic_id}"),
            ("POST", "/api/custom-intelligence/topics/{topic_id}/enabled"),
            ("DELETE", "/api/custom-intelligence/topics/{topic_id}"),
            ("POST", "/api/custom-intelligence/topics/{topic_id}/execute"),
            ("GET", "/api/custom-intelligence/executions"),
            ("POST", "/api/custom-intelligence/executions"),
            ("GET", "/api/custom-intelligence/executions/{execution_id}"),
            ("POST", "/api/custom-intelligence/executions/{execution_id}/rerun"),
            ("POST", "/api/custom-intelligence/executions/{execution_id}/reanalyze"),
            ("GET", "/api/custom-intelligence/executions/{execution_id}/report/pdf"),
            ("GET", "/api/admin/custom-intelligence/search-config"),
            ("POST", "/api/admin/custom-intelligence/search-config"),
            ("POST", "/api/admin/custom-intelligence/search-config/test"),
            ("POST", "/api/admin/custom-intelligence/search-config/reveal-key"),
        }
        self.assertTrue(expected.issubset(registered), expected - registered)

        client_source = (
            Path(__file__).resolve().parents[3]
            / "frontend"
            / "src"
            / "lib"
            / "api"
            / "backend-client.ts"
        ).read_text(encoding="utf-8")
        self.assertNotIn("/api/auth/login", client_source)

    def test_fastapi_serves_static_export_page_routes(self) -> None:
        if not main._frontend_dist.is_dir():
            self.skipTest("frontend/out is not built in this test environment")
        for path in ("/", "/app-updates", "/custom-intelligence"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertIn("text/html", response.headers.get("content-type", ""), path)

        version = self.client.get("/version.json")
        self.assertEqual(version.status_code, 200)
        self.assertIn("version", version.json())

    def test_custom_intelligence_requires_authentication(self) -> None:
        for method, path in (
            ("get", "/api/custom-intelligence/options"),
            ("get", "/api/custom-intelligence/topics"),
            ("get", "/api/custom-intelligence/executions"),
        ):
            response = getattr(self.client, method)(path)
            self.assertEqual(response.status_code, 401)

    def test_custom_intelligence_background_route_and_owner_isolation(self) -> None:
        main.session_tokens["custom-user-7"] = {
            "username": "user-7",
            "name": "User 7",
            "role": "user",
            "is_admin": False,
            "user_id": 7,
        }
        main.session_tokens["custom-user-8"] = {
            "username": "user-8",
            "name": "User 8",
            "role": "user",
            "is_admin": False,
            "user_id": 8,
        }
        headers_7 = {"Authorization": "Bearer custom-user-7"}
        headers_8 = {"Authorization": "Bearer custom-user-8"}
        started = threading.Event()
        release = threading.Event()

        def fake_search(_payload):
            started.set()
            release.wait(timeout=2)
            return QianfanSearchResult(
                answer="综合结论",
                references=[QianfanReference("ref-1", "来源", "https://example.com")],
                request_id="request-route-1",
            )

        request_payload = {
            "question": "近期证券行业变化",
            "analysis_perspective": "industry_research",
            "time_range": "month",
            "source_preference": "balanced",
            "report_type": "industry_trends",
            "analysis_depth": "concise",
        }
        with (
            patch.dict(os.environ, {"BAIDU_QIANFAN_API_KEY": "test-only"}),
            patch.object(custom_intelligence_service.client, "search", side_effect=fake_search),
            patch.object(
                custom_intelligence_service,
                "_request_analysis",
                return_value={
                    "title": "路由测试报告",
                    "core_conclusion": "综合结论",
                    "question": "近期证券行业变化",
                    "executed_at": "now",
                    "time_range": "month",
                    "valid_source_count": 1,
                    "report_type": "industry_trends",
                    "service": "baidu_web_search+deepseek",
                    "search_service": "baidu_web_search",
                    "analysis_service": "deepseek",
                    "is_fallback": False,
                },
            ),
        ):
            created = self.client.post(
                "/api/custom-intelligence/executions",
                headers=headers_7,
                json=request_payload,
            )
            self.assertEqual(created.status_code, 202)
            execution_id = int(created.json()["execution"]["id"])
            self.assertTrue(started.wait(timeout=1))
            duplicate = self.client.post(
                "/api/custom-intelligence/executions",
                headers=headers_7,
                json=request_payload,
            )
            self.assertEqual(duplicate.status_code, 409)
            self.assertEqual(
                self.client.get(
                    f"/api/custom-intelligence/executions/{execution_id}",
                    headers=headers_8,
                ).status_code,
                404,
            )
            release.set()
            completed = None
            for _ in range(100):
                completed = self.client.get(
                    f"/api/custom-intelligence/executions/{execution_id}",
                    headers=headers_7,
                )
                if completed.json()["execution"]["status"] == "succeeded":
                    break
                time.sleep(0.01)
        assert completed is not None
        self.assertEqual(completed.json()["execution"]["status"], "succeeded")
        self.assertEqual(completed.json()["execution"]["request_id"], "request-route-1")
        self.assertEqual(len(completed.json()["execution"]["sources"]), 1)

    def test_admin_and_approved_user_login_are_fastapi_features(self) -> None:
        admin_headers = self._admin_headers()
        self.assertTrue(admin_headers["Authorization"].startswith("Bearer "))
        admin_token = admin_headers["Authorization"].removeprefix("Bearer ")
        self.assertEqual(main.session_tokens[admin_token]["user_id"], 0)

        fake_user = SimpleNamespace(id=7, username="approved.user", name="Approved User")
        with (
            patch.object(accounts, "authenticate_user", return_value=fake_user),
            patch.object(accounts, "write_audit_event_safely", return_value=False),
        ):
            response = self.client.post(
                "/api/login",
                json={"username": "approved.user", "password": "generated-password"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "user")

    def test_admin_search_config_requires_admin_and_redacts_key(self) -> None:
        admin_headers = self._admin_headers()
        self.assertEqual(
            self.client.get("/api/admin/custom-intelligence/search-config").status_code,
            401,
        )
        main.session_tokens["search-config-user"] = {
            "username": "search-user",
            "name": "Search User",
            "role": "user",
            "is_admin": False,
            "user_id": 9,
        }
        user_headers = {"Authorization": "Bearer search-config-user"}
        self.assertEqual(
            self.client.get("/api/admin/custom-intelligence/search-config", headers=user_headers).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                "/api/admin/custom-intelligence/search-config/reveal-key",
                json={"password": "route-audit-password"},
            ).status_code,
            401,
        )
        self.assertEqual(
            self.client.post(
                "/api/admin/custom-intelligence/search-config/reveal-key",
                headers=user_headers,
                json={"password": "route-audit-password"},
            ).status_code,
            403,
        )
        with patch.dict(
            os.environ,
            {
                "CUSTOM_INTELLIGENCE_DB_PATH": str(
                    Path(_RUNTIME_DIR.name) / "route-search-config.db"
                ),
                "BAIDU_QIANFAN_API_KEY": "bce-v3/route-secret-key",
                "BAIDU_QIANFAN_ENDPOINT": "https://route.example.com",
            },
        ):
            saved = self.client.post(
                "/api/admin/custom-intelligence/search-config",
                headers=admin_headers,
                json={
                    "enabled": True,
                    "timeout_seconds": 30,
                    "api_key": "bce-v3/route-secret-key",
                },
            )
            self.assertEqual(saved.status_code, 200)
            body = saved.json()
            self.assertNotIn("api_key", body)
            self.assertEqual(body["api_key_mask"], "bce-v3/••••••••••••••••")
            self.assertTrue(body["has_api_key"])
            self.assertEqual(body["config_source"], "admin")
            self.assertNotIn("route-secret-key", saved.text)

            loaded = self.client.get(
                "/api/admin/custom-intelligence/search-config",
                headers=admin_headers,
            )
            self.assertEqual(loaded.status_code, 200)
            self.assertEqual(loaded.json()["api_key_mask"], "bce-v3/••••••••••••••••")
            self.assertNotIn("route-secret-key", loaded.text)

            wrong_password = self.client.post(
                "/api/admin/custom-intelligence/search-config/reveal-key",
                headers=admin_headers,
                json={"password": "anything-wrong"},
            )
            self.assertEqual(wrong_password.status_code, 401)
            revealed = self.client.post(
                "/api/admin/custom-intelligence/search-config/reveal-key",
                headers=admin_headers,
                json={"password": "route-audit-password"},
            )
            self.assertEqual(revealed.status_code, 200)
            self.assertEqual(revealed.json(), {"api_key": "bce-v3/route-secret-key"})

            changed = self.client.post(
                "/api/admin/custom-intelligence/search-config",
                headers=admin_headers,
                json={
                    "enabled": True,
                    "timeout_seconds": 45,
                    "api_key": "bce-v3/changed-secret-key",
                },
            )
            self.assertEqual(changed.status_code, 200)
            self.assertNotIn("changed-secret-key", changed.text)
            revealed_changed = self.client.post(
                "/api/admin/custom-intelligence/search-config/reveal-key",
                headers=admin_headers,
                json={"password": "route-audit-password"},
            )
            self.assertEqual(revealed_changed.status_code, 200)
            self.assertEqual(revealed_changed.json(), {"api_key": "bce-v3/changed-secret-key"})

    def test_admin_user_and_audit_lists_support_search_and_pagination(self) -> None:
        headers = self._admin_headers()
        marker = uuid.uuid4().hex
        for index in range(5):
            accounts.create_user(
                f"Pagination User {index}",
                f"pagination-{marker}-{index}@csco.com.cn",
                "Pagination Department",
            )

        users_page_one = self.client.get(
            f"/api/admin/users?q=pagination-{marker}&page=1&page_size=4",
            headers=headers,
        )
        self.assertEqual(users_page_one.status_code, 200)
        self.assertEqual(users_page_one.json()["meta"]["total"], 5)
        self.assertEqual(users_page_one.json()["meta"]["total_pages"], 2)
        self.assertEqual(len(users_page_one.json()["users"]), 4)

        users_last_page = self.client.get(
            f"/api/admin/users?q=pagination-{marker}&page=99&page_size=4",
            headers=headers,
        )
        self.assertEqual(users_last_page.status_code, 200)
        self.assertEqual(users_last_page.json()["meta"]["page"], 2)
        self.assertEqual(len(users_last_page.json()["users"]), 1)

        deleted_user_id = users_last_page.json()["users"][0]["id"]
        deleted = self.client.delete(f"/api/admin/users/{deleted_user_id}", headers=headers)
        self.assertEqual(deleted.status_code, 200)
        users_after_delete = self.client.get(
            f"/api/admin/users?q=pagination-{marker}&page=2&page_size=4",
            headers=headers,
        )
        self.assertEqual(users_after_delete.status_code, 200)
        self.assertEqual(users_after_delete.json()["meta"]["page"], 1)
        self.assertEqual(len(users_after_delete.json()["users"]), 4)

        for index in range(21):
            accounts.record_event(
                event_type="qualification_application",
                metadata={"name": f"Audit Search {marker}", "department": "Pagination Department"},
            )

        audit_page_one = self.client.get(
            f"/api/admin/audit/events?type=qualification_application&q={marker}&page=1&page_size=20",
            headers=headers,
        )
        self.assertEqual(audit_page_one.status_code, 200)
        self.assertEqual(audit_page_one.json()["meta"]["total"], 21)
        self.assertEqual(audit_page_one.json()["meta"]["total_pages"], 2)
        self.assertEqual(len(audit_page_one.json()["events"]), 20)

        audit_last_page = self.client.get(
            f"/api/admin/audit/events?type=qualification_application&q={marker}&page=99&page_size=20",
            headers=headers,
        )
        self.assertEqual(audit_last_page.status_code, 200)
        self.assertEqual(audit_last_page.json()["meta"]["page"], 2)
        self.assertEqual(len(audit_last_page.json()["events"]), 1)

    def test_application_feedback_and_ai_routes_work_with_mocked_services(self) -> None:
        fake_user = SimpleNamespace(
            id=9,
            username="applicant",
            to_dict=lambda: {"id": 9, "username": "applicant"},
        )
        with (
            patch.object(accounts, "apply_for_user", return_value=(fake_user, "generated-password")),
            patch.object(accounts, "write_audit_event_safely", return_value=False),
        ):
            response = self.client.post(
                "/api/users/apply",
                json={"name": "Applicant", "email": "applicant@csco.com.cn", "department": "IT"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["username"], "applicant")

        headers = self._admin_headers()
        fake_feedback = SimpleNamespace(to_dict=lambda: {"id": 3, "status": "pending"})
        with patch.object(accounts, "create_feedback", return_value=fake_feedback):
            response = self.client.post(
                "/api/feedback",
                headers=headers,
                json={"category": "product_suggestion", "message": "Keep current behavior"},
            )
        self.assertEqual(response.status_code, 200)

        ai_payload = {
            "content": "mock analysis",
            "updatedAt": "2026-07-10T00:00:00+00:00",
            "analysis": {"content": "mock analysis"},
            "meta": {"generated_at": "2026-07-10T00:00:00+00:00", "source_count": 1, "window_days": 30, "cached": False},
        }
        with patch.object(ai, "load_cached_analysis", return_value=ai_payload):
            response = self.client.get("/api/ai-analysis", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["content"], "mock analysis")

        with (
            patch.object(main.job_manager, "acquire_operation"),
            patch.object(main.job_manager, "release_operation"),
            patch.object(ai, "generate_ai_analysis", return_value=ai_payload),
        ):
            response = self.client.post("/api/ai-analysis", headers=headers)
        self.assertEqual(response.status_code, 200)

    def test_job_and_sse_routes_work_with_mocked_manager(self) -> None:
        headers = self._admin_headers()
        fake_job = SimpleNamespace(job_id="job-1", job_type="scraper", status="running")
        with patch.object(main.job_manager, "start_scraper", return_value=fake_job):
            response = self.client.post("/api/jobs/scraper", headers=headers)
        self.assertEqual(response.status_code, 200)

        events = [
            {"type": "start", "job_id": "job-1", "job_type": "scraper", "message": "start", "timestamp": "now"},
            {"type": "done", "job_id": "job-1", "status": "succeeded", "exit_code": 0, "timestamp": "now"},
        ]
        with patch.object(main.job_manager, "snapshot_events", return_value=(events, True, 2)):
            response = self.client.get("/api/jobs/job-1/events", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"].split(";", 1)[0], "text/event-stream")
        self.assertGreaterEqual(len(response.content), 2048)
        self.assertIn(b'"type": "done"', response.content)

    def test_app_watch_routes_work_with_mocked_manager(self) -> None:
        headers = self._admin_headers()

        fake_job = SimpleNamespace(job_id="app-1", job_type="app-watch", status="running")
        with patch.object(main.job_manager, "start_app_watch", return_value=fake_job):
            response = self.client.post("/api/jobs/app-watch", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["job_type"], "app-watch")

        missing_path = Path(_RUNTIME_DIR.name) / "missing-app-releases.csv"
        with patch.object(datasets, "app_releases_csv_path", return_value=missing_path):
            not_found = self.client.get("/api/app-releases", headers=headers)
        self.assertEqual(not_found.status_code, 404)
        self.assertNotIn(str(missing_path), not_found.text)

        csv_path = Path(_RUNTIME_DIR.name) / "app-releases.csv"
        with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(
                handle, fieldnames=["broker_name", "app_name", "app_version"]
            )
            writer.writeheader()
            writer.writerow(
                {"broker_name": "国信证券", "app_name": "国信金太阳", "app_version": "6.0.0"}
            )
        with patch.object(datasets, "app_releases_csv_path", return_value=csv_path):
            ok = self.client.get("/api/app-releases", headers=headers)
        self.assertEqual(ok.status_code, 200)
        payload = ok.json()
        self.assertEqual(payload["meta"]["count"], 1)
        self.assertEqual(payload["records"][0]["app_version"], "6.0.0")

    def test_announcement_headers_and_conditional_request(self) -> None:
        csv_path = Path(_RUNTIME_DIR.name) / "announcement.csv"
        with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["project_name", "broker_name"])
            writer.writeheader()
            writer.writerow({"project_name": "Route test", "broker_name": "Broker"})
        main.announcement_response_cache.invalidate()
        headers = {**self._admin_headers(), "Accept-Encoding": "identity"}

        with patch.object(datasets, "announcement_csv_path", return_value=csv_path):
            response = self.client.get("/api/data/announcements", headers=headers)
            conditional = self.client.get(
                "/api/data/announcements",
                headers={**headers, "If-None-Match": response.headers["etag"]},
            )
            compressed = self.client.get(
                "/api/data/announcements",
                headers={**headers, "Accept-Encoding": "gzip"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["records"][0]["project_name"], "Route test")
        self.assertEqual(response.headers["cache-control"], "private, no-cache")
        self.assertEqual(response.headers["vary"], "Accept-Encoding")
        self.assertEqual(conditional.status_code, 304)
        self.assertEqual(compressed.headers["content-encoding"], "gzip")

    def test_custom_intelligence_options_keywords_and_connection_test_routes(self) -> None:
        headers = self._admin_headers()

        options = self.client.get("/api/custom-intelligence/options", headers=headers)
        self.assertEqual(options.status_code, 200)
        self.assertIn("analysis_configured", options.json())
        self.assertIn("max_sources_by_depth", options.json())

        keyword_payload = {
            "question": "近期券商财富管理竞争变化",
            "description": "关注头部券商的产品与客户体验",
            "keywords": ["财富管理"],
            "focus_objects": ["头部券商"],
            "analysis_perspective": "product_business",
            "max_suggestions": 8,
        }
        with patch.object(custom_intelligence_routes, "suggest_keywords", return_value=["投顾服务", "客户体验"]):
            suggested = self.client.post(
                "/api/custom-intelligence/keyword-suggestions",
                headers=headers,
                json=keyword_payload,
            )
        self.assertEqual(suggested.status_code, 200)
        self.assertEqual(suggested.json(), {"suggestions": ["投顾服务", "客户体验"]})

        with patch.object(
            custom_intelligence_routes,
            "suggest_keywords",
            side_effect=custom_intelligence_service.AnalysisConfigurationError("not configured"),
        ):
            unavailable = self.client.post(
                "/api/custom-intelligence/keyword-suggestions",
                headers=headers,
                json=keyword_payload,
            )
        self.assertEqual(unavailable.status_code, 503)

        with patch.object(
            custom_intelligence_routes,
            "test_search_configuration",
            return_value={"message": "mock connection ok", "request_id": "test-1"},
        ):
            tested = self.client.post(
                "/api/admin/custom-intelligence/search-config/test",
                headers=headers,
            )
        self.assertEqual(tested.status_code, 200)
        self.assertEqual(tested.json()["status"], "success")
        self.assertEqual(tested.json()["request_id"], "test-1")

        with patch.object(
            custom_intelligence_routes,
            "test_search_configuration",
            side_effect=TimeoutError("mock timeout"),
        ):
            failed_test = self.client.post(
                "/api/admin/custom-intelligence/search-config/test",
                headers=headers,
            )
        self.assertEqual(failed_test.status_code, 200)
        self.assertEqual(failed_test.json()["status"], "failed")
        self.assertIn("连接测试失败", failed_test.json()["message"])

    def test_custom_intelligence_topic_crud_enabled_guard_and_execute_route(self) -> None:
        headers = self._admin_headers()
        marker = uuid.uuid4().hex
        payload = {
            "name": f"主题-{marker}",
            "question": "近期证券行业监管变化",
            "description": "跟踪监管与风险",
            "keywords": ["监管"],
            "focus_objects": ["证券公司"],
            "analysis_perspective": "compliance_risk",
            "time_range": "month",
            "source_preference": "authoritative",
            "specified_sites": ["csrc.gov.cn"],
            "report_type": "risk_monitoring",
            "analysis_depth": "concise",
            "extra_requirements": "区分事实和推测",
        }
        created = self.client.post("/api/custom-intelligence/topics", headers=headers, json=payload)
        self.assertEqual(created.status_code, 201)
        topic = created.json()["topic"]
        topic_id = int(topic["id"])
        self.assertNotIn("owner_user_id", topic)

        listed = self.client.get("/api/custom-intelligence/topics", headers=headers)
        self.assertEqual(listed.status_code, 200)
        self.assertTrue(any(int(item["id"]) == topic_id for item in listed.json()["topics"]))

        detail = self.client.get(f"/api/custom-intelligence/topics/{topic_id}", headers=headers)
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["topic"]["name"], payload["name"])

        updated_payload = {**payload, "name": f"主题更新-{marker}", "analysis_depth": "deep"}
        updated = self.client.post(
            f"/api/custom-intelligence/topics/{topic_id}",
            headers=headers,
            json=updated_payload,
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["topic"]["analysis_depth"], "deep")

        disabled = self.client.post(
            f"/api/custom-intelligence/topics/{topic_id}/enabled",
            headers=headers,
            json={"enabled": False},
        )
        self.assertEqual(disabled.status_code, 200)
        self.assertFalse(disabled.json()["topic"]["enabled"])
        blocked = self.client.post(
            f"/api/custom-intelligence/topics/{topic_id}/execute",
            headers=headers,
        )
        self.assertEqual(blocked.status_code, 409)

        enabled = self.client.post(
            f"/api/custom-intelligence/topics/{topic_id}/enabled",
            headers=headers,
            json={"enabled": True},
        )
        self.assertEqual(enabled.status_code, 200)
        fake_execution = {"id": 9001, "topic_id": topic_id, "topic_name": updated_payload["name"], "status": "pending", "sources": []}
        with patch.object(custom_intelligence_routes, "submit_execution", return_value=fake_execution):
            executed = self.client.post(
                f"/api/custom-intelligence/topics/{topic_id}/execute",
                headers=headers,
            )
        self.assertEqual(executed.status_code, 202)
        self.assertEqual(executed.json()["execution"]["topic_id"], topic_id)

        deleted = self.client.delete(f"/api/custom-intelligence/topics/{topic_id}", headers=headers)
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json(), {"deleted": True, "id": topic_id})
        self.assertEqual(
            self.client.get(f"/api/custom-intelligence/topics/{topic_id}", headers=headers).status_code,
            404,
        )

    def test_custom_intelligence_execution_detail_rerun_reanalyze_and_pdf_routes(self) -> None:
        headers = self._admin_headers()
        owner_id = int(main.session_tokens[headers["Authorization"].removeprefix("Bearer ")]["user_id"])
        snapshot = {
            "question": "近期证券行业动态",
            "description": "路由矩阵测试",
            "keywords": [],
            "focus_objects": [],
            "analysis_perspective": "industry_research",
            "time_range": "month",
            "source_preference": "balanced",
            "specified_sites": [],
            "report_type": "industry_trends",
            "analysis_depth": "concise",
            "extra_requirements": "",
        }
        execution = custom_intelligence_service.store.create_execution(
            owner_id,
            snapshot,
            "instant",
            owner_id,
            original_query=snapshot["question"],
        )
        execution_id = int(execution["id"])
        source = {
            "id": "source-1",
            "title": "监管动态",
            "url": "https://example.com/article",
            "site_name": "示例网",
            "snippet": "来源摘要",
        }
        report = {
            "title": "路由矩阵报告",
            "core_conclusion": "综合结论",
            "time_range": "month",
            "report_type": "industry_trends",
            "executed_at": "2026-08-10T00:00:00+00:00",
            "key_dynamics": [],
            "focus_sections": [],
            "opportunities": [],
            "risks": [],
            "watch_items": [],
            "recommended_followups": [],
        }
        custom_intelligence_service.store.update_execution(
            execution_id,
            status="succeeded",
            search_status="succeeded",
            analysis_status="succeeded",
            sources_json=json.dumps([source], ensure_ascii=False),
            reference_aliases_json=json.dumps({"ref-1": "source-1"}),
            request_payload_json=json.dumps(
                {
                    "search_summary": {
                        "requested_source_count": 20,
                        "unique_source_count": 1,
                        "round_count": 5,
                        "supplemental_round_count": 4,
                        "reached_source_target": False,
                    },
                    "search_rounds": [
                        {
                            "round": 1,
                            "facet": "primary",
                            "status": "succeeded",
                            "raw_reference_count": 1,
                            "new_source_count": 1,
                            "new_domain_count": 1,
                            "cumulative_source_count": 1,
                        }
                    ],
                },
                ensure_ascii=False,
            ),
            report_json=json.dumps(report, ensure_ascii=False),
            completed_at="2026-08-10T00:00:00+00:00",
        )

        listed = self.client.get("/api/custom-intelligence/executions?page=1&page_size=10", headers=headers)
        self.assertEqual(listed.status_code, 200)
        self.assertTrue(any(int(item["id"]) == execution_id for item in listed.json()["executions"]))

        detail = self.client.get(f"/api/custom-intelligence/executions/{execution_id}", headers=headers)
        self.assertEqual(detail.status_code, 200)
        self.assertNotIn("request_payload", detail.json()["execution"])
        self.assertEqual(detail.json()["execution"]["sources"][0]["id"], "source-1")
        self.assertEqual(detail.json()["execution"]["search_coverage"]["round_count"], 5)
        self.assertEqual(detail.json()["execution"]["search_coverage"]["rounds"][0]["new_source_count"], 1)

        fake_rerun = {"id": 9002, "topic_id": None, "trigger_type": "rerun", "status": "pending", "sources": []}
        with patch.object(custom_intelligence_routes, "submit_execution", return_value=fake_rerun) as rerun_submit:
            rerun = self.client.post(f"/api/custom-intelligence/executions/{execution_id}/rerun", headers=headers)
        self.assertEqual(rerun.status_code, 202)
        self.assertEqual(rerun_submit.call_args.kwargs["trigger_type"], "rerun")
        self.assertEqual(rerun_submit.call_args.args[1]["question"], snapshot["question"])

        fake_reanalysis = {"id": execution_id, "status": "running", "sources": [source]}
        with patch.object(custom_intelligence_routes, "reanalyze_execution", return_value=fake_reanalysis):
            reanalyzed = self.client.post(
                f"/api/custom-intelligence/executions/{execution_id}/reanalyze",
                headers=headers,
            )
        self.assertEqual(reanalyzed.status_code, 202)
        self.assertEqual(reanalyzed.json()["execution"]["status"], "running")

        pdf = self.client.get(f"/api/custom-intelligence/executions/{execution_id}/report/pdf", headers=headers)
        self.assertEqual(pdf.status_code, 200)
        self.assertEqual(pdf.headers["content-type"], "application/pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF"))
        self.assertIn("filename*=UTF-8''", pdf.headers["content-disposition"])

        empty = custom_intelligence_service.store.create_execution(
            owner_id,
            snapshot,
            "instant",
            owner_id,
            original_query="无来源记录",
        )
        empty_id = int(empty["id"])
        self.assertEqual(
            self.client.get(f"/api/custom-intelligence/executions/{empty_id}/report/pdf", headers=headers).status_code,
            409,
        )
        custom_intelligence_service.store.update_execution(
            empty_id,
            status="failed",
            search_status="failed",
            analysis_status="not_run",
            error_message="route test cleanup",
            completed_at="2026-08-10T00:00:01+00:00",
        )


if __name__ == "__main__":
    unittest.main()
