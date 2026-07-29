from __future__ import annotations

import os
import csv
import tempfile
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
            ("GET", "/api/app-releases"),
            ("GET", "/api/jobs/{job_id}"),
            ("POST", "/api/jobs/{job_id}/cancel"),
            ("GET", "/api/jobs/{job_id}/events"),
        }
        self.assertTrue(expected.issubset(registered), expected - registered)

        client_source = (
            Path(__file__).resolve().parents[2]
            / "frontend"
            / "src"
            / "lib"
            / "api"
            / "backend-client.ts"
        ).read_text(encoding="utf-8")
        self.assertNotIn("/api/auth/login", client_source)

    def test_admin_and_approved_user_login_are_fastapi_features(self) -> None:
        admin_headers = self._admin_headers()
        self.assertTrue(admin_headers["Authorization"].startswith("Bearer "))

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


if __name__ == "__main__":
    unittest.main()
