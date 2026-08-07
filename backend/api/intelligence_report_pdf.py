"""Render a custom-intelligence execution report as a downloadable PDF.

The layout mirrors the on-screen report viewer (title, meta, core conclusion,
key dynamics, focus sections, impact analysis, opportunities/risks/watch
items, follow-ups and reference sources). Only user-visible report fields are
included: no request payloads, request IDs or other internal fields.
"""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

try:
    from zoneinfo import ZoneInfo

    _TZ = ZoneInfo("Asia/Shanghai")
except Exception:  # pragma: no cover - very old platforms
    _TZ = timezone.utc

# Embedded CJK fonts guarantee rendering everywhere; CID font is the fallback
# when no local TrueType CJK font is available (e.g. minimal Linux servers).
_SONGTI_PATH = "/System/Library/Fonts/Supplemental/Songti.ttc"
_FONT = "STSong-Light"
_FONT_BOLD = "STSong-Light"
_FONT_REGISTERED = False

INK = colors.HexColor("#172033")
BODY = colors.HexColor("#344054")
GRAY = colors.HexColor("#667085")
FAINT = colors.HexColor("#98A2B3")
BLUE = colors.HexColor("#315EA8")
CARD_BG = colors.HexColor("#F8FAFC")
CARD_BORDER = colors.HexColor("#E4EAF2")

TIME_RANGE_LABELS = {
    "week": "最近 7 天",
    "month": "最近 30 天",
    "semiyear": "最近 180 天",
    "year": "最近 365 天",
}
REPORT_TYPE_LABELS = {
    "management_brief": "管理层简报",
    "competitive_analysis": "竞争分析",
    "industry_trends": "行业动态",
    "risk_monitoring": "风险监控",
}


def _ensure_font() -> None:
    global _FONT_REGISTERED, _FONT, _FONT_BOLD
    if _FONT_REGISTERED:
        return
    try:
        from reportlab.pdfbase.ttfonts import TTFont

        pdfmetrics.registerFont(TTFont("CNSong", _SONGTI_PATH, subfontIndex=6))
        pdfmetrics.registerFont(TTFont("CNSong-Bold", _SONGTI_PATH, subfontIndex=1))
        _FONT = "CNSong"
        _FONT_BOLD = "CNSong-Bold"
    except Exception:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        _FONT = "STSong-Light"
        _FONT_BOLD = "STSong-Light"
    _FONT_REGISTERED = True


def _styles() -> dict[str, ParagraphStyle]:
    return {
        "title": ParagraphStyle("title", fontName=_FONT_BOLD, fontSize=17, leading=25, textColor=INK, wordWrap="CJK"),
        "meta": ParagraphStyle("meta", fontName=_FONT, fontSize=9, leading=14, textColor=GRAY, wordWrap="CJK"),
        "section": ParagraphStyle(
            "section", fontName=_FONT_BOLD, fontSize=12.5, leading=18, textColor=colors.HexColor("#243B61"),
            spaceBefore=16, spaceAfter=6, wordWrap="CJK",
        ),
        "body": ParagraphStyle("body", fontName=_FONT, fontSize=10.5, leading=19, textColor=BODY, wordWrap="CJK"),
        "body_indent": ParagraphStyle(
            "body_indent", fontName=_FONT, fontSize=10.5, leading=19, textColor=BODY, wordWrap="CJK",
            leftIndent=4,
        ),
        "bullet": ParagraphStyle(
            "bullet", fontName=_FONT, fontSize=10.5, leading=18, textColor=BODY, wordWrap="CJK",
            leftIndent=10, bulletIndent=2, spaceBefore=3,
        ),
        "card_title": ParagraphStyle("card_title", fontName=_FONT_BOLD, fontSize=11, leading=17, textColor=colors.HexColor("#243B61"), wordWrap="CJK"),
        "card_meta": ParagraphStyle("card_meta", fontName=_FONT, fontSize=9, leading=13, textColor=FAINT, wordWrap="CJK"),
        "label": ParagraphStyle("label", fontName=_FONT, fontSize=9.5, leading=14, textColor=GRAY, spaceBefore=4, wordWrap="CJK"),
        "small": ParagraphStyle("small", fontName=_FONT, fontSize=9.5, leading=15, textColor=GRAY, wordWrap="CJK"),
        "link": ParagraphStyle("link", fontName=_FONT, fontSize=9, leading=14, textColor=BLUE, wordWrap="CJK"),
    }


def _clean(value: object, limit: int = 4_000) -> str:
    text = str(value or "").strip()
    return text[:limit]


