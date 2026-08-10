"""Owner-triggered custom-intelligence report delivery over 126.com SMTP.

This module deliberately renders from the already persisted Report V2
execution object.  It never invokes an LLM and never includes request payloads,
prompts, API keys, or provider responses in an email or delivery log.
"""

from __future__ import annotations

import html
import re
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import make_msgid
from typing import Iterable, Literal

import certifi

from .config import settings
from .custom_intelligence_store import IntelligenceStore


MAX_RECIPIENTS = 5
ALLOWED_DOMAIN = "csco.com.cn"
EMAIL_PATTERN = re.compile(r"^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$")
ReportFormat = Literal["html", "pdf"]
AUDIENCE_LABELS = {
    "management": "管理层",
    "business_product": "业务 / 产品",
    "technology": "技术",
    "compliance_risk": "合规风控",
    "industry_research": "行业研究",
    "custom": "自定义",
}
TIME_RANGE_LABELS = {"week": "最近 7 天", "month": "最近 30 天", "semiyear": "最近 180 天", "year": "最近 365 天"}
REPORT_LENGTH_LABELS = {"concise": "简报", "standard": "标准", "deep": "深度"}


class EmailConfigurationError(Exception):
    pass


class EmailRecipientError(Exception):
    pass


class ExternalRecipientConfirmationRequired(EmailRecipientError):
    pass


def _smtp_ssl_context() -> ssl.SSLContext:
    """Build a verified TLS context from the deployed CA bundle.

    Explicitly using certifi keeps Windows/macOS virtual environments from
    depending on an incomplete host trust store. Certificate verification is
    never disabled.
    """
    return ssl.create_default_context(cafile=certifi.where())


@dataclass(frozen=True, slots=True)
class EffectiveSMTPConfig:
    enabled: bool
    host: str
    port: int
    username: str
    from_address: str
    authorization_code: str
    use_ssl: bool
    timeout_seconds: float
    config_source: str


def validate_smtp_identity(username: str, from_address: str) -> None:
    """Enforce the 126.com authorization-code identity invariant."""
    if not username or not username.casefold().endswith("@126.com"):
        raise EmailConfigurationError("SMTP 用户名必须是 @126.com 邮箱")
    if from_address.casefold() != username.casefold():
        raise EmailConfigurationError("发件地址必须与 SMTP 用户名一致")


def mask_secret(value: str) -> str:
    if not value:
        return ""
    return f"{value[:2]}{'•' * 14}" if len(value) > 2 else "••••••••••••••••"


def effective_smtp_config(store: IntelligenceStore) -> EffectiveSMTPConfig:
    row = store.get_smtp_config()
    if row:
        username = str(row.get("username") or "").strip() or settings.smtp_username
        from_address = str(row.get("from_address") or "").strip() or settings.smtp_from_address or username
        authorization_code = str(row.get("authorization_code") or "").strip() or settings.smtp_authorization_code
        return EffectiveSMTPConfig(
            enabled=bool(row.get("enabled")),
            host="smtp.126.com",
            port=465,
            username=username,
            from_address=from_address,
            authorization_code=authorization_code,
            use_ssl=True,
            timeout_seconds=float(row.get("timeout_seconds") or settings.smtp_timeout_seconds),
            config_source="database",
        )
    username = settings.smtp_username
    return EffectiveSMTPConfig(
        enabled=settings.smtp_enabled,
        host="smtp.126.com",
        port=465,
        username=username,
        from_address=settings.smtp_from_address or username,
        authorization_code=settings.smtp_authorization_code,
        use_ssl=True,
        timeout_seconds=settings.smtp_timeout_seconds,
        config_source="environment",
    )


def public_smtp_config(store: IntelligenceStore) -> dict[str, object]:
    config = effective_smtp_config(store)
    return {
        "enabled": config.enabled,
        "host": config.host,
        "port": config.port,
        "use_ssl": config.use_ssl,
        "username": config.username,
        "from_address": config.from_address,
        "authorization_code_mask": mask_secret(config.authorization_code),
        "has_authorization_code": bool(config.authorization_code),
        "timeout_seconds": config.timeout_seconds,
        "config_source": config.config_source,
    }


def normalize_recipients(recipients: Iterable[str], *, external_confirmed: bool) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in recipients:
        recipient = str(raw or "").strip()
        if not recipient:
            continue
        if not EMAIL_PATTERN.fullmatch(recipient):
            raise EmailRecipientError("收件人邮箱格式不正确")
        canonical = recipient.casefold()
        if canonical in seen:
            continue
        seen.add(canonical)
        normalized.append(recipient)
    if not normalized:
        raise EmailRecipientError("至少需要一个收件人")
    if len(normalized) > MAX_RECIPIENTS:
        raise EmailRecipientError(f"单次最多发送 {MAX_RECIPIENTS} 个收件人")
    external = [item for item in normalized if not item.casefold().endswith(f"@{ALLOWED_DOMAIN}")]
    if external and not external_confirmed:
        raise ExternalRecipientConfirmationRequired("发送到公司域名之外的邮箱需要明确确认")
    return normalized


