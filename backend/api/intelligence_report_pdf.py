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
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import CondPageBreak, HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate

from .intelligence_report_view import ReportItemView, ReportSectionView, ReportSourceView, ReportView, build_report_view

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
        f'<font color="#315EA8"><b>{item.number}. {escape(item.type_label)}：</b></font>'
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


def build_report_pdf(execution: dict) -> bytes:
    """Build polished A4 PDF bytes from one persisted Report V2 execution."""

    _ensure_font()
    view: ReportView = build_report_view(execution)
    styles = _styles()
    story: list[object] = [
        Paragraph("自定义情报订阅系统", styles["kicker"]),
        Paragraph(escape(view.title), styles["title"]),
        HRFlowable(width="100%", thickness=1.2, color=BLUE, spaceBefore=0, spaceAfter=8),
    ]
    for label, value in view.meta:
        story.append(Paragraph(f"{escape(label)}：{escape(value)}", styles["meta"]))
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
