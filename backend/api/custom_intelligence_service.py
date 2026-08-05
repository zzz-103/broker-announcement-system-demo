from __future__ import annotations

import html
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from pydantic import ValidationError

from .config import settings
from .contracts import IntelligenceReport
from .custom_intelligence_store import (
    ActiveExecutionError,
    IntelligenceNotFoundError,
    IntelligenceStoreError,
    store,
)
from .qianfan_search import (
    QianfanError,
    QianfanSearchResult,
    build_search_payload,
    client as qianfan_client,
    qianfan_error_message,
    validate_configuration,
)


PERSPECTIVE_LABELS = {
    "management": "管理层视角",
    "product_business": "产品与业务视角",
    "technology": "技术视角",
    "compliance_risk": "合规与风险视角",
    "industry_research": "行业研究视角",
}
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
REPORT_FOCUS_LABELS = {
    "management_brief": ["管理层决策要点", "需协调事项"],
    "competitive_analysis": ["主要竞争对手对比", "竞争格局变化"],
    "industry_trends": ["趋势信号", "行业演进判断"],
    "risk_monitoring": ["风险预警", "合规处置建议"],
}
DEPTH_LABELS = {"concise": "简洁", "standard": "标准", "deep": "深入"}
SOURCE_PREFERENCE_LABELS = {
    "authoritative": "权威来源优先",
    "balanced": "综合平衡",
    "news": "新闻与公告优先",
    "research": "研究资料优先",
}
PRESET_QUESTIONS = [
    {
        "id": "management_strategy",
        "title": "战略变化与经营影响",
        "question": "近期证券行业的重要战略变化将如何影响公司的经营重点与资源投入？",
        "analysis_perspective": "management",
        "report_type": "management_brief",
    },
    {
        "id": "management_opportunities_risks",
        "title": "机会与风险判断",
        "question": "当前竞争格局下，未来半年最值得管理层关注的业务机会和主要风险是什么？",
        "analysis_perspective": "management",
        "report_type": "management_brief",
    },
    {
        "id": "product_experience",
        "title": "产品与客户体验",
        "question": "近期头部券商在产品功能和客户体验方面有哪些值得借鉴的新做法？",
        "analysis_perspective": "product_business",
        "report_type": "competitive_analysis",
    },
    {
        "id": "business_model_practice",
        "title": "业务模式与同业实践",
        "question": "券商重点业务模式正在发生哪些变化，代表性同业实践带来了什么启示？",
        "analysis_perspective": "product_business",
        "report_type": "competitive_analysis",
    },
    {
        "id": "regulatory_risk",
        "title": "监管与风险监测",
        "question": "近期证券行业监管政策和合规风险有哪些值得关注的变化？",
        "analysis_perspective": "compliance_risk",
        "report_type": "risk_monitoring",
    },
    {
        "id": "technology_llm_agent",
        "title": "大模型与 Agent 应用",
        "question": "近期券商在大模型、知识库和 Agent 应用方面有哪些落地进展与建设重点？",
        "analysis_perspective": "technology",
        "report_type": "industry_trends",
    },
    {
        "id": "technology_data_platform",
        "title": "数据平台与系统建设",
        "question": "证券行业数据平台和核心系统建设近期有哪些代表性项目与技术路线变化？",
        "analysis_perspective": "technology",
        "report_type": "industry_trends",
    },
    {
        "id": "compliance_data_model",
        "title": "数据与模型风险",
        "question": "证券机构在数据安全、模型风险和内容合规方面面临哪些新增要求与典型问题？",
        "analysis_perspective": "compliance_risk",
        "report_type": "risk_monitoring",
    },
    {
        "id": "industry_trends",
        "title": "行业趋势与热点",
        "question": "近期证券行业有哪些持续升温的趋势和市场热点，背后的驱动因素是什么？",
        "analysis_perspective": "industry_research",
        "report_type": "industry_trends",
    },
    {
        "id": "industry_cases",
        "title": "代表案例与机构动态",
        "question": "近期证券行业有哪些代表性案例和重点机构动态值得持续跟踪？",
        "analysis_perspective": "industry_research",
        "report_type": "industry_trends",
    },
]

