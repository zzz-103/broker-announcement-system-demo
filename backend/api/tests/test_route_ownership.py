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
from backend.api import dashboard_package as dashboard_package_module  # noqa: E402
from backend.api import dashboard_package_import as dashboard_import_module  # noqa: E402
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
            ("POST", "/api/admin/users/{user_id}/promote"),
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
            ("GET", "/api/dashboard-data/source"),
            ("POST", "/api/dashboard-data/source"),
            ("POST", "/api/dashboard-data/import/preview"),
            ("POST", "/api/dashboard-data/import"),
            ("POST", "/api/dashboard-data/export"),
            ("GET", "/api/dashboard-data/export.zip"),
            ("GET", "/api/jobs/{job_id}"),
            ("POST", "/api/jobs/{job_id}/cancel"),
            ("GET", "/api/jobs/{job_id}/events"),
            ("GET", "/api/custom-intelligence/options"),
            ("POST", "/api/custom-intelligence/query-plan"),
            ("GET", "/api/custom-intelligence/topics"),
            ("POST", "/api/custom-intelligence/topics"),
            ("GET", "/api/custom-intelligence/topics/{topic_id}"),
            ("POST", "/api/custom-intelligence/topics/{topic_id}"),
            ("DELETE", "/api/custom-intelligence/topics/{topic_id}"),
            ("POST", "/api/custom-intelligence/topics/{topic_id}/execute"),
            ("GET", "/api/custom-intelligence/executions"),
            ("POST", "/api/custom-intelligence/executions"),
            ("GET", "/api/custom-intelligence/executions/{execution_id}"),
            ("POST", "/api/custom-intelligence/executions/{execution_id}/rerun"),
            ("POST", "/api/custom-intelligence/executions/{execution_id}/reanalyze"),
            ("POST", "/api/custom-intelligence/executions/{execution_id}/email"),
            ("GET", "/api/custom-intelligence/executions/{execution_id}/report/pdf"),
            ("GET", "/api/admin/custom-intelligence/search-config"),
            ("POST", "/api/admin/custom-intelligence/search-config"),
            ("POST", "/api/admin/custom-intelligence/search-config/test"),
            ("POST", "/api/admin/custom-intelligence/search-config/reveal-key"),
            ("GET", "/api/admin/custom-intelligence/llm-config"),
            ("POST", "/api/admin/custom-intelligence/llm-config"),
            ("POST", "/api/admin/custom-intelligence/llm-config/test"),
            ("POST", "/api/admin/custom-intelligence/llm-config/reveal-key"),
            ("GET", "/api/admin/custom-intelligence/smtp-config"),
            ("POST", "/api/admin/custom-intelligence/smtp-config"),
            ("POST", "/api/admin/custom-intelligence/smtp-config/test"),
            ("POST", "/api/admin/custom-intelligence/smtp-config/reveal-authorization-code"),
            ("GET", "/api/admin/custom-intelligence/default-rules"),
            ("POST", "/api/admin/custom-intelligence/default-rules"),
            ("GET", "/api/admin/custom-intelligence/executions"),
            ("GET", "/api/admin/custom-intelligence/executions/{execution_id}"),
            ("GET", "/api/admin/custom-intelligence/executions/{execution_id}/diagnostics"),
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

    def test_dashboard_source_and_import_require_admin_and_map_bad_zip(self) -> None:
        for method, path in (
            ("get", "/api/dashboard-data/source"),
            ("post", "/api/dashboard-data/source"),
            ("post", "/api/dashboard-data/import/preview"),
            ("post", "/api/dashboard-data/import"),
        ):
            kwargs = {"json": {"source": "live"}} if path.endswith("/source") and method == "post" else {}
            response = getattr(self.client, method)(path, **kwargs)
            self.assertEqual(response.status_code, 401, path)

        headers = self._admin_headers()
        invalid = self.client.post(
            "/api/dashboard-data/import/preview",
            headers={**headers, "content-type": "application/zip"},
            content=b"not-a-zip",
        )
        self.assertEqual(invalid.status_code, 422)
        self.assertIn("ZIP", invalid.json()["detail"])

        invalid_source = self.client.post(
            "/api/dashboard-data/source",
            headers=headers,
            json={"source": "invalid"},
        )
        self.assertEqual(invalid_source.status_code, 422)

    def test_fastapi_serves_static_export_page_routes(self) -> None:
        if os.environ.get("RUN_FRONTEND_STATIC_SMOKE") != "1":
            self.skipTest("set RUN_FRONTEND_STATIC_SMOKE=1 to run the frontend static smoke")
        if not main._frontend_dist.is_dir():
            self.fail(f"frontend static export is required for smoke tests: {main._frontend_dist}")
        for path in ("/", "/admin", "/app-updates", "/custom-intelligence"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertIn("text/html", response.headers.get("content-type", ""), path)

        version = self.client.get("/version.json")
        self.assertEqual(version.status_code, 200)
        self.assertIn("version", version.json())

    def test_llm_external_route_requires_admin_and_starts_mocked_manager(self) -> None:
        self.assertEqual(self.client.post("/api/jobs/llm-external").status_code, 401)
        headers = self._admin_headers()
        fake_job = SimpleNamespace(job_id="external-1", job_type="llm-external", status="running")
        with patch.object(main.job_manager, "start_llm_external", return_value=fake_job) as start:
            response = self.client.post("/api/jobs/llm-external", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"job_id": "external-1", "job_type": "llm-external", "status": "running"})
        start.assert_called_once_with()

    def test_dashboard_export_preview_import_source_and_fresh_client_read(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tender = root / "announcement.csv"
            app_releases = root / "app-releases.csv"
            analysis = root / "analysis.json"
            export_dir = root / "export"
            tender.write_text(
                "document_sha1,broker_name,is_broker_project,publish_date,announcement_stage,project_name\n"
                "route-tender,测试证券,true,2026-08-01,招标公告,测试交易系统建设\n",
                encoding="utf-8",
            )
            app_releases.write_text(
                "broker_code,broker_name,app_name,source_url,publish_date,update_type,update_summary,feature_tags,highlights\n"
                "test,测试证券,测试 App,https://example.test/app,2026-08-02,新功能,新增能力,[],[]\n",
                encoding="utf-8",
            )
            analysis.write_text(json.dumps({"content": "测试分析"}), encoding="utf-8")
            imported_zip = root / "imported.zip"
            preference = root / "source-preference.json"
            settings = SimpleNamespace(
                announcement_csv_path=tender,
                app_releases_csv_path=app_releases,
                ai_analysis_cache_path=analysis,
                dashboard_data_export_dir=export_dir,
                dashboard_data_imported_zip_path=imported_zip,
                dashboard_data_source_preference_path=preference,
                matching_procurement_csv_path=root / "matching" / "announcement_table.csv",
                matching_result_csv_path=root / "matching" / "result_table.csv",
                matching_verified_links_path=root / "matching" / "llm_verified_links.csv",
                matching_state_path=root / "matching" / "matching_state.json",
                imported_matching_baseline_path=root / "matching" / "imported_matching_baseline.json",
            )
            dashboard_import_module.imported_package_store.invalidate()
            headers = self._admin_headers()
            with (
                patch.object(dashboard_package_module, "settings", settings),
                patch.object(dashboard_import_module, "settings", settings),
            ):
                exported = self.client.post("/api/dashboard-data/export", headers=headers)
                self.assertEqual(exported.status_code, 200)
                archive = self.client.get("/api/dashboard-data/export.zip", headers=headers)
                self.assertEqual(archive.status_code, 200)
                self.assertEqual(archive.headers["content-type"].split(";", 1)[0], "application/zip")

                preview = self.client.post(
                    "/api/dashboard-data/import/preview",
                    headers={**headers, "content-type": "application/zip"},
                    content=archive.content,
                )
                self.assertEqual(preview.status_code, 200)
                self.assertTrue(preview.json()["valid"])

                imported = self.client.post(
                    "/api/dashboard-data/import",
                    headers={**headers, "content-type": "application/zip"},
                    content=archive.content,
                )
                self.assertEqual(imported.status_code, 200)
                self.assertEqual(imported.json()["source"]["active_source"], "imported")
                source = self.client.get("/api/dashboard-data/source", headers=headers)
                self.assertEqual(source.status_code, 200)
                self.assertEqual(source.json()["active_source"], "imported")

                dashboard_import_module.imported_package_store.invalidate()
                with TestClient(main.app) as fresh_client:
                    dataset = fresh_client.get("/api/dashboard-data/files/tender_projects", headers=headers)
                self.assertEqual(dataset.status_code, 200)
                self.assertEqual(dataset.json()[0]["project_name"], "测试交易系统建设")

    def test_custom_intelligence_requires_authentication(self) -> None:
        for method, path in (
            ("get", "/api/custom-intelligence/options"),
            ("get", "/api/custom-intelligence/topics"),
            ("get", "/api/custom-intelligence/executions"),
        ):
            response = getattr(self.client, method)(path)
            self.assertEqual(response.status_code, 401)

    def test_query_plan_preview_requires_auth_and_does_not_create_execution(self) -> None:
        unauthenticated_payload = {
            "audience": "management",
            "focus": "近期证券行业变化",
            "focus_tags": [],
            "time_range": "month",
            "report_length": "standard",
        }
        self.assertEqual(
            self.client.post("/api/custom-intelligence/query-plan", json=unauthenticated_payload).status_code,
            401,
        )
        headers = self._admin_headers()
        payload = {
            "audience": "management",
            "audience_detail": "",
            "focus_tags": ["监管政策"],
            "focus": "近期证券行业变化",
            "extra_focus": "",
            "time_range": "month",
            "report_length": "standard",
        }
        with (
            patch.object(custom_intelligence_routes, "query_plan_preview", return_value={
                "intent": "行业变化",
                "directions": ["近期证券行业变化", "监管政策影响"],
                "degraded": False,
            }) as preview,
            patch.object(custom_intelligence_routes.store, "create_execution") as create_execution,
            patch.object(custom_intelligence_service.client, "search") as search,
        ):
            response = self.client.post("/api/custom-intelligence/query-plan", headers=headers, json=payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["directions"], ["近期证券行业变化", "监管政策影响"])
        preview.assert_called_once()
        create_execution.assert_not_called()
        search.assert_not_called()

    def test_v2_execution_input_rejects_unknown_audience_and_invalid_focus_tags(self) -> None:
        headers = self._admin_headers()
        base = {
            "audience_detail": "",
            "focus": "关注近期证券行业变化",
            "extra_focus": "",
            "time_range": "month",
            "report_length": "standard",
        }
        invalid_audience = self.client.post(
            "/api/custom-intelligence/executions",
            headers=headers,
            json={**base, "audience": "unknown-audience", "focus_tags": []},
        )
        self.assertEqual(invalid_audience.status_code, 422)
        missing_custom_detail = self.client.post(
            "/api/custom-intelligence/executions",
            headers=headers,
            json={**base, "audience": "custom", "focus_tags": []},
        )
        self.assertEqual(missing_custom_detail.status_code, 422)
        too_many_tags = self.client.post(
            "/api/custom-intelligence/executions",
            headers=headers,
            json={
                **base,
                "audience": "management",
                "focus_tags": ["行业趋势", "竞争格局", "监管政策", "战略机会", "盈利能力", "同业动作", "资源配置", "关键风险", "超出上限"],
            },
        )
        self.assertEqual(too_many_tags.status_code, 422)
        hidden_source_parameter = self.client.post(
            "/api/custom-intelligence/executions",
            headers=headers,
            json={
                **base,
                "audience": "management",
                "focus_tags": [],
                "source_preference": "authoritative",
            },
        )
        self.assertEqual(hidden_source_parameter.status_code, 422)

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
            "audience": "industry_research",
            "audience_detail": "",
            "focus_tags": ["同业竞争"],
            "focus": "近期证券行业变化",
            "extra_focus": "",
            "time_range": "month",
            "report_length": "concise",
        }
        with (
            patch.dict(os.environ, {"BAIDU_QIANFAN_API_KEY": "test-only"}),
            patch.object(
                custom_intelligence_service,
                "_request_query_plan",
                return_value={
                    "intent": "验证路由所有权",
                    "queries": [
                        {"query": "证券行业变化", "purpose": "行业动态"},
                        {"query": "券商经营变化", "purpose": "经营影响"},
                    ],
                },
            ),
            patch.object(custom_intelligence_service, "analysis_service_configured", return_value=True),
            patch.object(custom_intelligence_service.client, "search", side_effect=fake_search),
            patch.object(
                custom_intelligence_service,
                "_request_analysis",
                return_value={
                    "version": 2,
                    "title": "路由测试报告",
                    "audience": "industry_research",
                    "executed_at": "now",
                    "time_range": "month",
                    "report_length": "concise",
                    "core_judgment": [
                        {"type": "analysis", "text": "综合结论", "source_ids": ["source-1"]}
                    ],
                    "key_developments": [],
                    "impact_analysis": [],
                    "company_implications": [],
                    "risks_and_watch_items": [],
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
        self.assertNotIn("request_id", completed.json()["execution"])
        self.assertEqual(len(completed.json()["execution"]["sources"]), 1)

    def test_admin_and_approved_user_login_are_fastapi_features(self) -> None:
        admin_headers = self._admin_headers()
        self.assertTrue(admin_headers["Authorization"].startswith("Bearer "))
        admin_token = admin_headers["Authorization"].removeprefix("Bearer ")
        self.assertEqual(main.session_tokens[admin_token]["user_id"], 0)
        self.assertTrue(main.session_tokens[admin_token]["is_super_admin"])

        fake_user = SimpleNamespace(id=7, username="approved.user", name="Approved User", email="approved.user@csco.com.cn")
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
        self.assertEqual(response.json()["email"], "approved.user@csco.com.cn")

    def test_super_admin_can_promote_and_promoted_admin_keeps_admin_access(self) -> None:
        admin_headers = self._admin_headers()
        suffix = uuid.uuid4().hex[:8]
        created = self.client.post(
            "/api/admin/users",
            headers=admin_headers,
            json={"name": "Promoted Admin", "email": f"promoted-{suffix}@example.com", "department": "Test"},
        )
        self.assertEqual(created.status_code, 200)
        user_id = int(created.json()["user"]["id"])
        initial_password = str(created.json()["initial_password"])

        main.session_tokens["ordinary-admin"] = {
            "username": "ordinary-admin",
            "name": "Ordinary Admin",
            "role": "admin",
            "is_admin": True,
            "is_super_admin": False,
            "user_id": 9999,
        }
        ordinary_headers = {"Authorization": "Bearer ordinary-admin"}
        self.assertEqual(
            self.client.post(f"/api/admin/users/{user_id}/promote", headers=ordinary_headers).status_code,
            403,
        )
        promoted = self.client.post(f"/api/admin/users/{user_id}/promote", headers=admin_headers)
        self.assertEqual(promoted.status_code, 200)
        self.assertEqual(promoted.json()["user"]["role"], "admin")

        with patch.object(accounts, "write_audit_event_safely", return_value=False):
            login = self.client.post(
                "/api/login",
                json={"username": created.json()["user"]["username"], "password": initial_password},
            )
        self.assertEqual(login.status_code, 200)
        self.assertTrue(login.json()["is_admin"])
        self.assertFalse(login.json()["is_super_admin"])
        promoted_headers = {"Authorization": f"Bearer {login.json()['token']}"}
        self.assertEqual(self.client.get("/api/admin/users", headers=promoted_headers).status_code, 200)
        self.assertEqual(
            self.client.post(
                "/api/admin/verify-password",
                headers=promoted_headers,
                json={"password": initial_password},
            ).status_code,
            200,
        )
        self.assertEqual(self.client.delete(f"/api/admin/users/{user_id}", headers=admin_headers).status_code, 409)

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

    def test_admin_llm_smtp_rules_and_diagnostics_are_guarded_and_redacted(self) -> None:
        admin_headers = self._admin_headers()
        main.session_tokens["ai-config-user"] = {
            "username": "ai-config-user",
            "name": "AI Config User",
            "role": "user",
            "is_admin": False,
            "user_id": 21,
        }
        user_headers = {"Authorization": "Bearer ai-config-user"}
        for path in (
            "/api/admin/custom-intelligence/llm-config",
            "/api/admin/custom-intelligence/smtp-config",
            "/api/admin/custom-intelligence/default-rules",
            "/api/admin/custom-intelligence/executions",
        ):
            self.assertEqual(self.client.get(path).status_code, 401, path)
            self.assertEqual(self.client.get(path, headers=user_headers).status_code, 403, path)

        config_db = Path(_RUNTIME_DIR.name) / f"ai-config-{uuid.uuid4().hex}.db"
        override_path = Path(_RUNTIME_DIR.name) / f"llm-override-{uuid.uuid4().hex}.json"
        with patch.dict(
            os.environ,
            {
                "CUSTOM_INTELLIGENCE_DB_PATH": str(config_db),
                "LLM_CONFIG_OVERRIDE_PATH": str(override_path),
            },
        ):
            llm_secret = "test-deepseek-handoff-key"
            saved_llm = self.client.post(
                "/api/admin/custom-intelligence/llm-config",
                headers=admin_headers,
                json={
                    "enabled": True,
                    "base_url": "https://llm.example.test/v1",
                    "model": "test-deepseek-model",
                    "api_key": llm_secret,
                    "temperature": 0.1,
                    "top_p": 1,
                    "max_tokens": 524288,
                    "timeout_seconds": 60,
                    "use_json_object": True,
                },
            )
            self.assertEqual(saved_llm.status_code, 200)
            self.assertNotIn(llm_secret, saved_llm.text)
            self.assertTrue(saved_llm.json()["has_api_key"])
            self.assertEqual(saved_llm.json()["config_source"], "override")
            self.assertEqual(
                self.client.post(
                    "/api/admin/custom-intelligence/llm-config/reveal-key",
                    headers=admin_headers,
                    json={"password": "wrong-password"},
                ).status_code,
                401,
            )
            revealed_llm = self.client.post(
                "/api/admin/custom-intelligence/llm-config/reveal-key",
                headers=admin_headers,
                json={"password": "route-audit-password"},
            )
            self.assertEqual(revealed_llm.json(), {"api_key": llm_secret})
            replaced_llm_secret = "test-deepseek-replaced-key"
            replaced_llm = self.client.post(
                "/api/admin/custom-intelligence/llm-config",
                headers=admin_headers,
                json={
                    "enabled": True,
                    "base_url": "https://llm.example.test/v1",
                    "model": "test-deepseek-model",
                    "api_key": replaced_llm_secret,
                    "temperature": 0.1,
                    "top_p": 1,
                    "max_tokens": 524288,
                    "timeout_seconds": 60,
                    "use_json_object": True,
                },
            )
            self.assertEqual(replaced_llm.status_code, 200)
            self.assertNotIn(replaced_llm_secret, replaced_llm.text)
            self.assertEqual(
                self.client.post(
                    "/api/admin/custom-intelligence/llm-config/reveal-key",
                    headers=admin_headers,
                    json={"password": "route-audit-password"},
                ).json(),
                {"api_key": replaced_llm_secret},
            )
            with patch.object(
                custom_intelligence_routes,
                "test_deepseek_configuration",
                return_value={"status": "success", "message": "DeepSeek mock ok"},
            ):
                tested_llm = self.client.post(
                    "/api/admin/custom-intelligence/llm-config/test",
                    headers=admin_headers,
                )
            self.assertEqual(tested_llm.json()["status"], "success")

            smtp_secret = "test-smtp-authorization-code"
            saved_smtp = self.client.post(
                "/api/admin/custom-intelligence/smtp-config",
                headers=admin_headers,
                json={
                    "enabled": True,
                    "host": "smtp.csco.com.cn",
                    "port": 465,
                    "use_ssl": True,
                    "username": "sender@csco.com.cn",
                    "from_address": "sender@csco.com.cn",
                    "authorization_code": smtp_secret,
                    "timeout_seconds": 30,
                },
            )
            self.assertEqual(saved_smtp.status_code, 200)
            smtp_body = saved_smtp.json()
            self.assertEqual((smtp_body["host"], smtp_body["port"], smtp_body["use_ssl"]), ("smtp.csco.com.cn", 465, True))
            self.assertNotIn(smtp_secret, saved_smtp.text)
            revealed_smtp = self.client.post(
                "/api/admin/custom-intelligence/smtp-config/reveal-authorization-code",
                headers=admin_headers,
                json={"password": "route-audit-password"},
            )
            self.assertEqual(revealed_smtp.json(), {"authorization_code": smtp_secret})
            replaced_smtp_secret = "test-smtp-replaced-code"
            replaced_smtp = self.client.post(
                "/api/admin/custom-intelligence/smtp-config",
                headers=admin_headers,
                json={
                    "enabled": True,
                    "username": "sender@csco.com.cn",
                    "from_address": "sender@csco.com.cn",
                    "authorization_code": replaced_smtp_secret,
                    "timeout_seconds": 30,
                },
            )
            self.assertEqual(replaced_smtp.status_code, 200)
            self.assertEqual(
                (replaced_smtp.json()["host"], replaced_smtp.json()["port"], replaced_smtp.json()["use_ssl"]),
                ("smtp.csco.com.cn", 465, True),
            )
            self.assertNotIn(replaced_smtp_secret, replaced_smtp.text)
            self.assertEqual(
                self.client.post(
                    "/api/admin/custom-intelligence/smtp-config/reveal-authorization-code",
                    headers=admin_headers,
                    json={"password": "route-audit-password"},
                ).json(),
                {"authorization_code": replaced_smtp_secret},
            )
            with patch.object(
                custom_intelligence_routes,
                "test_smtp_configuration",
                return_value={"status": "success", "message": "SMTP mock ok"},
            ):
                tested_smtp = self.client.post(
                    "/api/admin/custom-intelligence/smtp-config/test",
                    headers=admin_headers,
                )
            self.assertEqual(tested_smtp.json()["status"], "success")

            saved_rules = self.client.post(
                "/api/admin/custom-intelligence/default-rules",
                headers=admin_headers,
                json={"analysis_instructions": "优先说明对证券公司的影响。"},
            )
            self.assertEqual(saved_rules.status_code, 200)
            self.assertEqual(saved_rules.json()["analysis_instructions"], "优先说明对证券公司的影响。")

            audit = self.client.get(
                "/api/admin/audit/events?type=custom_intelligence_config_updated&page_size=100",
                headers=admin_headers,
            )
            self.assertEqual(audit.status_code, 200)
            self.assertNotIn(llm_secret, audit.text)
            self.assertNotIn(smtp_secret, audit.text)
            self.assertNotIn(replaced_llm_secret, audit.text)
            self.assertNotIn(replaced_smtp_secret, audit.text)

    def test_report_email_requires_external_confirmation_and_records_each_delivery(self) -> None:
        headers = self._admin_headers()
        email_db = Path(_RUNTIME_DIR.name) / f"email-route-{uuid.uuid4().hex}.db"
        with patch.dict(os.environ, {"CUSTOM_INTELLIGENCE_DB_PATH": str(email_db)}):
            custom_intelligence_service.store.ensure_schema()
            execution = custom_intelligence_service.store.create_execution(
                0,
                {
                    "audience": "management",
                    "focus": "测试报告发送",
                    "time_range": "month",
                    "report_length": "standard",
                },
                "instant",
                0,
                original_query="测试报告发送",
            )
            source = {
                "id": "source-1",
                "title": "真实来源",
                "url": "https://example.test/source",
                "site_name": "example.test",
                "date": "2026-08-01",
                "snippet": "来源摘要",
            }
            report = {
                "version": 2,
                "title": "测试报告",
                "audience": "management",
                "executed_at": "2026-08-10T00:00:00+00:00",
                "time_range": "month",
                "report_length": "standard",
                "core_judgment": [{"type": "fact", "text": "已核验事实", "source_ids": ["source-1"]}],
                "key_developments": [],
                "impact_analysis": [],
                "company_implications": [],
                "risks_and_watch_items": [],
            }
            custom_intelligence_service.store.update_execution(
                int(execution["id"]),
                status="succeeded",
                search_status="succeeded",
                analysis_status="succeeded",
                sources_json=json.dumps([source], ensure_ascii=False),
                report_json=json.dumps(report, ensure_ascii=False),
                completed_at="2026-08-10T00:00:00+00:00",
            )
            unconfirmed = self.client.post(
                f"/api/custom-intelligence/executions/{execution['id']}/email",
                headers=headers,
                json={
                    "recipients": ["outside@example.com"],
                    "external_confirmed": False,
                },
            )
            self.assertEqual(unconfirmed.status_code, 409)

            mock_results = [
                {"recipient": "owner@csco.com.cn", "status": "sent", "message_id": "internal-message"},
                {"recipient": "outside@example.com", "status": "sent", "message_id": "external-message"},
            ]
            with patch.object(custom_intelligence_routes, "send_report_email", return_value=mock_results) as sender:
                sent = self.client.post(
                    f"/api/custom-intelligence/executions/{execution['id']}/email",
                    headers=headers,
                    json={
                        "recipients": ["owner@csco.com.cn", "outside@example.com"],
                        "note": "你好，请看一下这份报告",
                        "delivery_format": "html_only",
                        "template_style": "newsletter",
                        "external_confirmed": True,
                    },
                )
            self.assertEqual(sent.status_code, 200)
            self.assertEqual(sent.json()["status"], "success")
            self.assertEqual(len(sent.json()["deliveries"]), 2)
            self.assertTrue(all("owner_user_id" not in item and "message_id" not in item for item in sent.json()["deliveries"]))
            self.assertTrue(sender.call_args.kwargs["external_confirmed"])
            self.assertEqual(sender.call_args.kwargs["note"], "你好，请看一下这份报告")
            self.assertEqual(sender.call_args.kwargs["delivery_format"], "html_only")
            self.assertEqual(sender.call_args.kwargs["template_style"], "newsletter")
            self.assertEqual(sender.call_args.args[1], ["owner@csco.com.cn", "outside@example.com"])
            delivery_logs = custom_intelligence_service.store.list_delivery_logs(int(execution["id"]))
            self.assertEqual(len(delivery_logs), 2)
            self.assertTrue(all(item["format"] == "html_only" for item in delivery_logs))
            self.assertEqual(
                custom_intelligence_service.store.get_execution(0, int(execution["id"]))["status"],
                "succeeded",
            )

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

    def test_custom_intelligence_options_and_connection_test_routes(self) -> None:
        headers = self._admin_headers()

        options = self.client.get("/api/custom-intelligence/options", headers=headers)
        self.assertEqual(options.status_code, 200)
        self.assertEqual(set(options.json()), {"service_status"})

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

    def test_custom_intelligence_topic_crud_and_execute_route(self) -> None:
        headers = self._admin_headers()
        marker = uuid.uuid4().hex
        payload = {
            "name": f"主题-{marker}",
            "audience": "compliance_risk",
            "audience_detail": "",
            "focus_tags": ["监管政策", "合规与风险"],
            "focus": "近期证券行业监管变化",
            "extra_focus": "区分事实和分析判断",
            "time_range": "month",
            "report_length": "concise",
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
        self.assertNotIn("keywords", detail.json()["topic"])
        self.assertNotIn("source_preference", detail.json()["topic"])
        self.assertNotIn("specified_sites", detail.json()["topic"])

        updated_payload = {**payload, "name": f"主题更新-{marker}", "report_length": "deep"}
        updated = self.client.post(
            f"/api/custom-intelligence/topics/{topic_id}",
            headers=headers,
            json=updated_payload,
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["topic"]["report_length"], "deep")

        # V2 removes the old enable switch and keeps one-click execution.
        fake_execution = {"id": 9001, "topic_id": topic_id, "topic_name": updated_payload["name"], "status": "pending", "sources": []}
        with patch.object(custom_intelligence_routes, "submit_execution", return_value=fake_execution) as topic_submit:
            executed = self.client.post(
                f"/api/custom-intelligence/topics/{topic_id}/execute",
                headers=headers,
                json={
                    "confirmed_plan": {
                        "intent": "确认主题检索",
                        "directions": ["监管变化", "券商经营变化"],
                    }
                },
            )
        self.assertEqual(executed.status_code, 202)
        self.assertEqual(executed.json()["execution"]["topic_id"], topic_id)
        self.assertEqual(
            topic_submit.call_args.args[1]["confirmed_plan"]["directions"],
            ["监管变化", "券商经营变化"],
        )
        with patch.object(custom_intelligence_routes, "submit_execution", return_value=fake_execution):
            legacy_executed = self.client.post(
                f"/api/custom-intelligence/topics/{topic_id}/execute",
                headers=headers,
            )
        self.assertEqual(legacy_executed.status_code, 202)

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
            "audience": "industry_research",
            "audience_detail": "路由矩阵测试",
            "focus_tags": [],
            "focus": "近期证券行业动态",
            "extra_focus": "",
            "time_range": "month",
            "report_length": "concise",
        }
        execution = custom_intelligence_service.store.create_execution(
            owner_id,
            snapshot,
            "instant",
            owner_id,
            original_query=snapshot["focus"],
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
            "version": 2,
            "title": "路由矩阵报告",
            "audience": "industry_research",
            "core_judgment": [{"type": "analysis", "text": "综合结论", "source_ids": ["source-1"]}],
            "time_range": "month",
            "report_length": "concise",
            "executed_at": "2026-08-10T00:00:00+00:00",
            "key_developments": [],
            "impact_analysis": [],
            "company_implications": [],
            "risks_and_watch_items": [],
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
                    "query_plan": {
                        "intent": "经 DeepSeek 整理的行业研究方向",
                        "queries": [],
                    },
                    "search_summary": {
                        "requested_source_count": 15,
                        "unique_source_count": 1,
                        "round_count": 1,
                        "reached_source_target": False,
                    },
                    "search_rounds": [
                        {
                            "round": 1,
                            "query": "近期证券行业动态",
                            "purpose": "行业动态",
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
        self.assertEqual(
            detail.json()["execution"]["research_direction"],
            "经 DeepSeek 整理的行业研究方向",
        )
        self.assertEqual(detail.json()["execution"]["sources"][0]["id"], "source-1")
        self.assertNotIn("search_coverage", detail.json()["execution"])
        admin_detail = self.client.get(
            f"/api/admin/custom-intelligence/executions/{execution_id}",
            headers=headers,
        )
        self.assertEqual(admin_detail.status_code, 200)
        self.assertEqual(admin_detail.json()["execution"]["owner_user_id"], owner_id)
        self.assertEqual(admin_detail.json()["execution"]["report"]["title"], "路由矩阵报告")
        self.assertNotIn("request_payload", admin_detail.json()["execution"])
        main.session_tokens["report-user"] = {
            "username": "report-user",
            "name": "Report User",
            "role": "user",
            "is_admin": False,
            "is_super_admin": False,
            "user_id": 88,
        }
        self.assertEqual(
            self.client.get(
                f"/api/admin/custom-intelligence/executions/{execution_id}",
                headers={"Authorization": "Bearer report-user"},
            ).status_code,
            403,
        )
        diagnostics = self.client.get(
            f"/api/admin/custom-intelligence/executions/{execution_id}/diagnostics",
            headers=headers,
        )
        self.assertEqual(diagnostics.status_code, 200)
        self.assertEqual(diagnostics.json()["diagnostics"]["counts"]["round_count"], 1)
        self.assertEqual(diagnostics.json()["diagnostics"]["search"]["rounds"][0]["new_source_count"], 1)

        fake_rerun = {"id": 9002, "topic_id": None, "trigger_type": "rerun", "status": "pending", "sources": []}
        with patch.object(custom_intelligence_routes, "submit_execution", return_value=fake_rerun) as rerun_submit:
            rerun = self.client.post(
                f"/api/custom-intelligence/executions/{execution_id}/rerun",
                headers=headers,
                json={
                    "confirmed_plan": {
                        "intent": "确认重跑方向",
                        "directions": ["监管变化", "经营动态"],
                    }
                },
            )
        self.assertEqual(rerun.status_code, 202)
        self.assertEqual(rerun_submit.call_args.kwargs["trigger_type"], "rerun")
        self.assertEqual(rerun_submit.call_args.args[1]["focus"], snapshot["focus"])
        self.assertEqual(
            rerun_submit.call_args.args[1]["confirmed_plan"]["intent"],
            "确认重跑方向",
        )
        with patch.object(custom_intelligence_routes, "submit_execution", return_value=fake_rerun):
            legacy_rerun = self.client.post(
                f"/api/custom-intelligence/executions/{execution_id}/rerun",
                headers=headers,
            )
        self.assertEqual(legacy_rerun.status_code, 202)

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
        newsletter_pdf = self.client.get(
            f"/api/custom-intelligence/executions/{execution_id}/report/pdf?template_style=newsletter",
            headers=headers,
        )
        self.assertEqual(newsletter_pdf.status_code, 200)
        self.assertTrue(newsletter_pdf.content.startswith(b"%PDF"))

        legacy = custom_intelligence_service.store.create_execution(
            owner_id,
            snapshot,
            "instant",
            owner_id,
            original_query="旧版报告",
        )
        legacy_id = int(legacy["id"])
        custom_intelligence_service.store.update_execution(
            legacy_id,
            status="succeeded",
            search_status="succeeded",
            analysis_status="succeeded",
            sources_json=json.dumps([source], ensure_ascii=False),
            report_json=json.dumps({"title": "旧版报告", "core_conclusion": "旧版结论"}, ensure_ascii=False),
            completed_at="2026-08-10T00:00:00+00:00",
        )
        self.assertEqual(
            self.client.get(f"/api/custom-intelligence/executions/{legacy_id}/report/pdf", headers=headers).status_code,
            409,
        )

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