def _format_date(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return "—"
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text.replace("T", " ")[:16]
    local = parsed.astimezone(_TZ)
    return local.strftime("%Y-%m-%d %H:%M")


def _section_heading(story: list, styles: dict[str, ParagraphStyle], title: str) -> None:
    story.append(Paragraph(escape(title), styles["section"]))
    story.append(HRFlowable(width="100%", thickness=0.6, color=CARD_BORDER, spaceAfter=6))


def _bullet_list(story: list, styles: dict[str, ParagraphStyle], items: list[str]) -> None:
    for item in items:
        text = _clean(item, 500)
        if not text:
            continue
        story.append(Paragraph(escape(text), styles["bullet"], bulletText="•"))


def _dynamics_block(dynamic: dict, index: int, source_indexes: dict[str, int], styles: dict[str, ParagraphStyle]):
    parts: list = []
    title = _clean(dynamic.get("title"), 200) or f"动态 {index + 1}"
    header_bits = [escape(title)]
    information_time = _clean(dynamic.get("information_time"), 60)
    if information_time:
        header_bits.append(f'<font size="9" color="#98A2B3"> {escape(information_time)}</font>')
    parts.append(Paragraph("".join(header_bits), styles["card_title"]))
    institutions = [str(item) for item in (dynamic.get("institutions") or []) if str(item).strip()]
    if institutions:
        parts.append(Paragraph(f"涉及机构：{escape('、'.join(institutions[:10]))}", styles["card_meta"]))
    tags = [str(item) for item in (dynamic.get("event_tags") or []) if str(item).strip()]
    if tags:
        parts.append(Paragraph(escape(" · ".join(tags[:8])), styles["card_meta"]))
    summary = _clean(dynamic.get("summary"), 2_000)
    if summary:
        parts.append(Paragraph("摘要", styles["label"]))
        parts.append(Paragraph(escape(summary), styles["body_indent"]))
    impact = _clean(dynamic.get("impact_analysis"), 1_500)
    if impact:
        parts.append(Paragraph("影响分析", styles["label"]))
        parts.append(Paragraph(escape(impact), styles["body_indent"]))
    source_ids = [str(item) for item in (dynamic.get("source_ids") or [])]
    marks = [str(source_indexes[sid]) for sid in source_ids if sid in source_indexes]
    if marks:
        parts.append(Paragraph(f"来源：{'、'.join(marks)}", styles["card_meta"]))
    table = Table([[parts]], colWidths=[168 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, CARD_BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return KeepTogether([table, Spacer(1, 3 * mm)])


def build_report_pdf(execution: dict) -> bytes:
    """Build the PDF document bytes for a search-succeeded execution."""
    _ensure_font()
    styles = _styles()
    report = execution.get("report") if isinstance(execution.get("report"), dict) else {}
    sources = [item for item in (execution.get("sources") or []) if isinstance(item, dict)]
    source_indexes = {str(item.get("id")): index + 1 for index, item in enumerate(sources)}
    snapshot = execution.get("snapshot") if isinstance(execution.get("snapshot"), dict) else {}

    title = _clean(report.get("title"), 200) or _clean(execution.get("original_query"), 200) or "即时情报报告"
    story: list = [Paragraph(escape(title), styles["title"]), Spacer(1, 2.5 * mm)]

    meta_bits = [
        f"完成时间：{escape(_format_date(report.get('executed_at') or execution.get('completed_at') or execution.get('created_at')))}",
        f"时间范围：{escape(TIME_RANGE_LABELS.get(str(report.get('time_range') or snapshot.get('time_range')), '—'))}",
        f"报告类型：{escape(REPORT_TYPE_LABELS.get(str(report.get('report_type') or snapshot.get('report_type')), '—'))}",
        f"有效来源：{len(sources)} 条",
    ]
    story.append(Paragraph(" ｜ ".join(meta_bits), styles["meta"]))
    question = _clean(execution.get("original_query") or snapshot.get("question"), 500)
    if question:
        story.append(Spacer(1, 1.5 * mm))
        story.append(Paragraph(f"业务问题：{escape(question)}", styles["meta"]))

    core_conclusion = _clean(report.get("core_conclusion"), 4_000)
    if core_conclusion:
        _section_heading(story, styles, "核心结论")
        story.append(Paragraph(escape(core_conclusion).replace("\n", "<br/>"), styles["body"]))

    dynamics = [item for item in (report.get("key_dynamics") or []) if isinstance(item, dict)]
    if dynamics:
        _section_heading(story, styles, f"重点动态（{len(dynamics)}）")
        for index, dynamic in enumerate(dynamics):
            story.append(_dynamics_block(dynamic, index, source_indexes, styles))

    focus_sections = [
        item
        for item in (report.get("focus_sections") or [])
        if isinstance(item, dict) and str(item.get("title") or "").strip() and item.get("items")
    ]
    if focus_sections:
        _section_heading(story, styles, "专属分析章节")
        for section in focus_sections:
            story.append(Paragraph(escape(_clean(section.get("title"), 120)), styles["card_title"]))
            story.append(Spacer(1, 1 * mm))
            _bullet_list(story, styles, [str(item) for item in (section.get("items") or [])])
            story.append(Spacer(1, 3 * mm))

    impact_analysis = _clean(report.get("impact_analysis"), 4_000)
    if impact_analysis:
        _section_heading(story, styles, "影响分析")
        story.append(Paragraph(escape(impact_analysis).replace("\n", "<br/>"), styles["body"]))

    columns: list[tuple[str, list[str]]] = []
    for heading, key in (("机会", "opportunities"), ("风险", "risks"), ("关注事项", "watch_items")):
        items = [str(item) for item in (report.get(key) or []) if str(item).strip()]
        if items:
            columns.append((heading, items))
    if columns:
        _section_heading(story, styles, "机会 · 风险 · 关注事项")
        width = 168 * mm / len(columns)
        cells = []
        for heading, items in columns:
            cell_parts = [Paragraph(escape(heading), styles["card_title"]), Spacer(1, 1.5 * mm)]
            for item in items[:12]:
                cell_parts.append(Paragraph(escape(_clean(item, 400)), styles["bullet"], bulletText="•"))
            cells.append(cell_parts)
        grid = Table([cells], colWidths=[width] * len(columns))
        grid.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
                    ("BOX", (0, 0), (-1, -1), 0.5, CARD_BORDER),
                    ("LINEBEFORE", (1, 0), (-1, -1), 0.5, CARD_BORDER),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ]
            )
        )
        story.append(grid)

    followups = [str(item) for item in (report.get("recommended_followups") or []) if str(item).strip()]
    if followups:
        _section_heading(story, styles, "推荐追问")
        _bullet_list(story, styles, followups)

    if sources:
        _section_heading(story, styles, f"本次报告参考来源（{len(sources)}）")
        for index, source in enumerate(sources):
            parts: list = []
            source_title = _clean(source.get("title"), 200) or "未命名来源"
            parts.append(Paragraph(f"{index + 1}. {escape(source_title)}", styles["card_title"]))
            site_bits = [_clean(source.get("site_name"), 80) or "未知站点"]
            source_date = _clean(source.get("date"), 40)
            if source_date:
                site_bits.append(source_date)
            parts.append(Paragraph(escape(" · ".join(site_bits)), styles["card_meta"]))
            snippet = _clean(source.get("snippet"), 160)
            if snippet:
                parts.append(Paragraph(escape(snippet), styles["small"]))
            url = str(source.get("url") or "").strip()
            if re.match(r"^https?://[^\s]+$", url, flags=re.IGNORECASE):
                display = url if len(url) <= 90 else url[:87] + "..."
                parts.append(Paragraph(f'<link href="{escape(url, {chr(34): "&quot;"})}" color="#315EA8">{escape(display)}</link>', styles["link"]))
            table = Table([[parts]], colWidths=[168 * mm])
            table.setStyle(
                TableStyle(
                    [
                        ("BOX", (0, 0), (-1, -1), 0.5, CARD_BORDER),
                        ("LEFTPADDING", (0, 0), (-1, -1), 8),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                        ("TOPPADDING", (0, 0), (-1, -1), 6),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ]
                )
            )
            story.append(KeepTogether([table, Spacer(1, 2 * mm)]))

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=title,
        author="券商招采智能分析系统",
    )

    def _on_page(canvas, doc):  # noqa: ANN001
        canvas.saveState()
        canvas.setFont(_FONT, 8)
        canvas.setFillColor(FAINT)
        canvas.drawCentredString(A4[0] / 2, 10 * mm, f"第 {doc.page} 页")
        canvas.restoreState()

    document.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    return buffer.getvalue()


def report_pdf_filename(execution: dict) -> str:
    """Build "<报告标题>_<YYYY-MM-DD>.pdf" with filesystem-safe characters."""
    report = execution.get("report") if isinstance(execution.get("report"), dict) else {}
    title = _clean(report.get("title"), 200) or _clean(execution.get("original_query"), 200) or "即时情报报告"
    safe_title = re.sub(r"[\\/:*?\"<>|\r\n\t]+", "_", title).strip(" ._")[:60] or "即时情报报告"
    completed = str(execution.get("completed_at") or execution.get("created_at") or "").strip()
    try:
        parsed = datetime.fromisoformat(completed.replace("Z", "+00:00")).astimezone(_TZ)
    except (ValueError, AttributeError):
        parsed = datetime.now(_TZ)
    return f"{safe_title}_{parsed.strftime('%Y-%m-%d')}.pdf"