TOP_K_BY_DEPTH = {"concise": 6, "standard": 8, "deep": 10}
MAX_TEXT = 8_000
_init_lock = threading.Lock()
_initialized = False
_executor: ThreadPoolExecutor | None = None
# Public alias makes the external boundary straightforward to replace in
# deterministic tests without importing the HTTP implementation.
client = qianfan_client


def initialize_service() -> None:
    global _initialized, _executor
    with _init_lock:
        if _initialized:
            return
        store.ensure_schema()
        store.recover_stale_executions()
        _executor = ThreadPoolExecutor(
            max_workers=settings.custom_intelligence_max_workers,
            thread_name_prefix="custom-intelligence",
        )
        _initialized = True


def options_payload() -> dict[str, object]:
    return {
        "perspectives": [{"value": key, "label": value} for key, value in PERSPECTIVE_LABELS.items()],
        "time_ranges": [{"value": key, "label": value} for key, value in TIME_RANGE_LABELS.items()],
        "report_types": [{"value": key, "label": value} for key, value in REPORT_TYPE_LABELS.items()],
        "analysis_depths": [{"value": key, "label": value} for key, value in DEPTH_LABELS.items()],
        "source_preferences": [{"value": key, "label": value} for key, value in SOURCE_PREFERENCE_LABELS.items()],
        "preset_questions": PRESET_QUESTIONS,
        "service_configured": bool(settings.baidu_qianfan_api_key and settings.baidu_qianfan_model),
        "deep_search_enabled": False,
    }


def clean_text(value: object, limit: int = MAX_TEXT) -> str:
    text = "" if value is None else str(value)
    text = re.sub(r"```(?:json|markdown|html|text)?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?[A-Za-z][^>]*>", "", text)
    text = html.unescape(text)
    text = re.sub(r"</?[A-Za-z][^>]*>", "", text)
    text = "".join(char for char in text if char in "\n\r\t" or ord(char) >= 32)
    return text.strip()[:limit]


def clean_list(value: object, limit: int = 30) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        cleaned = clean_text(item, 1_000)
        if cleaned and cleaned not in result:
            result.append(cleaned)
        if len(result) >= limit:
            break
    return result


def normalize_snapshot(payload: dict[str, object]) -> dict[str, object]:
    snapshot = dict(payload)
    if snapshot.get("search_question") and not snapshot.get("question"):
        snapshot["question"] = snapshot.get("search_question")
    for key in ("description", "extra_requirements", "question", "search_question"):
        if key in snapshot:
            snapshot[key] = clean_text(snapshot.get(key), 2_000 if key != "question" else 1_000)
    for key in ("keywords", "focus_objects", "specified_sites"):
        values = snapshot.get(key)
        if isinstance(values, list):
            snapshot[key] = clean_list(values, 30 if key == "keywords" else 20)
        else:
            snapshot[key] = []
    return snapshot


def build_final_query(snapshot: dict[str, object]) -> str:
    question = clean_text(snapshot.get("question"), 1_000)
    clauses = [question]
    description = clean_text(snapshot.get("description"), 2_000)
    if description:
        clauses.append(f"背景描述：{description}")
    keywords = [clean_text(item, 200) for item in snapshot.get("keywords", []) if clean_text(item, 200)]
    focus = [clean_text(item, 200) for item in snapshot.get("focus_objects", []) if clean_text(item, 200)]
    if keywords:
        clauses.append("重点关键词：" + "、".join(keywords))
    if focus:
        clauses.append("关注对象：" + "、".join(focus))
    perspective = PERSPECTIVE_LABELS.get(str(snapshot.get("analysis_perspective")), "行业研究视角")
    source_preference = SOURCE_PREFERENCE_LABELS.get(str(snapshot.get("source_preference")), "综合平衡")
    clauses.append(f"请以{perspective}分析，{source_preference}。")
    sites = [clean_text(item, 253) for item in snapshot.get("specified_sites", []) if clean_text(item, 253)]
    if sites:
        clauses.append("指定网站：" + "、".join(sites[:20]))
    return "\n".join(item for item in clauses if item).strip()


