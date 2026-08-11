"""Render a persisted Report V2 as a compact research-brief PDF.

The PDF and HTML email both consume :mod:`intelligence_report_view`; the
renderer only adapts spacing and typography for A4 printing.
"""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import CondPageBreak, HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Table, TableStyle

from .intelligence_report_view import (
    ReportItemView,
    ReportSectionView,
    ReportSourceView,
    ReportView,
    TemplateStyle,
    build_report_view,
    format_report_datetime,
    normalize_template_style,
)

try:
    from zoneinfo import ZoneInfo

    _TZ = ZoneInfo("Asia/Shanghai")
except Exception:  # pragma: no cover - very old platforms
    _TZ = timezone.utc


# Songti is present in the supported macOS deployment image.  On Linux or
# Windows, the CID fallback below remains embedded by ReportLab and keeps CJK
# text readable without requiring a new runtime dependency.
_SONGTI_PATH = "/System/Library/Fonts/Supplemental/Songti.ttc"
_FONT = "STSong-Light"
_FONT_BOLD = "STSong-Light"
_FONT_REGISTERED = False

INK = colors.HexColor("#172033")
BODY = colors.HexColor("#25324A")
MUTED = colors.HexColor("#667085")
FAINT = colors.HexColor("#8792A2")
BLUE = colors.HexColor("#315EA8")
LINE = colors.HexColor("#D8E1EF")


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
        "kicker": ParagraphStyle(
            "kicker", fontName=_FONT_BOLD, fontSize=8.5, leading=12, textColor=BLUE,
            letterSpacing=0.5, wordWrap="CJK",
        ),
        "title": ParagraphStyle(
            "title", fontName=_FONT_BOLD, fontSize=18, leading=26, textColor=INK,
            spaceBefore=3, spaceAfter=5, wordWrap="CJK",
        ),
        "meta": ParagraphStyle(
            "meta", fontName=_FONT, fontSize=9, leading=14, textColor=MUTED,
            spaceAfter=1, wordWrap="CJK",
        ),
        "question": ParagraphStyle(
            "question", fontName=_FONT, fontSize=9.5, leading=15, textColor=BODY,
            spaceBefore=5, spaceAfter=2, wordWrap="CJK",
        ),
        "section": ParagraphStyle(
            "section", fontName=_FONT_BOLD, fontSize=13, leading=19, textColor=colors.HexColor("#1F3B68"),
            spaceBefore=14, spaceAfter=5, keepWithNext=True, wordWrap="CJK",
        ),
        "body": ParagraphStyle(
            "body", fontName=_FONT, fontSize=10.5, leading=18, textColor=BODY,
            spaceAfter=7, wordWrap="CJK",
        ),
        "core_body": ParagraphStyle(
            "core_body", fontName=_FONT, fontSize=10.5, leading=18, textColor=BODY,
            leftIndent=7, rightIndent=3, spaceAfter=7, wordWrap="CJK",
            # Core conclusions are distinguished by the blue section rule and
            # label, without putting every item in a card or tinted box.
        ),
        "empty": ParagraphStyle(
            "empty", fontName=_FONT, fontSize=10, leading=16, textColor=FAINT,
            spaceAfter=7, wordWrap="CJK",
        ),
        "warning": ParagraphStyle(
            "warning", fontName=_FONT, fontSize=9, leading=14, textColor=colors.HexColor("#7B5D19"),
            spaceAfter=5, wordWrap="CJK",
        ),
        "source_title": ParagraphStyle(
            "source_title", fontName=_FONT_BOLD, fontSize=9.5, leading=15, textColor=BODY,
            leftIndent=0, firstLineIndent=0, spaceBefore=4, spaceAfter=1, wordWrap="CJK",
        ),
        "source_meta": ParagraphStyle(
            "source_meta", fontName=_FONT, fontSize=8.7, leading=13, textColor=MUTED,
            leftIndent=8, spaceAfter=1, wordWrap="CJK",
        ),
        "source_link": ParagraphStyle(
            "source_link", fontName=_FONT, fontSize=8.3, leading=12, textColor=BLUE,
            leftIndent=8, spaceAfter=5, wordWrap="CJK",
        ),
    }