def _text(value: object, limit: int = 4000) -> str:
    return str(value or "").strip()[:limit]


def _items(report: dict[str, object], key: str, limit: int = 12) -> list[str]:
    value = report.get(key)
    if not isinstance(value, list):
        return []
    return [_text(item, 600) for item in value[:limit] if _text(item, 600)]


def render_report_html(execution: dict[str, object]) -> tuple[str, str]:
    """Return ``(subject, html)`` from one persisted Report V2 object."""
    report = execution.get("report") if isinstance(execution.get("report"), dict) else {}
    if report.get("version") != 2:
        raise EmailConfigurationError("旧版报告不支持邮件发送，请先再次生成 Report V2")
    snapshot = execution.get("snapshot") if isinstance(execution.get("snapshot"), dict) else {}
    sources = execution.get("sources") if isinstance(execution.get("sources"), list) else []
    source_indexes = {str(item.get("id")): index for index, item in enumerate(sources, 1) if isinstance(item, dict) and item.get("id") is not None}
    title = _text(report.get("title"), 500) or _text(execution.get("original_query"), 500) or "即时情报报告"
    sections: list[str] = []

    def report_items(value: object) -> list[dict[str, object]]:
        if not isinstance(value, list):
            return []
        return [item for item in value[:30] if isinstance(item, dict) and _text(item.get("text"), 4000)]

    def item_html(item: dict[str, object]) -> str:
        kind = str(item.get("type") or "analysis").casefold()
        kind_label = {"fact": "事实", "analysis": "分析", "recommendation": "分析建议"}.get(kind, "分析")
        text = html.escape(_text(item.get("text"), 4000)).replace(chr(10), "<br>")
        source_ids = item.get("source_ids")
        marks = [str(source_indexes[str(source_id)]) for source_id in source_ids if str(source_id) in source_indexes] if isinstance(source_ids, list) else []
        citation = f" <span class=\"citation\">[{', '.join(marks)}]</span>" if marks else ""
        return f"<li><strong>{kind_label}：</strong>{text}{citation}</li>"

    judgment_items = report_items(report.get("core_judgment"))
    if judgment_items:
        sections.append("<h2>核心判断</h2><ul>" + "".join(item_html(item) for item in judgment_items) + "</ul>")
    else:
        sections.append("<h2>核心判断</h2><p>暂无内容。</p>")

    development_items = report_items(report.get("key_developments"))
    if development_items:
        sections.append("<h2>关键动态与案例</h2><ul>" + "".join(item_html(item) for item in development_items) + "</ul>")
    else:
        sections.append("<h2>关键动态与案例</h2><p>暂无内容。</p>")

    for heading, key in (("影响分析", "impact_analysis"), ("对公司的启示", "company_implications"), ("风险与关注事项", "risks_and_watch_items")):
        values = report_items(report.get(key))
        if values:
            sections.append(f"<h2>{heading}</h2><ul>" + "".join(item_html(item) for item in values) + "</ul>")
        else:
            sections.append(f"<h2>{heading}</h2><p>暂无内容。</p>")

    warning_items = _items(report, "reference_warnings")
    if warning_items:
        sections.append("<h2>来源提示</h2><ul>" + "".join(f"<li>{html.escape(item)}</li>" for item in warning_items) + "</ul>")
    source_items: list[str] = []
    for index, source in enumerate(sources[:50], 1):
        if not isinstance(source, dict):
            continue
        source_title = _text(source.get("title"), 240) or "未命名来源"
        url = _text(source.get("url"), 1000)
        label = html.escape(source_title)
        if re.match(r"^https?://[^\s]+$", url, flags=re.IGNORECASE):
            label = f'<a href="{html.escape(url, quote=True)}">{label}</a>'
        source_items.append(f"<li value=\"{index}\">{label}</li>")
    if source_items:
        sections.append("<h2>信息来源</h2><ol>" + "".join(source_items) + "</ol>")
    question = _text(execution.get("original_query") or snapshot.get("focus"), 500)
    audience = _text(report.get("audience") or snapshot.get("audience"), 120)
    time_range = _text(report.get("time_range") or snapshot.get("time_range"), 32)
    report_length = _text(report.get("report_length") or snapshot.get("report_length"), 32)
    meta = (
        f"<p class=\"meta\">业务问题：{html.escape(question) if question else '—'} ｜ "
        f"受众：{html.escape(AUDIENCE_LABELS.get(audience, audience) or '—')} ｜ "
        f"时间范围：{html.escape(TIME_RANGE_LABELS.get(time_range, time_range) or '—')} ｜ "
        f"报告篇幅：{html.escape(REPORT_LENGTH_LABELS.get(report_length, report_length) or '—')} ｜ "
        f"有效来源：{len(source_items)} 条</p>"
    )
    document = (
        "<!doctype html><html><head><meta charset=\"utf-8\"><style>"
        "body{font-family:-apple-system,BlinkMacSystemFont,'Microsoft YaHei',sans-serif;color:#172033;line-height:1.65;max-width:860px;margin:0 auto;padding:28px}"
        "h1{font-size:24px}h2{font-size:17px;border-bottom:1px solid #e4eaf2;padding-bottom:5px;margin-top:24px}h3{font-size:15px}p,li{font-size:14px}.meta,.citation{color:#667085;font-size:12px}a{color:#315ea8}"
        "</style></head><body>"
        f"<h1>{html.escape(title)}</h1>{meta}{''.join(sections)}</body></html>"
    )
    return title, document