def build_instruction(snapshot: dict[str, object], source_count: int) -> str:
    report_type = REPORT_TYPE_LABELS.get(str(snapshot.get("report_type")), "行业动态")
    depth = DEPTH_LABELS.get(str(snapshot.get("analysis_depth")), "标准")
    extra = clean_text(snapshot.get("extra_requirements"), 2_000)
    extra_clause = f"额外要求：{extra}\n" if extra else ""
    return (
        "你是证券行业情报分析师。仅基于联网检索到的事实和引用来源回答，不要编造。"
        "请输出严格 JSON，不要输出 Markdown、HTML 或代码围栏。字段必须为："
        "title, question, executed_at, time_range, valid_source_count, core_conclusion, "
        "key_dynamics, impact_analysis, opportunities, risks, watch_items, recommended_followups。"
        "key_dynamics 是数组，每项包含 title、institutions（字符串数组）、information_time、"
        "summary、impact_analysis、event_tags（字符串数组）、source_ids（引用原始 ID 数组）。"
        "focus_sections 是数组，每项包含 title 和 items（字符串数组）；"
        f"必须按报告类型补充以下重点章节：{'、'.join(REPORT_FOCUS_LABELS.get(str(snapshot.get('report_type')), []))}。"
        f"报告类型为{report_type}，分析深度为{depth}，最多使用 {source_count} 条来源。"
        f"{extra_clause}所有字符串使用纯文本。"
    )


def _extract_json_object(answer: str) -> dict[str, object] | None:
    cleaned = clean_text(answer, MAX_TEXT)
    if not cleaned:
        return None
    try:
        value = json.loads(cleaned)
        return value if isinstance(value, dict) else None
    except (TypeError, ValueError, json.JSONDecodeError):
        pass
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        value = json.loads(cleaned[start : end + 1])
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def normalize_sources(result: QianfanSearchResult) -> tuple[list[dict[str, object]], dict[str, str]]:
    canonical: list[dict[str, object]] = []
    aliases: dict[str, str] = {}
    by_url: dict[str, dict[str, object]] = {}
    by_title: dict[str, dict[str, object]] = {}
    by_provider_id: dict[str, dict[str, object]] = {}
    for reference in result.references:
        url = reference.url.strip()
        if not re.match(r"^https?://[^\s]+$", url, flags=re.IGNORECASE):
            continue
        split_url = urlsplit(url)
        normalized_url = urlunsplit(
            (split_url.scheme.casefold(), split_url.netloc.casefold(), split_url.path.rstrip("/"), split_url.query, "")
        )
        normalized_title = clean_text(reference.title, 500).casefold()
        provider_id = clean_text(reference.provider_reference_id, 100) or str(len(aliases) + 1)
        existing = (
            by_provider_id.get(provider_id)
            or by_url.get(normalized_url)
            or (by_title.get(normalized_title) if normalized_title else None)
        )
        if existing is None:
            canonical_id = f"source-{len(canonical) + 1}"
            existing = {
                "id": canonical_id,
                "provider_reference_ids": [],
                "title": clean_text(reference.title, 500),
                "url": url,
                "site_name": clean_text(reference.site_name, 300),
                "date": clean_text(reference.date, 100),
                "snippet": clean_text(reference.snippet, 2_000),
            }
            canonical.append(existing)
            by_url[normalized_url] = existing
            if normalized_title:
                by_title[normalized_title] = existing
        by_provider_id[provider_id] = existing
        ids = existing["provider_reference_ids"]
        if isinstance(ids, list) and provider_id not in ids:
            ids.append(provider_id)
        aliases[provider_id] = str(existing["id"])
    return canonical, aliases


def _fallback_report(snapshot: dict[str, object], answer: str, sources: list[dict[str, object]], executed_at: str) -> dict[str, object]:
    return {
        "title": f"{REPORT_TYPE_LABELS.get(str(snapshot.get('report_type')), '行业动态')}：{clean_text(snapshot.get('question'), 160)}",
        "question": clean_text(snapshot.get("question"), 1_000),
        "executed_at": executed_at,
        "time_range": str(snapshot.get("time_range") or "month"),
        "valid_source_count": len(sources),
        "core_conclusion": clean_text(answer, 4_000) or "本次检索未返回可整理的综合回答。",
        "key_dynamics": [],
        "impact_analysis": "请结合来源原文进一步核验影响范围。" if sources else "暂无可核验来源。",
        "opportunities": [],
        "risks": [],
        "watch_items": [],
        "recommended_followups": [],
        "focus_sections": [
            {"title": title, "items": []}
            for title in REPORT_FOCUS_LABELS.get(str(snapshot.get("report_type")), [])
        ],
    }