def _paragraph_text(value: object, limit: int = 4_000) -> str:
    return escape(str(value or "").strip()[:limit]).replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br/>")


def _item_paragraph(item: ReportItemView, styles: dict[str, ParagraphStyle], *, core: bool) -> Paragraph:
    citation = ""
    if item.citation_numbers:
        citation = f' <font color="#667085" size="8.5">{" ".join(f"[{number}]" for number in item.citation_numbers)}</font>'
    text = (
        f'<font color="#315EA8"><b>{item.number}:</b></font> '
        f"{_paragraph_text(item.text)}{citation}"
    )
    return Paragraph(text, styles["core_body" if core else "body"])


def _section_story(story: list[object], section: ReportSectionView, styles: dict[str, ParagraphStyle]) -> None:
    heading = Paragraph(escape(section.title), styles["section"])
    divider = HRFlowable(width="100%", thickness=0.65, color=BLUE if section.key == "core_judgment" else LINE, spaceBefore=0, spaceAfter=7)
    story.append(KeepTogether([heading, divider]))
    if section.items:
        for item in section.items:
            story.append(_item_paragraph(item, styles, core=section.key == "core_judgment"))
    else:
        story.append(Paragraph("暂无内容。", styles["empty"]))


def _source_story(story: list[object], source: ReportSourceView, styles: dict[str, ParagraphStyle]) -> None:
    source_parts: list[object] = [Paragraph(f"{source.number}. {escape(source.title)}", styles["source_title"])]
    details = " · ".join(part for part in (source.site_name, source.date) if part)
    if details:
        source_parts.append(Paragraph(escape(details), styles["source_meta"]))
    if re.match(r"^https?://[^\s]+$", source.url, flags=re.IGNORECASE):
        safe_url = escape(source.url, {chr(34): "&quot;"})
        display = source.url if len(source.url) <= 110 else source.url[:107] + "..."
        source_parts.append(
            Paragraph(
                f'<link href="{safe_url}" color="#315EA8">{escape(display)}</link>',
                styles["source_link"],
            )
        )
    # Keep a source's title, date and URL together so a page break never
    # leaves an orphaned link at the top of the following page.
    story.append(KeepTogether(source_parts))


def _header_footer(canvas, doc) -> None:  # noqa: ANN001
    canvas.saveState()
    left = 19 * mm
    right = A4[0] - 19 * mm
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.45)
    canvas.line(left, A4[1] - 12 * mm, right, A4[1] - 12 * mm)
    canvas.setFont(_FONT, 8)
    canvas.setFillColor(FAINT)
    canvas.drawString(left, 8 * mm, "自定义情报订阅系统")
    canvas.drawRightString(right, 8 * mm, f"第 {doc.page} 页")
    canvas.restoreState()


def _build_research_pdf(execution: dict) -> bytes:
    """Build polished A4 PDF bytes from one persisted Report V2 execution."""

    _ensure_font()
    view: ReportView = build_report_view(execution)
    styles = _styles()
    story: list[object] = [
        Paragraph("自定义情报订阅系统", styles["kicker"]),
        Paragraph(escape(view.title), styles["title"]),
        HRFlowable(width="100%", thickness=1.2, color=BLUE, spaceBefore=0, spaceAfter=8),
    ]
    if view.question:
        story.append(Paragraph(f"<b>研究重点：</b>{_paragraph_text(view.question, 1_000)}", styles["question"]))
    for section in view.sections:
        _section_story(story, section, styles)

    if view.reference_warnings or view.sources:
        # Keep the compact source appendix together at a page boundary when
        # the current page has only a small amount of room left.  This avoids
        # a heading/warning stranded above a page break while reserving far
        # less space than the old per-card renderer did.
        story.append(CondPageBreak(55 * mm))
        heading = Paragraph("信息来源", styles["section"])
        divider = HRFlowable(width="100%", thickness=0.65, color=LINE, spaceBefore=0, spaceAfter=7)
        story.append(KeepTogether([heading, divider]))
        for warning in view.reference_warnings:
            story.append(Paragraph(f"来源提示：{_paragraph_text(warning, 1_000)}", styles["warning"]))
        if view.sources:
            for source in view.sources:
                _source_story(story, source, styles)
        else:
            story.append(Paragraph("暂无可列示来源。", styles["empty"]))

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=19 * mm,
        rightMargin=19 * mm,
        topMargin=18 * mm,
        bottomMargin=17 * mm,
        title=view.title,
        author="自定义情报订阅系统",
    )
    document.build(story, onFirstPage=_header_footer, onLaterPages=_header_footer)
    return buffer.getvalue()