def build_email_message(
    execution: dict[str, object],
    recipient: str,
    report_format: ReportFormat,
    config: EffectiveSMTPConfig,
) -> EmailMessage:
    subject, document = render_report_html(execution)
    message = EmailMessage()
    message["Message-ID"] = make_msgid()
    message["Subject"] = subject[:180]
    message["From"] = config.from_address or config.username
    message["To"] = recipient
    message.set_content(f"{subject}\n\n此邮件由券商招采智能分析系统生成。请使用支持 HTML 的客户端查看完整报告。")
    if report_format == "html":
        message.add_alternative(document, subtype="html")
    elif report_format == "pdf":
        # Keep reportlab optional for HTML-only deployments and tests.
        from .intelligence_report_pdf import build_report_pdf, report_pdf_filename

        pdf_bytes = build_report_pdf(execution)
        message.add_attachment(
            pdf_bytes,
            maintype="application",
            subtype="pdf",
            filename=report_pdf_filename(execution),
        )
    else:
        raise ValueError("report format is invalid")
    return message


def test_smtp_configuration(config: EffectiveSMTPConfig) -> dict[str, object]:
    if not config.enabled:
        raise EmailConfigurationError("邮件发送服务已停用")
    if not config.username or not config.from_address or not config.authorization_code:
        raise EmailConfigurationError("SMTP 未配置用户名、发件地址或授权码")
    validate_smtp_identity(config.username, config.from_address)
    try:
        with smtplib.SMTP_SSL(
            config.host,
            config.port,
            timeout=config.timeout_seconds,
            context=_smtp_ssl_context(),
        ) as smtp:
            smtp.ehlo()
            smtp.login(config.username, config.authorization_code)
    except Exception as exc:
        raise EmailConfigurationError("SMTP 连接测试失败") from exc
    return {"status": "success", "message": "SMTP 连接测试成功"}


def send_report_email(
    execution: dict[str, object],
    recipients: Iterable[str],
    report_format: ReportFormat,
    *,
    external_confirmed: bool,
    config: EffectiveSMTPConfig,
) -> list[dict[str, object]]:
    if execution.get("status") != "succeeded" or execution.get("analysis_status") != "succeeded":
        raise EmailConfigurationError("报告尚未成功生成，暂不能发送")
    report = execution.get("report") if isinstance(execution.get("report"), dict) else {}
    if report.get("version") != 2:
        raise EmailConfigurationError("旧版报告不支持邮件发送，请先再次生成 Report V2")
    if execution.get("search_status") != "succeeded" or not execution.get("sources"):
        raise EmailConfigurationError("该记录没有可发送的搜索结果")
    normalized = normalize_recipients(recipients, external_confirmed=external_confirmed)
    if not config.enabled:
        raise EmailConfigurationError("邮件发送服务已停用")
    if not config.username or not config.from_address or not config.authorization_code:
        raise EmailConfigurationError("SMTP 未配置用户名、发件地址或授权码")
    validate_smtp_identity(config.username, config.from_address)
    results: list[dict[str, object]] = []
    try:
        with smtplib.SMTP_SSL(
            config.host,
            config.port,
            timeout=config.timeout_seconds,
            context=_smtp_ssl_context(),
        ) as smtp:
            smtp.ehlo()
            smtp.login(config.username, config.authorization_code)
            for recipient in normalized:
                try:
                    message = build_email_message(execution, recipient, report_format, config)
                    message_id = str(message["Message-ID"] or "")
                    smtp.send_message(message)
                    results.append({"recipient": recipient, "status": "sent", "message_id": message_id})
                except Exception:
                    # Keep the externally visible error generic; diagnostics and
                    # delivery logs must never contain SMTP credentials/raw data.
                    results.append({"recipient": recipient, "status": "failed", "message_id": "", "error_message": "邮件发送失败"})
    except EmailConfigurationError:
        raise
    except Exception:
        # A connection/login failure is still a delivery attempt. Return one
        # safe failed result per recipient so the route can persist an audit
        # trail without exposing the SMTP exception or credential.
        return [
            {"recipient": recipient, "status": "failed", "message_id": "", "error_message": "邮件发送失败"}
            for recipient in normalized
        ]
    return results
