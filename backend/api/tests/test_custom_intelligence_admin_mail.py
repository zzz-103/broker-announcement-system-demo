from __future__ import annotations

import json
import os
import ssl
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.api import ai_analysis
from backend.api.custom_intelligence_store import IntelligenceStore
from backend.api.intelligence_email import (
    EMAIL_SUBJECT,
    EffectiveSMTPConfig,
    EmailConfigurationError,
    ExternalRecipientConfirmationRequired,
    build_email_message,
    normalize_recipients,
    render_report_html,
    send_report_email,
)
from backend.api.intelligence_report_view import build_report_view
from backend.llm_table.llm_client import (
    LLMApiConfig,
    llm_config_available,
    resolve_llm_override_path,
)


class FakeSMTP:
    sent: list[object] = []
    calls: list[dict[str, object]] = []

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        self.calls.append({"args": args, "kwargs": kwargs})

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
        FakeSMTP.sent = []
        FakeSMTP.calls = []

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

        missing_fallback = Path(self.temp_dir.name) / "missing-fallback.json"
        self.assertTrue(llm_config_available(missing_fallback))
        loaded_without_fallback = LLMApiConfig.load(missing_fallback)
        self.assertEqual(loaded_without_fallback.model, "override-model")

    def test_global_ai_analysis_uses_override_when_fallback_is_missing(self):
        self.override_path.write_text(
            json.dumps(
                {
                    "base_url": "https://override.example.com/v1",
                    "api_key": "override-key",
                    "model": "override-model",
                }
            ),
            encoding="utf-8",
        )
        missing_fallback = Path(self.temp_dir.name) / "missing-global-fallback.json"
        with (
            patch.dict(os.environ, {"LLM_CONFIG_PATH": str(missing_fallback)}),
            patch.object(ai_analysis, "OpenAICompatibleClient") as client_class,
        ):
            client_class.return_value._request_json.return_value = {"content": "共享配置生效"}
            result = ai_analysis.request_model_analysis([{"role": "user", "content": "test"}])
        self.assertEqual(result, {"content": "共享配置生效"})
        self.assertEqual(client_class.call_args.args[0].model, "override-model")

    def test_v2_html_citations_and_external_confirmation(self):
        execution = {
            "status": "succeeded",
            "search_status": "succeeded",
            "original_query": "问题",
            "request_payload": {"query_plan": {"intent": "经 DeepSeek 整理的研究方向"}},
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
        self.assertEqual(build_report_view(execution).question, "经 DeepSeek 整理的研究方向")
        self.assertIn("研究重点：</strong>经 DeepSeek 整理的研究方向", document)
        self.assertNotIn("受众：", document)
        self.assertNotIn("时间范围：", document)
        self.assertNotIn("报告篇幅：", document)
        self.assertIn("[1]", document)
        self.assertIn("建议", document)
        self.assertIn(">1:</span>", document)
        self.assertNotIn("1. 事实：", document)
        self.assertNotIn("1. 分析：", document)
        self.assertEqual(document.count("1. 来源"), 1)
        for heading in ("核心结论", "重点动态", "影响分析", "研判与建议", "风险与后续关注", "信息来源"):
            self.assertIn(heading, document)
        with self.assertRaises(ExternalRecipientConfirmationRequired):
            normalize_recipients(["outside@example.com"], external_confirmed=False)

    def test_html_note_is_escaped_and_precedes_report(self):
        execution = {
            "status": "succeeded",
            "search_status": "succeeded",
            "analysis_status": "succeeded",
            "original_query": "问题",
            "sources": [{"id": "s1", "title": "来源", "url": "https://example.test/?a=1&b=2"}],
            "report": {
                "version": 2,
                "title": "报告 <标题>",
                "core_judgment": [{"type": "fact", "text": "事实 <内容>", "source_ids": ["s1"]}],
            },
        }
        with patch("backend.api.intelligence_report_pdf.build_report_pdf", return_value=b"%PDF-mock"):
            message = build_email_message(
                execution,
                "owner@csco.com.cn",
                config=EffectiveSMTPConfig(True, "smtp.126.com", 465, "sender@126.com", "sender@126.com", "test-auth-code", True, 5, "test"),
                note="你好 <请查看>",
            )
        html_part = next(part for part in message.walk() if part.get_content_type() == "text/html")
        html_text = html_part.get_content()
        self.assertEqual(message["Subject"], EMAIL_SUBJECT)
        self.assertLess(html_text.index("你好 &lt;请查看&gt;"), html_text.index("报告 &lt;标题&gt;"))
        self.assertIn("事实 &lt;内容&gt;", html_text)
        self.assertIn("https://example.test/?a=1&amp;b=2", html_text)
        self.assertEqual(message.get_content_type(), "multipart/mixed")
        self.assertTrue(any(part.get_content_type() == "application/pdf" for part in message.walk()))

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
                external_confirmed=False,
                config=config,
            )
        self.assertEqual([item["status"] for item in results], ["sent", "sent"])
        self.assertEqual(len(FakeSMTP.sent), 2)
        self.assertTrue(all(str(message["From"]) == "sender@126.com" for message in FakeSMTP.sent))
        self.assertTrue(all(str(message["Subject"]) == EMAIL_SUBJECT for message in FakeSMTP.sent))
        self.assertTrue(all(any(part.get_content_type() == "text/html" for part in message.walk()) for message in FakeSMTP.sent))
        self.assertTrue(all(any(part.get_content_type() == "application/pdf" for part in message.walk()) for message in FakeSMTP.sent))
        self.assertIsInstance(FakeSMTP.calls[0]["kwargs"]["context"], ssl.SSLContext)
        self.assertEqual(FakeSMTP.calls[0]["kwargs"]["timeout"], 5)

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
        pdf_builder.assert_called_once_with(execution, template_style="research")
        self.assertEqual(message.get_content_type(), "multipart/mixed")
        self.assertFalse(any(part.get_content_type() == "text/html" for part in message.walk()))
        attachment = next(part for part in message.walk() if part.get_content_type() == "application/pdf")
        self.assertEqual(attachment.get_payload(decode=True), b"%PDF-mock")

    def test_newsletter_template_and_delivery_format_matrix(self):
        execution = {
            "status": "succeeded",
            "search_status": "succeeded",
            "analysis_status": "succeeded",
            "original_query": "研究重点",
            "request_payload": {"query_plan": {"intent": "经 DeepSeek 整理的日报方向"}},
            "sources": [{"id": "s1", "title": "来源", "url": "https://example.test"}],
            "report": {
                "version": 2,
                "title": "报告",
                "core_judgment": [{"type": "fact", "text": "结论", "source_ids": ["s1"]}],
                "key_developments": [{"type": "fact", "text": "动态", "source_ids": ["s1"]}],
                "impact_analysis": [{"type": "analysis", "text": "影响", "source_ids": ["s1"]}],
                "company_implications": [{"type": "recommendation", "text": "建议", "source_ids": []}],
                "risks_and_watch_items": [{"type": "analysis", "text": "风险", "source_ids": ["s1"]}],
            },
        }
        config = EffectiveSMTPConfig(True, "smtp.126.com", 465, "sender@126.com", "sender@126.com", "test-auth-code", True, 5, "test")
        _, newsletter_html = render_report_html(execution, "附言 <内容>", "newsletter")
        for heading in ("自定义情报助手", "金融科技情报日报", "Financial Tech Daily", "深圳", "独家分析", "重点动态", "研判与建议", "风险提示", "信息来源 · SOURCES", "打开原文"):
            self.assertIn(heading, newsletter_html)
        self.assertIn('href="https://example.test"', newsletter_html)
        self.assertLess(newsletter_html.index("附言 &lt;内容&gt;"), newsletter_html.index("报告"))
        self.assertIn("研究重点：经 DeepSeek 整理的日报方向", newsletter_html)
        self.assertNotIn("受众：", newsletter_html)
        self.assertNotIn("时间范围：", newsletter_html)
        self.assertNotIn("报告篇幅：", newsletter_html)
        self.assertNotIn("1. 事实：", newsletter_html)
        self.assertNotIn("1. 分析：", newsletter_html)
        self.assertEqual(newsletter_html.count("1. 来源"), 1)
        with patch("backend.api.intelligence_report_pdf.build_report_pdf", return_value=b"%PDF-mock"):
            html_only = build_email_message(execution, "owner@csco.com.cn", config=config, template_style="newsletter", delivery_format="html_only")
            pdf_only = build_email_message(execution, "owner@csco.com.cn", config=config, template_style="newsletter", delivery_format="pdf_only")
        self.assertTrue(any(part.get_content_type() == "text/html" for part in html_only.walk()))
        self.assertFalse(any(part.get_content_type() == "application/pdf" for part in html_only.walk()))
        self.assertFalse(any(part.get_content_type() == "text/html" for part in pdf_only.walk()))
        self.assertTrue(any(part.get_content_type() == "application/pdf" for part in pdf_only.walk()))


if __name__ == "__main__":
    unittest.main()