NEWSLETTER_RED = colors.HexColor("#B42318")
NEWSLETTER_INK = colors.HexColor("#161616")
NEWSLETTER_MUTED = colors.HexColor("#667085")


def _newsletter_styles() -> dict[str, ParagraphStyle]:
    return {
        "masthead": ParagraphStyle(
            "newsletter_masthead", fontName=_FONT_BOLD, fontSize=25, leading=31,
            textColor=NEWSLETTER_INK, alignment=TA_CENTER, wordWrap="CJK",
        ),
        "subtitle": ParagraphStyle(
            "newsletter_subtitle", fontName=_FONT, fontSize=8.8, leading=13,
            textColor=NEWSLETTER_MUTED, alignment=TA_CENTER, wordWrap="CJK",
        ),
        "date": ParagraphStyle(
            "newsletter_date", fontName=_FONT, fontSize=8.5, leading=13,
            textColor=NEWSLETTER_MUTED, alignment=TA_CENTER, wordWrap="CJK",
        ),
        "title": ParagraphStyle(
            "newsletter_title", fontName=_FONT_BOLD, fontSize=17, leading=24,
            textColor=NEWSLETTER_INK, spaceBefore=5, spaceAfter=4, wordWrap="CJK",
        ),
        "meta": ParagraphStyle(
            "newsletter_meta", fontName=_FONT, fontSize=8.5, leading=13,
            textColor=NEWSLETTER_RED, spaceAfter=1, wordWrap="CJK",
        ),
        "question": ParagraphStyle(
            "newsletter_question", fontName=_FONT, fontSize=9, leading=14,
            textColor=NEWSLETTER_MUTED, spaceBefore=4, spaceAfter=3, wordWrap="CJK",
        ),
        "label": ParagraphStyle(
            "newsletter_label", fontName=_FONT_BOLD, fontSize=9.2, leading=14,
            textColor=colors.white, backColor=NEWSLETTER_RED, borderPadding=(3, 6, 3, 6),
            spaceBefore=11, spaceAfter=7, wordWrap="CJK",
        ),
        "column_label": ParagraphStyle(
            "newsletter_column_label", fontName=_FONT_BOLD, fontSize=10.2, leading=15,
            textColor=NEWSLETTER_RED, spaceAfter=4, wordWrap="CJK",
        ),
        "source_heading": ParagraphStyle(
            "newsletter_source_heading", fontName=_FONT_BOLD, fontSize=10.2, leading=15,
            textColor=NEWSLETTER_INK, spaceAfter=4, wordWrap="CJK",
        ),
        "body": ParagraphStyle(
            "newsletter_body", fontName=_FONT, fontSize=9.5, leading=16,
            textColor=NEWSLETTER_INK, spaceAfter=5, wordWrap="CJK",
        ),
        "recommendation": ParagraphStyle(
            "newsletter_recommendation", fontName=_FONT, fontSize=9.5, leading=16,
            textColor=NEWSLETTER_INK, leftIndent=7, spaceAfter=5, wordWrap="CJK",
        ),
        "risk": ParagraphStyle(
            "newsletter_risk", fontName=_FONT, fontSize=9, leading=15,
            textColor=NEWSLETTER_INK, spaceAfter=4, wordWrap="CJK",
        ),
        "warning": ParagraphStyle(
            "newsletter_warning", fontName=_FONT, fontSize=8.5, leading=13,
            textColor=colors.HexColor("#7B5D19"), spaceAfter=4, wordWrap="CJK",
        ),
        "empty": ParagraphStyle(
            "newsletter_empty", fontName=_FONT, fontSize=9, leading=14,
            textColor=FAINT, spaceAfter=5, wordWrap="CJK",
        ),
    }