def normalize_report(
    answer: str,
    snapshot: dict[str, object],
    sources: list[dict[str, object]],
    aliases: dict[str, str],
    followups: list[str],
    executed_at: str,
) -> dict[str, object]:
    raw = _extract_json_object(answer)
    if raw is None:
        return _fallback_report(snapshot, answer, sources, executed_at)
    raw = dict(raw)
    raw.setdefault("question", snapshot.get("question", ""))
    raw.setdefault("executed_at", executed_at)
    raw.setdefault("time_range", snapshot.get("time_range", "month"))
    raw.setdefault("valid_source_count", len(sources))
    raw["title"] = clean_text(raw.get("title"), 500)
    for key in ("question", "executed_at", "time_range", "core_conclusion", "impact_analysis"):
        raw[key] = clean_text(raw.get(key), 4_000 if key in {"core_conclusion", "impact_analysis"} else 1_000)
    for key in ("opportunities", "risks", "watch_items", "recommended_followups"):
        raw[key] = clean_list(raw.get(key), 30 if key != "recommended_followups" else 20)
    focus_sections: list[dict[str, object]] = []
    if isinstance(raw.get("focus_sections"), list):
        for section in raw["focus_sections"]:
            if not isinstance(section, dict):
                continue
            title = clean_text(section.get("title"), 200)
            items = clean_list(section.get("items"), 20)
            if title:
                focus_sections.append({"title": title, "items": items})
    raw["focus_sections"] = focus_sections[:6]
    dynamics: list[dict[str, object]] = []
    invalid_reference_ids: list[str] = []
    if isinstance(raw.get("key_dynamics"), list):
        for item in raw["key_dynamics"]:
            if not isinstance(item, dict):
                continue
            source_ids: list[str] = []
            for source_id in clean_list(item.get("source_ids"), 30):
                canonical_id = aliases.get(source_id)
                if canonical_id and canonical_id not in source_ids:
                    source_ids.append(canonical_id)
                elif not canonical_id and source_id not in invalid_reference_ids:
                    invalid_reference_ids.append(source_id)
            dynamics.append(
                {
                    "title": clean_text(item.get("title"), 500),
                    "institutions": clean_list(item.get("institutions"), 20),
                    "information_time": clean_text(item.get("information_time"), 100),
                    "summary": clean_text(item.get("summary"), 2_000),
                    "impact_analysis": clean_text(item.get("impact_analysis"), 2_000),
                    "event_tags": clean_list(item.get("event_tags"), 20),
                    "source_ids": source_ids,
                }
            )
    raw["key_dynamics"] = dynamics[:30]
    raw["recommended_followups"] = list(dict.fromkeys([*raw["recommended_followups"], *clean_list(followups, 20)]))[:20]
    try:
        report = IntelligenceReport.model_validate(raw)
    except ValidationError:
        return _fallback_report(snapshot, answer, sources, executed_at)
    result = report.model_dump(mode="json")
    result["valid_source_count"] = len(sources)
    if invalid_reference_ids:
        result["reference_warnings"] = [f"未找到引用来源：{source_id}" for source_id in invalid_reference_ids]
    return result


def _error_message(exc: Exception) -> str:
    if isinstance(exc, QianfanError):
        return qianfan_error_message(exc)
    return "情报执行失败，请稍后重试。"


