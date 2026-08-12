"""Pure presentation model for persisted custom-intelligence Report V2 data.

The storage schema intentionally keeps its historical field names.  This
module provides a small, renderer-neutral view of that data so the Web, email
and PDF presentations can share section ordering, wording and citation
numbers without copying report-generation logic.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal, Mapping

try:
    from zoneinfo import ZoneInfo

    _TZ = ZoneInfo("Asia/Shanghai")
except Exception:  # pragma: no cover - very old platforms
    _TZ = timezone.utc


AUDIENCE_LABELS: Mapping[str, str] = {
    "management": "管理层",
    "wealth_management": "财富管理",
    "investment_banking": "投行业务",
    "institutional_business": "机构业务",
    "asset_management": "资产管理",
    "proprietary_investment": "自营投资",
    "research_business": "研究业务",
    "fintech_operations": "金融科技 / 运营",
    "business_product": "业务 / 产品",
    "technology": "技术",
    "compliance_risk": "合规风控",
    "industry_research": "行业研究",
    "custom": "自定义",
}
TIME_RANGE_LABELS: Mapping[str, str] = {
    "week": "最近 7 天",
    "month": "最近 30 天",
    "semiyear": "最近 180 天",
    "year": "最近 365 天",
}
REPORT_LENGTH_LABELS: Mapping[str, str] = {
    "concise": "简报",
    "standard": "标准",
    "deep": "深度",
}
ITEM_TYPE_LABELS: Mapping[str, str] = {
    "fact": "事实",
    "analysis": "分析",
    "recommendation": "建议",
}
TemplateStyle = Literal["research", "newsletter"]
TEMPLATE_STYLES: tuple[str, str] = ("research", "newsletter")


def normalize_template_style(value: object) -> TemplateStyle:
    """Return a supported visual template without changing report content."""

    return "newsletter" if str(value or "").strip().casefold() == "newsletter" else "research"


@dataclass(frozen=True, slots=True)
class ReportItemView:
    """A report item with validated citation numbers for display."""

    number: int
    type: str
    type_label: str
    text: str
    source_ids: tuple[str, ...]
    citation_numbers: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class ReportSectionView:
    key: str
    title: str
    items: tuple[ReportItemView, ...]


@dataclass(frozen=True, slots=True)
class ReportSourceView:
    number: int
    source_id: str
    title: str
    site_name: str
    date: str
    snippet: str
    url: str


@dataclass(frozen=True, slots=True)
class ReportView:
    """Renderer-neutral Report V2 display data."""

    title: str
    question: str
    audience: str
    time_range: str
    report_length: str
    executed_at: str
    source_count: int
    sections: tuple[ReportSectionView, ...]
    reference_warnings: tuple[str, ...]
    sources: tuple[ReportSourceView, ...]

    @property
    def meta(self) -> tuple[tuple[str, str], ...]:
        """Stable metadata labels used by the HTML and PDF renderers."""

        return (
            ("受众", self.audience or "未指定"),
            ("时间范围", self.time_range or "未指定"),
            ("报告篇幅", self.report_length or "未指定"),
            ("有效来源", f"{self.source_count} 条"),
            ("生成时间", format_report_datetime(self.executed_at)),
        )


SECTION_SPECS: tuple[tuple[str, str], ...] = (
    ("core_judgment", "核心结论"),
    ("key_developments", "重点动态"),
    ("impact_analysis", "影响分析"),
    ("company_implications", "研判与建议"),
    ("risks_and_watch_items", "风险与后续关注"),
)


def _clean(value: object, limit: int = 4_000) -> str:
    return str(value or "").strip()[:limit]


def _list(value: object) -> list[object]:
    return list(value) if isinstance(value, (list, tuple)) else []


def report_research_direction(execution: Mapping[str, object]) -> str:
    """Return a user-facing LLM-planned direction without exposing diagnostics."""

    payload = execution.get("request_payload") if isinstance(execution.get("request_payload"), dict) else {}
    query_plan = payload.get("query_plan") if isinstance(payload.get("query_plan"), dict) else {}
    planner_plan = payload.get("planner_plan") if isinstance(payload.get("planner_plan"), dict) else {}
    search_summary = payload.get("search_summary") if isinstance(payload.get("search_summary"), dict) else {}
    for candidate in (
        query_plan.get("intent"),
        planner_plan.get("intent"),
        search_summary.get("planner_intent"),
    ):
        direction = _clean(candidate, 500)
        if direction and "降级检索" not in direction:
            return direction
    report = execution.get("report") if isinstance(execution.get("report"), dict) else {}
    return (
        _clean(report.get("title"), 500)
        or _clean(execution.get("original_query"), 500)
        or "本次情报研究"
    )


def format_report_datetime(value: object) -> str:
    """Format an ISO timestamp for human-facing output without leaking errors."""

    text = _clean(value, 80)
    if not text:
        return "未记录"
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return text.replace("T", " ")[:16]
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(_TZ).strftime("%Y-%m-%d %H:%M")


def _report_items(value: object, source_indexes: Mapping[str, int]) -> tuple[ReportItemView, ...]:
    items: list[ReportItemView] = []
    for raw in _list(value)[:30]:
        if not isinstance(raw, dict):
            continue
        text = _clean(raw.get("text"), 4_000)
        if not text:
            continue
        item_type = _clean(raw.get("type"), 32).casefold() or "analysis"
        source_ids = tuple(
            dict.fromkeys(
                str(source_id).strip()
                for source_id in _list(raw.get("source_ids"))
                if str(source_id).strip()
            )
        )
        citation_numbers = tuple(
            source_indexes[source_id] for source_id in source_ids if source_id in source_indexes
        )
        items.append(
            ReportItemView(
                number=len(items) + 1,
                type=item_type,
                type_label=ITEM_TYPE_LABELS.get(item_type, "分析"),
                text=text,
                source_ids=source_ids,
                citation_numbers=citation_numbers,
            )
        )
    return tuple(items)


def build_report_view(execution: Mapping[str, object]) -> ReportView:
    """Build a deterministic presentation model from one persisted execution.

    No LLM/provider/request details are included.  Report V2 remains the sole
    source of section content; only display labels are translated here.
    """

    report = execution.get("report") if isinstance(execution.get("report"), dict) else {}
    if report.get("version") != 2:
        raise ValueError("旧版报告不支持展示，请先再次生成 Report V2")
    snapshot = execution.get("snapshot") if isinstance(execution.get("snapshot"), dict) else {}
    raw_sources = execution.get("sources") if isinstance(execution.get("sources"), list) else []
    source_indexes: dict[str, int] = {}
    sources: list[ReportSourceView] = []
    for raw in raw_sources[:50]:
        if not isinstance(raw, dict):
            continue
        source_id = _clean(raw.get("id"), 200)
        if source_id and source_id not in source_indexes:
            source_indexes[source_id] = len(sources) + 1
        if not source_id:
            # Keep an unidentifiable source out of the citation map but do not
            # make malformed optional records break report rendering.
            continue
        sources.append(
            ReportSourceView(
                number=len(sources) + 1,
                source_id=source_id,
                title=_clean(raw.get("title"), 400) or "未命名来源",
                site_name=_clean(raw.get("site_name"), 120),
                date=_clean(raw.get("date"), 80),
                snippet=_clean(raw.get("snippet"), 800),
                url=_clean(raw.get("url"), 2_000),
            )
        )

    sections = tuple(
        ReportSectionView(key=key, title=title, items=_report_items(report.get(key), source_indexes))
        for key, title in SECTION_SPECS
    )
    title = _clean(report.get("title"), 500) or _clean(execution.get("original_query"), 500) or "即时情报报告"
    question = report_research_direction(execution)
    audience_key = _clean(report.get("audience") or snapshot.get("audience"), 120)
    time_range_key = _clean(report.get("time_range") or snapshot.get("time_range"), 32)
    report_length_key = _clean(report.get("report_length") or snapshot.get("report_length"), 32)
    executed_at = _clean(
        report.get("executed_at")
        or execution.get("completed_at")
        or execution.get("created_at"),
        80,
    )
    warnings = tuple(_clean(item, 1_000) for item in _list(report.get("reference_warnings")) if _clean(item, 1_000))
    return ReportView(
        title=title,
        question=question,
        audience=AUDIENCE_LABELS.get(audience_key, audience_key),
        time_range=TIME_RANGE_LABELS.get(time_range_key, time_range_key),
        report_length=REPORT_LENGTH_LABELS.get(report_length_key, report_length_key),
        executed_at=executed_at,
        source_count=len(sources),
        sections=sections,
        reference_warnings=warnings,
        sources=tuple(sources),
    )
