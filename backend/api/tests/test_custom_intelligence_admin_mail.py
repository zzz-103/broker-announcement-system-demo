from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.api.custom_intelligence_store import IntelligenceStore
from backend.api.intelligence_email import (
    EffectiveSMTPConfig,
    EmailConfigurationError,
    ExternalRecipientConfirmationRequired,
    build_email_message,
    normalize_recipients,
    render_report_html,
    send_report_email,
)
from backend.llm_table.llm_client import LLMApiConfig, resolve_llm_override_path


class FakeSMTP:
    sent: list[object] = []

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def ehlo(self):
        return None

    def login(self, username, authorization_code):
        if username != "sender@126.com":
            raise AssertionError("unexpected SMTP username")
        if authorization_code != "test-auth-code":
            raise AssertionError("unexpected authorization code")

    def send_message(self, message):
        self.sent.append(message)


class FailingSMTP(FakeSMTP):
    def login(self, username, authorization_code):
        raise OSError("mock connection failure")


class CustomIntelligenceAdminMailTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "custom.db"
        self.override_path = Path(self.temp_dir.name) / "llm.override.json"
        self.env_patch = patch.dict(
            os.environ,
            {
                "CUSTOM_INTELLIGENCE_DB_PATH": str(self.db_path),
                "LLM_CONFIG_OVERRIDE_PATH": str(self.override_path),
            },
            clear=False,
        )
        self.env_patch.start()

    def tearDown(self):
        self.env_patch.stop()
        self.temp_dir.cleanup()

    def test_additive_schema_and_planning_delivery_fields(self):
        store = IntelligenceStore()
        store.ensure_schema()
        topic = store.create_topic(
            11,
            {
                "name": "新主题",
                "analysis_perspective": "industry_research",
                "time_range": "month",
                "source_preference": "balanced",
                "report_type": "industry_trends",
                "analysis_depth": "standard",
                "config_version": 2,
                "audience": "管理层",
                "focus_tags": ["竞争格局"],
            },
            11,
        )
        self.assertEqual(topic["audience"], "管理层")
        execution = store.create_execution(11, {}, "instant", 11)
        execution = store.update_execution(execution["id"], planning_status="degraded", planning_error_message="fallback")
        self.assertEqual(execution["planning_status"], "degraded")
        log = store.create_delivery_log(
            execution_id=int(execution["id"]),
            owner_user_id=11,
            recipient="owner@csco.com.cn",
            format="html",
            status="sent",
            external_confirmed=False,
        )
        self.assertFalse(log["external_confirmed"])

    def test_llm_override_wins_over_fallback_and_is_json(self):
        fallback = Path(self.temp_dir.name) / "fallback.json"
        fallback.write_text(
            json.dumps({"base_url": "https://fallback", "api_key": "fallback-key", "model": "fallback-model"}),
            encoding="utf-8",
        )
        self.override_path.write_text(
            json.dumps({"base_url": "https://override", "api_key": "override-key", "model": "override-model"}),
            encoding="utf-8",
        )
        loaded = LLMApiConfig.load(fallback)
        self.assertEqual(loaded.base_url, "https://override")
        self.assertEqual(loaded.api_key, "override-key")
        self.assertEqual(resolve_llm_override_path(), self.override_path.resolve())

    def test_v2_html_citations_and_external_confirmation(self):
        execution = {
            "status": "succeeded",
            "search_status": "succeeded",
            "original_query": "问题",
            "snapshot": {},
            "sources": [{"id": "s1", "title": "来源", "url": "https://example.test"}],
            "report": {
                "version": 2,
                "title": "报告",
                "core_judgment": [{"type": "fact", "text": "事实", "source_ids": ["s1"]}],
                "key_developments": [{"type": "recommendation", "text": "建议", "source_ids": ["s1"]}],
                "impact_analysis": [],
                "company_implications": [],
                "risks_and_watch_items": [],
            },
        }
        _, document = render_report_html(execution)
        self.assertIn("[1]", document)
        self.assertIn("分析建议", document)
        for heading in ("核心判断", "关键动态与案例", "影响分析", "对公司的启示", "风险与关注事项", "信息来源"):
            self.assertIn(f"<h2>{heading}</h2>", document)
        with self.assertRaises(ExternalRecipientConfirmationRequired):
            normalize_recipients(["outside@example.com"], external_confirmed=False)

    def test_smtp_is_mocked_and_each_recipient_gets_message(self):
        FakeSMTP.sent = []
        execution = {
            "status": "succeeded",
            "search_status": "succeeded",
            "analysis_status": "succeeded",
            "sources": [{"id": "s1", "title": "来源", "url": "https://example.test"}],
            "report": {"version": 2, "title": "报告", "core_judgment": []},
        }
        config = EffectiveSMTPConfig(True, "smtp.126.com", 465, "sender@126.com", "sender@126.com", "test-auth-code", True, 5, "test")
        with patch("backend.api.intelligence_email.smtplib.SMTP_SSL", FakeSMTP):
            results = send_report_email(
                execution,
                ["a@csco.com.cn", "b@csco.com.cn"],
                "html",
                external_confirmed=False,
                config=config,
            )
        self.assertEqual([item["status"] for item in results], ["sent", "sent"])
        self.assertEqual(len(FakeSMTP.sent), 2)
        self.assertTrue(all(str(message["From"]) == "sender@126.com" for message in FakeSMTP.sent))

    def test_connection_failure_returns_safe_per_recipient_results(self):
        execution = {
            "status": "succeeded",
            "search_status": "succeeded",
            "analysis_status": "succeeded",
            "sources": [{"id": "s1", "title": "来源", "url": "https://example.test"}],
            "report": {"version": 2, "title": "报告", "core_judgment": []},
        }
        config = EffectiveSMTPConfig(True, "smtp.126.com", 465, "sender@126.com", "sender@126.com", "test-auth-code", True, 5, "test")
        with patch("backend.api.intelligence_email.smtplib.SMTP_SSL", FailingSMTP):
            results = send_report_email(
                execution,
                ["a@csco.com.cn", "b@csco.com.cn"],
                "html",
                external_confirmed=False,
                config=config,
            )
        self.assertEqual([item["status"] for item in results], ["failed", "failed"])
        self.assertTrue(all(item["error_message"] == "邮件发送失败" for item in results))
        self.assertNotIn("mock connection failure", json.dumps(results, ensure_ascii=False))

    def test_legacy_report_cannot_be_sent_as_v2_email(self):
        execution = {
            "status": "succeeded",
            "search_status": "succeeded",
            "analysis_status": "succeeded",
            "sources": [{"id": "s1", "title": "来源", "url": "https://example.test"}],
            "report": {"title": "旧版报告", "core_conclusion": "旧版结论"},
        }
        config = EffectiveSMTPConfig(True, "smtp.126.com", 465, "sender@126.com", "sender@126.com", "test-auth-code", True, 5, "test")
        with self.assertRaisesRegex(EmailConfigurationError, "Report V2"):
            send_report_email(
                execution,
                ["owner@csco.com.cn"],
                "html",
                external_confirmed=False,
                config=config,
            )

    def test_pdf_attachment_uses_the_same_persisted_execution(self):
        execution = {
            "status": "succeeded",
            "search_status": "succeeded",
            "analysis_status": "succeeded",
            "sources": [{"id": "s1", "title": "来源", "url": "https://example.test"}],
            "report": {
                "version": 2,
                "title": "同一份 V2 报告",
                "core_judgment": [{"type": "fact", "text": "事实", "source_ids": ["s1"]}],
                "key_developments": [],
                "impact_analysis": [],
                "company_implications": [],
                "risks_and_watch_items": [],
            },
        }
        config = EffectiveSMTPConfig(True, "smtp.126.com", 465, "sender@126.com", "sender@126.com", "test-auth-code", True, 5, "test")
        with (
            patch("backend.api.intelligence_report_pdf.build_report_pdf", return_value=b"%PDF-mock") as pdf_builder,
            patch("backend.api.intelligence_report_pdf.report_pdf_filename", return_value="report.pdf"),
        ):
            message = build_email_message(execution, "owner@csco.com.cn", "pdf", config)
        pdf_builder.assert_called_once_with(execution)
        self.assertEqual(message.get_content_type(), "multipart/mixed")
        attachment = next(part for part in message.walk() if part.get_content_type() == "application/pdf")
        self.assertEqual(attachment.get_payload(decode=True), b"%PDF-mock")


if __name__ == "__main__":
    unittest.main()