def _newsletter_pdf_item(
    item: ReportItemView,
    styles: dict[str, ParagraphStyle],
    *,
    compact: bool = False,
    recommendation: bool = False,
) -> Paragraph:
    citation = ""
    if item.citation_numbers:
        citation = f' <font color="#667085" size="7.8">{" ".join(f"[{number}]" for number in item.citation_numbers)}</font>'
    style_name = "recommendation" if recommendation else "body"
    text = (
        f'<font color="#B42318"><b>{item.number}:</b></font> '
        f"{_paragraph_text(item.text)}{citation}"
    )
    paragraph = Paragraph(text, styles[style_name])
    if compact:
        paragraph.style.spaceAfter = 3
    return paragraph


def _newsletter_pdf_items(
    items: tuple[ReportItemView, ...],
    styles: dict[str, ParagraphStyle],
    *,
    compact: bool = False,
    recommendation: bool = False,
) -> list[Paragraph]:
    if not items:
        return [Paragraph("暂无内容。", styles["empty"])]
    return [
        _newsletter_pdf_item(item, styles, compact=compact, recommendation=recommendation)
        for item in items
    ]


def _newsletter_table_style(*, line_before: bool = False, box: bool = False) -> TableStyle:
    commands: list[tuple[object, ...]] = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]
    if line_before:
        commands.append(("LINEBEFORE", (0, 0), (0, -1), 2.2, NEWSLETTER_RED))
        commands.append(("LEFTPADDING", (0, 0), (0, -1), 8))
    if box:
        commands.extend(
            [
                ("BOX", (0, 0), (-1, -1), 0.55, colors.HexColor("#D7DADD")),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FCFCFB")),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    return TableStyle(commands)


def _newsletter_footer(canvas, doc) -> None:  # noqa: ANN001
    canvas.saveState()
    left = 19 * mm
    right = A4[0] - 19 * mm
    canvas.setStrokeColor(colors.HexColor("#111111"))
    canvas.setLineWidth(0.45)
    canvas.line(left, 12 * mm, right, 12 * mm)
    canvas.setFont(_FONT, 8)
    canvas.setFillColor(FAINT)
    canvas.drawString(left, 8 * mm, "自定义情报助手")
    canvas.drawRightString(right, 8 * mm, f"第 {doc.page} 页")
    canvas.restoreState()


def _build_newsletter_pdf(execution: dict) -> bytes:
    """Build the red-label, newspaper-like newsletter PDF template."""

    _ensure_font()
    view: ReportView = build_report_view(execution)
    styles = _newsletter_styles()
    section_by_key = {section.key: section for section in view.sections}
    core = section_by_key.get("core_judgment")
    developments = section_by_key.get("key_developments")
    impact = section_by_key.get("impact_analysis")
    recommendations = section_by_key.get("company_implications")
    risks = section_by_key.get("risks_and_watch_items")
    story: list[object] = [
        Paragraph("自定义情报助手", styles["masthead"]),
        Paragraph("金融科技情报日报 · Financial Tech Daily", styles["subtitle"]),
        Paragraph(f"{escape(format_report_datetime(view.executed_at))} · 深圳", styles["date"]),
        HRFlowable(width="100%", thickness=1.8, color=colors.HexColor("#111111"), spaceBefore=8, spaceAfter=10),
        Paragraph(escape(view.title), styles["title"]),
    ]
    if view.question:
        story.append(Paragraph(f"研究重点：{_paragraph_text(view.question, 1_000)}", styles["question"]))

    story.append(Paragraph("独家分析", styles["label"]))
    core_rows = [[item] for item in _newsletter_pdf_items(core.items if core else (), styles)]
    core_table = Table(
        core_rows,
        colWidths=[172 * mm],
    )
    core_table.setStyle(_newsletter_table_style(line_before=True))
    story.append(core_table)

    story.append(Paragraph("市场观察", styles["label"]))
    development_items = developments.items if developments else ()
    impact_items = impact.items if impact else ()
    column_rows: list[list[object]] = [[Paragraph("重点动态", styles["column_label"]), Paragraph("影响分析", styles["column_label"])]]
    for index in range(max(len(development_items), len(impact_items), 1)):
        left = _newsletter_pdf_item(development_items[index], styles, compact=True) if index < len(development_items) else Paragraph("", styles["empty"])
        right = _newsletter_pdf_item(impact_items[index], styles, compact=True) if index < len(impact_items) else Paragraph("", styles["empty"])
        column_rows.append([left, right])
    columns = Table(column_rows, colWidths=[86 * mm, 86 * mm], repeatRows=1)
    columns.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("LINEBEFORE", (1, 0), (1, -1), 0.45, LINE),
                ("LEFTPADDING", (1, 0), (1, -1), 8),
            ]
        )
    )
    story.append(columns)

    story.append(Paragraph("研判与建议", styles["label"]))
    recommendation_rows = [
        [item]
        for item in _newsletter_pdf_items(
            recommendations.items if recommendations else (), styles, recommendation=True
        )
    ]
    recommendation_table = Table(
        recommendation_rows,
        colWidths=[172 * mm],
    )
    recommendation_table.setStyle(_newsletter_table_style(line_before=True))
    story.append(recommendation_table)

    story.append(Paragraph("风险提示", styles["label"]))
    risk_rows = [[item] for item in _newsletter_pdf_items(risks.items if risks else (), styles, compact=True)]
    risk_table = Table(
        risk_rows,
        colWidths=[172 * mm],
    )
    risk_table.setStyle(_newsletter_table_style(box=True))
    story.append(risk_table)

    if view.reference_warnings or view.sources:
        story.append(CondPageBreak(55 * mm))
        story.append(HRFlowable(width="100%", thickness=1.8, color=colors.HexColor("#111111"), spaceBefore=10, spaceAfter=7))
        story.append(Paragraph("信息来源 · SOURCES", styles["source_heading"]))
        for warning in view.reference_warnings:
            story.append(Paragraph(f"来源提示：{_paragraph_text(warning, 1_000)}", styles["warning"]))
        source_styles = _styles()
        for source in view.sources:
            _source_story(story, source, source_styles)

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=19 * mm,
        rightMargin=19 * mm,
        topMargin=18 * mm,
        bottomMargin=17 * mm,
        title=view.title,
        author="自定义情报助手",
    )
    document.build(story, onFirstPage=_newsletter_footer, onLaterPages=_newsletter_footer)
    return buffer.getvalue()


def build_report_pdf(execution: dict, template_style: TemplateStyle | str = "research") -> bytes:
    """Build a PDF with the selected visual template from one ReportView."""

    if normalize_template_style(template_style) == "newsletter":
        return _build_newsletter_pdf(execution)
    return _build_research_pdf(execution)


def report_pdf_filename(execution: dict) -> str:
    """Build ``<报告标题>_<YYYY-MM-DD>.pdf`` with filesystem-safe characters."""

    report = execution.get("report") if isinstance(execution.get("report"), dict) else {}
    title = str(report.get("title") or execution.get("original_query") or "即时情报报告").strip()[:200]
    safe_title = re.sub(r"[\\/:*?\"<>|\r\n\t]+", "_", title).strip(" ._")[:60] or "即时情报报告"
    completed = str(execution.get("completed_at") or execution.get("created_at") or "").strip()
    try:
        parsed = datetime.fromisoformat(completed.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        parsed = parsed.astimezone(_TZ)
    except (ValueError, AttributeError):
        parsed = datetime.now(_TZ)
    return f"{safe_title}_{parsed.strftime('%Y-%m-%d')}.pdf"
