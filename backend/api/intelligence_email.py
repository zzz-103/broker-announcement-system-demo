"""Owner-triggered custom-intelligence report delivery over 126.com SMTP.

The email is rendered from the already persisted Report V2 execution.  It
always contains a plain-text part, a complete HTML report and the matching PDF
attachment; no LLM/provider/request details are sent to recipients.
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
from .intelligence_report_view import (
    ReportItemView,
    ReportSectionView,
    TemplateStyle,
    build_report_view,
    format_report_datetime,
    normalize_template_style,
)


MAX_RECIPIENTS = 5
MAX_NOTE_LENGTH = 500
ALLOWED_DOMAIN = "csco.com.cn"
EMAIL_SUBJECT = "自定义情报订阅系统"
EMAIL_PATTERN = re.compile(r"^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$")
ReportFormat = Literal["html", "pdf"]
DeliveryFormat = Literal["html_pdf", "html_only", "pdf_only"]


class EmailConfigurationError(Exception):
    pass


class EmailRecipientError(Exception):
    pass


class ExternalRecipientConfirmationRequired(EmailRecipientError):
    pass


def _smtp_ssl_context() -> ssl.SSLContext:
    """Build a verified TLS context from the deployed CA bundle."""

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


def _clean(value: object, limit: int = 4_000) -> str:
    return str(value or "").strip()[:limit]


def _normalize_note(note: object) -> str:
    if note is None:
        return ""
    value = str(note).strip()
    if len(value) > MAX_NOTE_LENGTH:
        raise EmailRecipientError(f"附言不能超过 {MAX_NOTE_LENGTH} 字")
    return value


def _coerce_format_and_note(report_format: object, note: object) -> tuple[ReportFormat | None, str]:
    """Keep old positional ``report_format`` calls source compatible.

    A caller may pass a note as the third positional argument while migrating
    from the old HTML/PDF selector.  Recognised legacy values are ignored as
    format selectors; all other values are treated as that note.
    """

    if report_format in (None, "html", "pdf"):
        return report_format, _normalize_note(note)
    if note is not None:
        raise ValueError("report format is invalid")
    return None, _normalize_note(report_format)


def normalize_delivery_format(value: object = "html_pdf", *, legacy_format: object = None) -> DeliveryFormat:
    """Resolve the new delivery selector and the legacy HTML/PDF field."""

    selected = str(value or "html_pdf").strip().casefold()
    if selected == "html_pdf" and legacy_format in {"html", "pdf"}:
        selected = "html_only" if legacy_format == "html" else "pdf_only"
    if selected not in {"html_pdf", "html_only", "pdf_only"}:
        raise ValueError("delivery format is invalid")
    return selected  # type: ignore[return-value]


def _inline_text(value: object, limit: int = 4_000) -> str:
    return html.escape(_clean(value, limit), quote=True).replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>")


def _citation_html(item: ReportItemView) -> str:
    if not item.citation_numbers:
        return ""
    marks = " ".join(f"[{number}]" for number in item.citation_numbers)
    return f'<span style="color:#6b7280;font-size:12px;white-space:nowrap;"> {marks}</span>'


def _item_html(item: ReportItemView, *, numbered: bool = True) -> str:
    prefix = f"{item.number}. " if numbered else ""
    return (
        '<p style="margin:0 0 12px 0;font-size:14px;line-height:1.75;color:#25324a;">'
        f'<span style="color:#315ea8;font-weight:700;">{html.escape(prefix + item.type_label)}：</span>'
        f'{_inline_text(item.text)}{_citation_html(item)}</p>'
    )


def _section_html(section: ReportSectionView) -> str:
    core = section.key == "core_judgment"
    heading_style = (
        "margin:0;padding:0 0 8px 0;font-size:17px;line-height:1.4;color:#1f3b68;"
        "font-weight:700;border-bottom:1px solid #d8e1ef;"
    )
    body_style = "padding:15px 0 4px 0;"
    if core:
        body_style = "padding:15px 16px 4px 16px;background:#f4f7fc;border-left:3px solid #315ea8;"
    items = "".join(_item_html(item) for item in section.items)
    if not items:
        items = '<p style="margin:0;color:#7b8798;font-size:14px;line-height:1.7;">暂无内容。</p>'
    return (
        '<tr><td style="padding:20px 0 0 0;">'
        f'<h2 style="{heading_style}">{html.escape(section.title)}</h2>'
        f'<div style="{body_style}">{items}</div>'
        "</td></tr>"
    )


def _source_html(source_number: int, title: str, site_name: str, date: str, url: str) -> str:
    details = " · ".join(part for part in (site_name, date) if part)
    detail_html = f'<span style="color:#6b7280;font-size:12px;">{html.escape(details)}</span>' if details else ""
    link_html = ""
    if re.match(r"^https?://[^\s]+$", url, flags=re.IGNORECASE):
        safe_url = html.escape(url, quote=True)
        link_html = (
            f'<br><a href="{safe_url}" target="_blank" rel="noopener noreferrer" '
            'style="display:inline-block;margin-top:3px;color:#315ea8;font-size:12px;line-height:1.5;'
            'font-weight:700;text-decoration:underline;">打开原文</a>'
        )
    return (
        '<li style="margin:0 0 9px 0;padding:0;color:#25324a;font-size:13px;line-height:1.55;">'
        f"<span style=\"font-weight:700;\">{source_number}. {html.escape(title)}</span> "
        f"{detail_html}{link_html}</li>"
    )


def _render_research_html(execution: dict[str, object], note: str | None = None) -> tuple[str, str]:
    """Render the formal research-brief email template."""

    try:
        view = build_report_view(execution)
    except ValueError as exc:
        # Preserve the renderer's historical public error type while the
        # shared view model remains a generic ValueError-based helper.
        raise EmailConfigurationError("旧版报告不支持邮件发送，请先再次生成 Report V2") from exc
    normalized_note = _normalize_note(note)
    # Single-quote family names so the CSS remains valid inside the enclosing
    # double-quoted HTML ``style`` attribute across strict mail clients.
    font_stack = "'Microsoft YaHei','微软雅黑','PingFang SC','Noto Sans CJK SC',Arial,sans-serif"
    note_html = ""
    if normalized_note:
        note_html = (
            '<tr><td style="padding:0 0 18px 0;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            'style="border-collapse:collapse;"><tr><td style="padding:12px 14px;background:#f4f7fc;'
            'border-left:3px solid #315ea8;color:#25324a;font-size:14px;line-height:1.7;">'
            f'<strong style="color:#1f3b68;">附言</strong><br>{_inline_text(normalized_note, MAX_NOTE_LENGTH)}'
            "</td></tr></table></td></tr>"
        )
    meta_cells = "".join(
        '<td style="padding:0 14px 0 0;vertical-align:top;font-size:12px;line-height:1.55;'
        'color:#6b7280;">'
        f'<span style="color:#8792a2;">{html.escape(label)}</span><br>'
        f'<strong style="color:#25324a;font-size:13px;">{html.escape(value)}</strong></td>'
        for label, value in view.meta
    )
    question_html = ""
    if view.question:
        question_html = (
            '<tr><td style="padding:13px 0 0 0;font-size:13px;line-height:1.7;color:#526176;">'
            f'<strong style="color:#25324a;">研究重点：</strong>{_inline_text(view.question, 1_000)}'
            "</td></tr>"
        )
    sources_html = "".join(
        _source_html(source.number, source.title, source.site_name, source.date, source.url)
        for source in view.sources
    )
    warning_html = "".join(
        f'<p style="margin:0 0 8px 0;color:#7b5d19;font-size:12px;line-height:1.6;">来源提示：{_inline_text(warning, 1_000)}</p>'
        for warning in view.reference_warnings
    )
    if not sources_html:
        sources_html = '<li style="color:#7b8798;font-size:13px;">暂无来源。</li>'
    sections_html = "".join(_section_html(section) for section in view.sections)
    document = (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no">'
        f"</head><body style=\"margin:0;padding:0;background:#ffffff;font-family:{font_stack};color:#25324a;\">"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="border-collapse:collapse;background:#ffffff;"><tr><td align="center" style="padding:20px 10px;">'
        '<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" '
        'style="width:100%;max-width:640px;border-collapse:collapse;">'
        f"{note_html}"
        '<tr><td style="padding:0 0 7px 0;border-bottom:2px solid #315ea8;">'
        '<div style="font-size:12px;line-height:1.4;letter-spacing:.08em;color:#315ea8;font-weight:700;">自定义情报订阅系统</div>'
        f'<h1 style="margin:9px 0 0 0;font-size:25px;line-height:1.4;color:#172033;font-weight:700;">{html.escape(view.title)}</h1>'
        "</td></tr>"
        f'<tr><td style="padding:13px 0 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>{meta_cells}</tr></table></td></tr>'
        f"{question_html}{sections_html}"
        '<tr><td style="padding:24px 0 0 0;border-top:1px solid #d8e1ef;">'
        '<h2 style="margin:0 0 12px 0;padding:0;font-size:17px;line-height:1.4;color:#1f3b68;font-weight:700;">信息来源</h2>'
        f"{warning_html}<ol style=\"margin:0;padding-left:23px;\">{sources_html}</ol>"
        '</td></tr><tr><td style="padding:26px 0 0 0;color:#8792a2;font-size:11px;line-height:1.5;">'
        "本邮件由自定义情报订阅系统生成，报告正文同时附带 PDF 文件。"
        "</td></tr></table></td></tr></table></body></html>"
    )
    return EMAIL_SUBJECT, document


_NEWSLETTER_RED = "#B42318"
_NEWSLETTER_INK = "#161616"
_NEWSLETTER_MUTED = "#667085"


def _newsletter_item_html(item: ReportItemView, *, compact: bool = False) -> str:
    citation = _citation_html(item)
    margin = "0 0 9px 0" if compact else "0 0 12px 0"
    return (
        f'<p style="margin:{margin};font-size:13px;line-height:1.65;color:{_NEWSLETTER_INK};">'
        f'<strong style="color:{_NEWSLETTER_RED};">{item.number}. {html.escape(item.type_label)}：</strong>'
        f'{_inline_text(item.text)}{citation}</p>'
    )


def _newsletter_items(items: tuple[ReportItemView, ...], *, compact: bool = False) -> str:
    if not items:
        return '<p style="margin:0;color:#98A2B3;font-size:13px;">暂无内容。</p>'
    return "".join(_newsletter_item_html(item, compact=compact) for item in items)


def _newsletter_label(text: str) -> str:
    return (
        f'<div style="display:inline-block;padding:3px 7px;background:{_NEWSLETTER_RED};color:#ffffff;'
        f'font-size:11px;line-height:1.3;font-weight:700;letter-spacing:.08em;">{html.escape(text)}</div>'
    )


def _render_newsletter_html(execution: dict[str, object], note: str | None = None) -> tuple[str, str]:
    """Render the compact newsletter template from ReportView."""

    try:
        view = build_report_view(execution)
    except ValueError as exc:
        raise EmailConfigurationError("旧版报告不支持邮件发送，请先再次生成 Report V2") from exc
    normalized_note = _normalize_note(note)
    section_by_key = {section.key: section for section in view.sections}
    note_html = ""
    if normalized_note:
        note_html = (
            '<tr><td style="padding:0 0 18px 0;">'
            f'<div style="padding:10px 13px;border-left:3px solid {_NEWSLETTER_RED};background:#FAFAF9;'
            f'color:{_NEWSLETTER_INK};font-size:13px;line-height:1.65;"><strong>附言</strong><br>'
            f'{_inline_text(normalized_note, MAX_NOTE_LENGTH)}</div></td></tr>'
        )
    date_text = format_report_datetime(view.executed_at)
    metadata = " · ".join(
        f"{html.escape(label)}：{html.escape(value)}" for label, value in view.meta if label != "生成时间"
    )
    core = section_by_key.get("core_judgment")
    developments = section_by_key.get("key_developments")
    impact = section_by_key.get("impact_analysis")
    recommendations = section_by_key.get("company_implications")
    risks = section_by_key.get("risks_and_watch_items")
    core_body = _newsletter_items(core.items if core else ())
    development_body = _newsletter_items(developments.items if developments else (), compact=True)
    impact_body = _newsletter_items(impact.items if impact else (), compact=True)
    recommendation_body = _newsletter_items(recommendations.items if recommendations else ())
    risk_body = _newsletter_items(risks.items if risks else (), compact=True)
    source_body = "".join(
        _source_html(source.number, source.title, source.site_name, source.date, source.url)
        for source in view.sources
    ) or '<li style="color:#98A2B3;font-size:12px;">暂无来源。</li>'
    warnings = "".join(
        f'<p style="margin:0 0 5px 0;color:#7B5D19;font-size:11px;line-height:1.5;">来源提示：{_inline_text(warning, 1_000)}</p>'
        for warning in view.reference_warnings
    )
    section_heading = (
        f'font-size:15px;line-height:1.4;color:{_NEWSLETTER_INK};font-weight:700;'
        f'border-top:2px solid {_NEWSLETTER_RED};padding-top:7px;margin:0 0 11px 0;'
    )
    columns = (
        '<tr><td style="padding:0 10px 0 0;width:50%;vertical-align:top;">'
        f'{_newsletter_label("重点动态")}<div style="padding-top:9px;">{development_body}</div></td>'
        '<td style="padding:0 0 0 10px;width:50%;vertical-align:top;">'
        f'{_newsletter_label("影响分析")}<div style="padding-top:9px;">{impact_body}</div></td></tr>'
    )
    document = (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no">'
        f'</head><body style="margin:0;padding:0;background:#ffffff;font-family:\'Microsoft YaHei\',\'微软雅黑\',\'PingFang SC\',Arial,sans-serif;color:{_NEWSLETTER_INK};">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background:#ffffff;">'
        '<tr><td align="center" style="padding:18px 10px;">'
        '<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;border-collapse:collapse;">'
        f'{note_html}'
        '<tr><td align="center" style="padding:7px 0 12px 0;border-bottom:3px solid #111111;">'
        '<div style="font-family:Georgia,serif;font-size:30px;line-height:1.2;letter-spacing:.16em;color:#111111;font-weight:700;">自定义情报助手</div>'
        '<div style="margin-top:5px;font-family:Georgia,serif;font-size:11px;line-height:1.4;letter-spacing:.1em;color:#667085;">金融科技情报日报 · Financial Tech Daily</div>'
        f'<div style="margin-top:8px;font-size:11px;line-height:1.4;color:#667085;">{html.escape(date_text)} · 深圳</div>'
        '</td></tr>'
        '<tr><td style="padding:18px 0 7px 0;">'
        f'<div style="font-size:12px;line-height:1.4;color:{_NEWSLETTER_RED};font-weight:700;letter-spacing:.1em;">{html.escape(metadata)}</div>'
        f'<h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.45;color:{_NEWSLETTER_INK};font-weight:700;">{html.escape(view.title)}</h1>'
        f'<p style="margin:8px 0 0 0;font-size:12px;line-height:1.6;color:{_NEWSLETTER_MUTED};">研究重点：{_inline_text(view.question or "未指定", 1_000)}</p>'
        '</td></tr>'
        '<tr><td style="padding:16px 0 0 0;">'
        f'{_newsletter_label("独家分析")}<div style="margin-top:10px;padding:13px 15px;border-left:4px solid {_NEWSLETTER_RED};background:#FAFAF9;">{core_body}</div>'
        '</td></tr>'
        f'<tr><td style="padding:22px 0 0 0;"><h2 style="{section_heading}">市场观察</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">{columns}</table></td></tr>'
        '<tr><td style="padding:22px 0 0 0;">'
        f'{_newsletter_label("研判与建议")}<div style="margin-top:10px;padding:11px 15px;border-left:4px solid {_NEWSLETTER_RED};">{recommendation_body}</div>'
        '</td></tr>'
        '<tr><td style="padding:21px 0 0 0;">'
        f'<h2 style="{section_heading}">风险提示</h2><div style="padding:11px 13px;border:1px solid #D7DADD;background:#FCFCFB;">{risk_body}</div>'
        '</td></tr>'
        '<tr><td style="padding:24px 0 0 0;border-top:3px solid #111111;">'
        f'<h2 style="margin:0 0 11px 0;font-size:14px;line-height:1.4;color:#111111;">信息来源 · SOURCES</h2>{warnings}<ol style="margin:0;padding-left:21px;">{source_body}</ol>'
        '</td></tr>'
        '<tr><td align="center" style="padding:20px 0 0 0;color:#98A2B3;font-size:10px;line-height:1.5;">自定义情报助手 · 自定义情报订阅系统</td></tr>'
        '</table></td></tr></table></body></html>'
    )
    return EMAIL_SUBJECT, document


def render_report_html(
    execution: dict[str, object],
    note: str | None = None,
    template_style: TemplateStyle | str = "research",
) -> tuple[str, str]:
    """Return ``(fixed_subject, html_document)`` for the chosen template."""

    if normalize_template_style(template_style) == "newsletter":
        return _render_newsletter_html(execution, note)
    return _render_research_html(execution, note)


def render_report_text(execution: dict[str, object], note: str | None = None) -> str:
    """Return a readable plain-text alternative for clients without HTML."""

    view = build_report_view(execution)
    normalized_note = _normalize_note(note)
    lines: list[str] = []
    if normalized_note:
        lines.extend(("附言", normalized_note, ""))
    lines.extend((EMAIL_SUBJECT, view.title, ""))
    if view.question:
        lines.extend((f"研究重点：{view.question}", ""))
    lines.extend(f"{label}：{value}" for label, value in view.meta)
    lines.append("")
    for section in view.sections:
        lines.extend((section.title, "-" * max(8, len(section.title))))
        if not section.items:
            lines.append("暂无内容。")
        for item in section.items:
            citations = " " + " ".join(f"[{number}]" for number in item.citation_numbers) if item.citation_numbers else ""
            lines.append(f"{item.number}. {item.type_label}：{item.text}{citations}")
        lines.append("")
    lines.append("信息来源")
    for source in view.sources:
        details = " · ".join(part for part in (source.site_name, source.date) if part)
        lines.append(f"{source.number}. {source.title}{(' - ' + details) if details else ''}")
        if source.url:
            lines.append(source.url)
    return "\n".join(lines).strip() + "\n"


def build_email_message(
    execution: dict[str, object],
    recipient: str,
    report_format: ReportFormat | str | None = None,
    config: EffectiveSMTPConfig | None = None,
    *,
    note: str | None = None,
    template_style: TemplateStyle | str = "research",
    delivery_format: DeliveryFormat | str = "html_pdf",
) -> EmailMessage:
    """Build a message in the selected format with one shared ReportView.

    ``report_format`` is retained solely for source compatibility with the
    old route. New callers should use ``delivery_format``.
    """

    # During route migration callers may move ``config`` into the third
    # positional slot after dropping the old format selector.  Accept that
    # shape as well as the historical ``(format, config)`` ordering.
    if isinstance(report_format, EffectiveSMTPConfig):
        if config is not None:
            raise ValueError("SMTP 配置重复传入")
        config = report_format
        report_format = None
    if report_format in {"html_pdf", "html_only", "pdf_only"} and delivery_format == "html_pdf":
        delivery_format = report_format
        report_format = None
    legacy_format = report_format if report_format in {"html", "pdf"} else None
    resolved_delivery = normalize_delivery_format(delivery_format, legacy_format=legacy_format)
    _, normalized_note = _coerce_format_and_note(report_format, note)
    if config is None:
        raise EmailConfigurationError("SMTP 配置缺失")
    resolved_style = normalize_template_style(template_style)
    plain = render_report_text(execution, normalized_note)
    message = EmailMessage()
    message["Message-ID"] = make_msgid()
    message["Subject"] = EMAIL_SUBJECT
    message["From"] = config.from_address or config.username
    message["To"] = recipient
    message.set_content(plain)
    from . import intelligence_report_pdf

    if resolved_delivery in {"html_pdf", "html_only"}:
        _, document = render_report_html(execution, normalized_note, resolved_style)
        message.add_alternative(document, subtype="html")
    if resolved_delivery in {"html_pdf", "pdf_only"}:
        pdf_bytes = intelligence_report_pdf.build_report_pdf(execution, template_style=resolved_style)
        message.add_attachment(
            pdf_bytes,
            maintype="application",
            subtype="pdf",
            filename=intelligence_report_pdf.report_pdf_filename(execution),
        )
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
    report_format: ReportFormat | str | None = None,
    *,
    note: str | None = None,
    template_style: TemplateStyle | str = "research",
    delivery_format: DeliveryFormat | str = "html_pdf",
    external_confirmed: bool,
    config: EffectiveSMTPConfig,
) -> list[dict[str, object]]:
    """Send one complete report message per normalised recipient."""

    if execution.get("status") != "succeeded" or execution.get("analysis_status") != "succeeded":
        raise EmailConfigurationError("报告尚未成功生成，暂不能发送")
    report = execution.get("report") if isinstance(execution.get("report"), dict) else {}
    if report.get("version") != 2:
        raise EmailConfigurationError("旧版报告不支持邮件发送，请先再次生成 Report V2")
    if execution.get("search_status") != "succeeded" or not execution.get("sources"):
        raise EmailConfigurationError("该记录没有可发送的搜索结果")
    if report_format in {"html_pdf", "html_only", "pdf_only"} and delivery_format == "html_pdf":
        delivery_format = report_format
        report_format = None
    legacy_format = report_format if report_format in {"html", "pdf"} else None
    resolved_delivery = normalize_delivery_format(delivery_format, legacy_format=legacy_format)
    resolved_style = normalize_template_style(template_style)
    resolved_report_format, normalized_note = _coerce_format_and_note(report_format, note)
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
                    message = build_email_message(
                        execution,
                        recipient,
                        resolved_report_format,
                        config,
                        note=normalized_note,
                        template_style=resolved_style,
                        delivery_format=resolved_delivery,
                    )
                    message_id = str(message["Message-ID"] or "")
                    smtp.send_message(message)
                    results.append(
                        {
                            "recipient": recipient,
                            "status": "sent",
                            "message_id": message_id,
                            "delivery_format": resolved_delivery,
                            "template_style": resolved_style,
                        }
                    )
                except Exception:
                    # Keep externally visible errors generic; diagnostics and
                    # delivery logs must never contain SMTP credentials/raw data.
                    results.append(
                        {
                            "recipient": recipient,
                            "status": "failed",
                            "message_id": "",
                            "error_message": "邮件发送失败",
                            "delivery_format": resolved_delivery,
                            "template_style": resolved_style,
                        }
                    )
    except EmailConfigurationError:
        raise
    except Exception:
        # A connection/login failure is still a delivery attempt. Return one
        # safe failed result per recipient so the route can persist an audit
        # trail without exposing the SMTP exception or credential.
        return [
            {
                "recipient": recipient,
                "status": "failed",
                "message_id": "",
                "error_message": "邮件发送失败",
                "delivery_format": resolved_delivery,
                "template_style": resolved_style,
            }
            for recipient in normalized
        ]
    return results