def _run_execution(execution_id: int) -> None:
    try:
        execution = store.get_execution_by_id(execution_id)
        started = datetime.now(timezone.utc).isoformat()
        store.update_execution(execution_id, status="running", started_at=started)
        snapshot = normalize_snapshot(execution.get("snapshot") if isinstance(execution.get("snapshot"), dict) else {})
        final_query = build_final_query(snapshot)
        top_k = TOP_K_BY_DEPTH.get(str(snapshot.get("analysis_depth")), 8)
        instruction = build_instruction(snapshot, top_k)
        request_payload = build_search_payload(
            final_query,
            time_range=str(snapshot.get("time_range") or "month"),
            top_k=top_k,
            specified_sites=[str(item) for item in snapshot.get("specified_sites", [])],
            instruction=instruction,
        )
        # Store only a secret-free payload for diagnostics.
        store.update_execution(execution_id, final_query=final_query, request_payload_json=json.dumps(request_payload, ensure_ascii=False))
        result = client.search(request_payload)
        completed = datetime.now(timezone.utc).isoformat()
        sources, aliases = normalize_sources(result)
        report = normalize_report(result.answer, snapshot, sources, aliases, result.followups, completed)
        status = "succeeded" if result.answer.strip() or sources else "empty"
        store.update_execution(
            execution_id,
            status=status,
            completed_at=completed,
            report_json=json.dumps(report, ensure_ascii=False),
            sources_json=json.dumps(sources, ensure_ascii=False),
            reference_aliases_json=json.dumps(aliases, ensure_ascii=False),
            request_id=result.request_id,
            error_message=None,
        )
    except Exception as exc:  # never let worker exceptions escape without state
        try:
            request_id = getattr(exc, "request_id", None)
            store.update_execution(
                execution_id,
                status="failed",
                completed_at=datetime.now(timezone.utc).isoformat(),
                error_message=_error_message(exc),
                request_id=request_id if isinstance(request_id, str) and request_id else None,
            )
        except IntelligenceStoreError:
            pass


def submit_execution(
    owner_user_id: int,
    snapshot: dict[str, object],
    actor_user_id: int,
    *,
    trigger_type: str,
    topic_id: int | None = None,
    topic_name: str = "",
) -> dict[str, object]:
    initialize_service()
    validate_configuration()
    normalized = normalize_snapshot(snapshot)
    final_query = build_final_query(normalized)
    execution = store.create_execution(
        owner_user_id=owner_user_id,
        snapshot=normalized,
        trigger_type=trigger_type,
        actor_user_id=actor_user_id,
        topic_id=topic_id,
        topic_name=topic_name,
        original_query=str(normalized.get("question") or ""),
        final_query=final_query,
    )
    assert _executor is not None
    try:
        _executor.submit(_run_execution, int(execution["id"]))
    except Exception:
        store.update_execution(
            int(execution["id"]),
            status="failed",
            completed_at=datetime.now(timezone.utc).isoformat(),
            error_message="情报执行未能启动，请稍后重试。",
        )
        raise
    return execution


def suggest_keywords(payload: dict[str, object], max_suggestions: int = 8) -> list[str]:
    validate_configuration()
    description = clean_text(payload.get("description"), 2_000)
    keywords = clean_list(payload.get("keywords"), 30)
    focus_objects = clean_list(payload.get("focus_objects"), 20)
    perspective = PERSPECTIVE_LABELS.get(str(payload.get("analysis_perspective")), "行业研究视角")
    query = "请为以下证券行业情报主题补充检索关键词，只返回 JSON 数组字符串，不要 HTML。"
    query += f"\n描述：{description}\n已有关键词：{'、'.join(keywords)}\n关注对象：{'、'.join(focus_objects)}\n分析视角：{perspective}"
    request_payload = build_search_payload(
        query,
        time_range="month",
        top_k=1,
        instruction="只输出最多 8 个简短关键词组成的 JSON 数组。",
        search_mode="disabled",
    )
    result = client.search(request_payload)
    parsed: object
    try:
        parsed = json.loads(clean_text(result.answer, 4_000))
    except (TypeError, ValueError, json.JSONDecodeError):
        parsed = re.findall(r"[\u4e00-\u9fffA-Za-z0-9][^,，;；\n\]]{1,40}", clean_text(result.answer, 4_000))
    candidates = parsed if isinstance(parsed, list) else []
    existing = set(keywords)
    suggestions: list[str] = []
    for item in candidates:
        text = clean_text(item, 100)
        if text and text not in existing and text not in suggestions:
            suggestions.append(text)
        if len(suggestions) >= max(1, min(8, max_suggestions)):
            break
    return suggestions


__all__ = [
    "ActiveExecutionError",
    "client",
    "IntelligenceNotFoundError",
    "IntelligenceStoreError",
    "build_final_query",
    "initialize_service",
    "normalize_report",
    "normalize_sources",
    "options_payload",
    "store",
    "submit_execution",
    "suggest_keywords",
]
