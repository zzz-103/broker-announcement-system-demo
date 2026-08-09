from __future__ import annotations

import html
import json
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from pydantic import ValidationError

from backend.llm_table.llm_client import LLMApiConfig, OpenAICompatibleClient

from .config import PROJECT_ROOT, resolve_project_path, settings
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
    effective_search_config,
    qianfan_error_message,
    validate_configuration,
)


class AnalysisConfigurationError(Exception):
    """Raised when the configured analysis client is unavailable."""


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


def analysis_llm_config_path() -> Path:
    return resolve_project_path(
        os.getenv("LLM_CONFIG_PATH"),
        PROJECT_ROOT / "backend" / "config" / "llm_api_config.json",
    )


def analysis_service_configured() -> bool:
    try:
        path = analysis_llm_config_path()
        if not path.exists():
            return False
        config = LLMApiConfig.load(path)
        config.validate()
        return True
    except Exception:
        return False


def _load_analysis_client() -> OpenAICompatibleClient:
    path = analysis_llm_config_path()
    if not path.exists():
        raise ValueError("LLM 配置文件不存在")
    config = LLMApiConfig.load(path)
    config.validate()
    return OpenAICompatibleClient(config)


def options_payload() -> dict[str, object]:
    config = effective_search_config()
    configured = bool(config.api_key and config.endpoint)
    if not config.enabled:
        service_status = "disabled" if configured else "not_configured"
    else:
        service_status = "enabled" if configured else "not_configured"
    analysis_configured = analysis_service_configured()
    return {
        "perspectives": [{"value": key, "label": value} for key, value in PERSPECTIVE_LABELS.items()],
        "time_ranges": [{"value": key, "label": value} for key, value in TIME_RANGE_LABELS.items()],
        "report_types": [{"value": key, "label": value} for key, value in REPORT_TYPE_LABELS.items()],
        "analysis_depths": [{"value": key, "label": value} for key, value in DEPTH_LABELS.items()],
        "source_preferences": [{"value": key, "label": value} for key, value in SOURCE_PREFERENCE_LABELS.items()],
        "preset_questions": PRESET_QUESTIONS,
        "service_configured": configured,
        "service_enabled": config.enabled and configured,
        "service_status": service_status,
        "deep_search_enabled": False,
        "analysis_configured": analysis_configured,
        "analysis_service_status": "configured" if analysis_configured else "not_configured",
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
            limit = 30 if key == "keywords" else 5 if key == "specified_sites" else 20
            snapshot[key] = clean_list(values, limit)
        else:
            snapshot[key] = []
    return snapshot


def build_final_query(snapshot: dict[str, object]) -> str:
    question = clean_text(snapshot.get("question"), 500)
    clauses = [question] if question else []
    keywords = [clean_text(item, 200) for item in snapshot.get("keywords", []) if clean_text(item, 200)]
    focus = [clean_text(item, 200) for item in snapshot.get("focus_objects", []) if clean_text(item, 200)]
    if keywords:
        clauses.append("关键词：" + "、".join(keywords))
    if focus:
        clauses.append("关注对象：" + "、".join(focus))
    return " ".join(item for item in clauses if item).strip()[:1_000]


def build_analysis_messages(
    snapshot: dict[str, object],
    sources: list[dict[str, object]],
    search_answer: str = "",
    search_followups: list[str] | None = None,
) -> list[dict[str, str]]:
    report_type = REPORT_TYPE_LABELS.get(str(snapshot.get("report_type")), "行业动态")
    depth = DEPTH_LABELS.get(str(snapshot.get("analysis_depth")), "标准")
    extra = clean_text(snapshot.get("extra_requirements"), 2_000)
    perspective = PERSPECTIVE_LABELS.get(str(snapshot.get("analysis_perspective")), "行业研究视角")
    source_preference = SOURCE_PREFERENCE_LABELS.get(str(snapshot.get("source_preference")), "综合平衡")
    question = clean_text(snapshot.get("question"), 1_000)
    description = clean_text(snapshot.get("description"), 2_000)
    keywords = clean_list(snapshot.get("keywords"), 20)
    focus = clean_list(snapshot.get("focus_objects"), 20)
    source_items = [
        {
            "id": str(item.get("id") or ""),
            "title": str(item.get("title") or ""),
            "site_name": str(item.get("site_name") or ""),
            "date": str(item.get("date") or ""),
            "snippet": str(item.get("snippet") or ""),
            "url": str(item.get("url") or ""),
        }
        for item in sources
        if isinstance(item, dict) and item.get("id")
    ]
    system = (
        "你是证券行业情报分析师。只能依据用户提供的来源内容分析，不得编造事实、不得生成任何新链接。"
        "只输出严格 JSON，不要输出 Markdown、HTML 或代码围栏。"
        "字段必须为：title, core_conclusion, key_dynamics, focus_sections, impact_analysis, "
        "opportunities, risks, watch_items, recommended_followups。"
        "key_dynamics 是数组，每项包含 title、institutions（字符串数组）、information_time、summary、"
        "impact_analysis、event_tags（字符串数组）、source_ids（字符串数组）。"
        "source_ids 只能使用给定来源的 id，不得使用来源之外的编号或 URL。"
        "focus_sections 是数组，每项包含 title 和 items（字符串数组）。"
    )
    user = (
        f"业务问题：{question or '未提供'}\n"
        f"业务背景：{description or '未提供'}\n"
        f"检索关键词：{'、'.join(keywords) or '未提供'}\n"
        f"关注对象：{'、'.join(focus) or '未提供'}\n"
        f"分析视角：{perspective}\n"
        f"来源偏好：{source_preference}\n"
        f"报告类型：{report_type}\n"
        f"分析深度：{depth}\n"
        f"额外要求：{extra or '无'}\n"
        f"百度检索摘要：{clean_text(search_answer, 4_000) or '未提供'}\n"
        f"百度推荐追问：{'、'.join(clean_list(search_followups or [], 20)) or '未提供'}\n"
        f"必须按报告类型补充重点章节：{'、'.join(REPORT_FOCUS_LABELS.get(str(snapshot.get('report_type')), []))}\n"
        f"可用来源（共 {len(source_items)} 条）：\n{json.dumps(source_items, ensure_ascii=False)}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


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


def _fallback_report(
    snapshot: dict[str, object],
    answer: str,
    sources: list[dict[str, object]],
    executed_at: str,
    request_id: str | None = None,
) -> dict[str, object]:
    return {
        "title": f"{REPORT_TYPE_LABELS.get(str(snapshot.get('report_type')), '行业动态')}：{clean_text(snapshot.get('question'), 160)}",
        "question": clean_text(snapshot.get("question"), 1_000),
        "executed_at": executed_at,
        "time_range": str(snapshot.get("time_range") or "month"),
        "valid_source_count": len(sources),
        "report_type": str(snapshot.get("report_type") or "industry_trends"),
        "service": "baidu_web_search+llm",
        "search_service": "baidu_web_search",
        "analysis_service": "openai_compatible_llm",
        "request_id": request_id or "",
        "is_fallback": True,
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
    request_id: str | None = None,
) -> dict[str, object]:
    def fallback() -> dict[str, object]:
        report = _fallback_report(snapshot, answer, sources, executed_at, request_id)
        report["recommended_followups"] = clean_list(followups, 20)
        return report

    raw = _extract_json_object(answer)
    if raw is None:
        return fallback()
    raw = dict(raw)
    raw["question"] = snapshot.get("question", "")
    raw["executed_at"] = executed_at
    raw["time_range"] = snapshot.get("time_range", "month")
    raw["valid_source_count"] = len(sources)
    raw["report_type"] = snapshot.get("report_type", "industry_trends")
    raw["service"] = "baidu_web_search+llm"
    raw["search_service"] = "baidu_web_search"
    raw["analysis_service"] = "openai_compatible_llm"
    raw["request_id"] = request_id or ""
    raw["is_fallback"] = False
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
    if not raw["title"] or not raw["core_conclusion"]:
        return fallback()
    try:
        report = IntelligenceReport.model_validate(raw)
    except ValidationError:
        return fallback()
    result = report.model_dump(mode="json")
    result["valid_source_count"] = len(sources)
    if invalid_reference_ids:
        result["reference_warnings"] = [f"未找到引用来源：{source_id}" for source_id in invalid_reference_ids]
    return result


def _error_message(exc: Exception) -> str:
    if isinstance(exc, QianfanError):
        return qianfan_error_message(exc)
    return "情报执行失败，请稍后重试。"


def _analysis_error_message(exc: Exception) -> str:
    text = f"{exc.__class__.__name__} {exc}".casefold()
    if "timeout" in text:
        return "LLM 分析请求超时，请重新分析。"
    if "apiconnectionerror" in text or "connection error" in text or "connectionerror" in text:
        return "LLM 服务连接失败，请检查服务网络或配置。"
    if "unable to parse json" in text:
        return "LLM 分析结果解析失败，请重新分析。"
    if "api_key" in text or "配置文件" in text or "llm 配置" in text:
        return "LLM 分析服务未配置或密钥缺失，请联系管理员。"
    return "LLM 分析失败，请重新分析。"


def _request_analysis(
    snapshot: dict[str, object],
    sources: list[dict[str, object]],
    aliases: dict[str, str],
    search_request_id: str | None,
    search_answer: str = "",
    search_followups: list[str] | None = None,
) -> dict[str, object]:
    client = _load_analysis_client()
    messages = build_analysis_messages(snapshot, sources, search_answer, search_followups)
    config = client.config
    request_kwargs: dict[str, Any] = {
        "model": config.model,
        "messages": messages,
        "temperature": config.temperature,
        "top_p": config.top_p,
        "max_tokens": config.max_tokens,
        "frequency_penalty": config.frequency_penalty,
        "presence_penalty": config.presence_penalty,
    }
    if config.use_json_object:
        request_kwargs["response_format"] = {"type": "json_object"}
    raw = client._request_json(request_kwargs)
    answer = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
    return normalize_report(
        answer,
        snapshot,
        sources,
        aliases,
        search_followups or [],
        datetime.now(timezone.utc).isoformat(),
        request_id=search_request_id,
    )


def _run_analysis(
    execution_id: int,
    sources: list[dict[str, object]],
    aliases: dict[str, str],
    search_request_id: str | None,
) -> None:
    try:
        execution = store.get_execution_by_id(execution_id)
        snapshot = normalize_snapshot(execution.get("snapshot") if isinstance(execution.get("snapshot"), dict) else {})
        search_answer = clean_text(execution.get("search_answer"), 8_000)
        search_followups = clean_list(execution.get("search_followups"), 20)
        report = _request_analysis(
            snapshot,
            sources,
            aliases,
            search_request_id,
            search_answer,
            search_followups,
        )
        store.update_execution(
            execution_id,
            status="succeeded",
            analysis_status="succeeded",
            analysis_error_message=None,
            error_message=None,
            completed_at=datetime.now(timezone.utc).isoformat(),
            report_json=json.dumps(report, ensure_ascii=False),
        )
    except Exception as exc:
        message = _analysis_error_message(exc)
        snapshot = normalize_snapshot({})
        try:
            execution = store.get_execution_by_id(execution_id)
            stored_snapshot = execution.get("snapshot") if isinstance(execution.get("snapshot"), dict) else {}
            snapshot = normalize_snapshot(stored_snapshot)
        except IntelligenceStoreError:
            pass
        fallback = _fallback_report(
            snapshot,
            "百度网页检索已完成，但 LLM 结构化分析失败。可以查看原始检索结果，或点击“重新分析”。",
            sources,
            datetime.now(timezone.utc).isoformat(),
            search_request_id,
        )
        try:
            store.update_execution(
                execution_id,
                status="failed",
                analysis_status="failed",
                analysis_error_message=message,
                error_message=f"搜索成功，但分析失败：{message}",
                completed_at=datetime.now(timezone.utc).isoformat(),
                report_json=json.dumps(fallback, ensure_ascii=False),
            )
        except IntelligenceStoreError:
            pass


def _run_execution(execution_id: int) -> None:
    try:
        execution = store.get_execution_by_id(execution_id)
        started = datetime.now(timezone.utc).isoformat()
        store.update_execution(
            execution_id,
            status="running",
            search_status="running",
            analysis_status="pending",
            started_at=started,
        )
        snapshot = normalize_snapshot(execution.get("snapshot") if isinstance(execution.get("snapshot"), dict) else {})
        final_query = build_final_query(snapshot)
        top_k = TOP_K_BY_DEPTH.get(str(snapshot.get("analysis_depth")), 8)
        request_payload = build_search_payload(
            final_query,
            time_range=str(snapshot.get("time_range") or "month"),
            top_k=top_k,
            specified_sites=[str(item) for item in snapshot.get("specified_sites", [])],
        )
        store.update_execution(
            execution_id,
            final_query=final_query,
            request_payload_json=json.dumps(request_payload, ensure_ascii=False),
        )
        result = client.search(request_payload)
        sources, aliases = normalize_sources(result)
        search_answer = clean_text(result.answer, 8_000)
        search_followups = clean_list(result.followups, 20)
        if not sources:
            store.update_execution(
                execution_id,
                status="empty",
                search_status="succeeded",
                analysis_status="not_run",
                search_error_message=None,
                error_message="未返回有效网页来源",
                completed_at=datetime.now(timezone.utc).isoformat(),
                sources_json=json.dumps([], ensure_ascii=False),
                reference_aliases_json=json.dumps({}, ensure_ascii=False),
                search_answer=search_answer,
                search_followups_json=json.dumps(search_followups, ensure_ascii=False),
                request_id=result.request_id,
            )
            return
        store.update_execution(
            execution_id,
            search_status="succeeded",
            analysis_status="running",
            search_error_message=None,
            error_message=None,
            sources_json=json.dumps(sources, ensure_ascii=False),
            reference_aliases_json=json.dumps(aliases, ensure_ascii=False),
            search_answer=search_answer,
            search_followups_json=json.dumps(search_followups, ensure_ascii=False),
            request_id=result.request_id,
        )
        _run_analysis(execution_id, sources, aliases, result.request_id)
    except Exception as exc:
        try:
            request_id = getattr(exc, "request_id", None)
            store.update_execution(
                execution_id,
                status="failed",
                search_status="failed",
                analysis_status="not_run",
                search_error_message=_error_message(exc),
                error_message=_error_message(exc),
                completed_at=datetime.now(timezone.utc).isoformat(),
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


def reanalyze_execution(owner_user_id: int, execution_id: int) -> dict[str, object]:
    initialize_service()
    execution = store.get_execution(owner_user_id, execution_id)
    if execution.get("search_status") != "succeeded" or not execution.get("sources"):
        raise IntelligenceNotFoundError("execution has no search results to reanalyze")
    active = next(
        (
            item
            for item in store.list_executions(owner_user_id, 1, 100)[0]
            if item.get("id") != execution_id
            and item.get("status") in {"pending", "running"}
        ),
        None,
    )
    if active is not None:
        raise ActiveExecutionError("an intelligence execution is already active")
    sources = [item for item in execution.get("sources", []) if isinstance(item, dict)]
    aliases = execution.get("reference_aliases") if isinstance(execution.get("reference_aliases"), dict) else {}
    search_request_id = str(execution.get("request_id") or "") or None
    updated = store.update_execution(
        execution_id,
        status="running",
        analysis_status="running",
        analysis_error_message=None,
        error_message=None,
    )
    assert _executor is not None
    try:
        _executor.submit(_run_analysis, execution_id, sources, aliases, search_request_id)
    except Exception:
        store.update_execution(
            execution_id,
            status="failed",
            analysis_status="failed",
            analysis_error_message="情报分析未能启动，请稍后重试。",
            error_message="情报分析未能启动，请稍后重试。",
            completed_at=datetime.now(timezone.utc).isoformat(),
        )
        raise
    return updated


def suggest_keywords(payload: dict[str, object], max_suggestions: int = 8) -> list[str]:
    # Keyword suggestions only need the configured analysis client; they must not
    # depend on the Baidu web search configuration.
    if not analysis_service_configured():
        raise AnalysisConfigurationError("LLM 分析服务未配置，请先配置 LLM API 后重试")
    question = clean_text(payload.get("question"), 1_000)
    description = clean_text(payload.get("description"), 2_000)
    keywords = clean_list(payload.get("keywords"), 30)
    focus_objects = clean_list(payload.get("focus_objects"), 20)
    perspective = PERSPECTIVE_LABELS.get(str(payload.get("analysis_perspective")), "行业研究视角")
    messages = [
        {
            "role": "system",
            "content": "你是证券行业情报检索助手。只输出 JSON 对象，对象包含 keywords 数组，数组元素为不超过 40 字的检索关键词，不要 Markdown、HTML 或代码围栏。",
        },
        {
            "role": "user",
            "content": (
                f"业务问题：{question}\n"
                f"业务描述：{description}\n"
                f"已有关键词：{'、'.join(keywords)}\n"
                f"关注对象：{'、'.join(focus_objects)}\n"
                f"分析视角：{perspective}\n"
                f"请补充最多 {max(1, min(8, max_suggestions))} 个与业务问题相关、且不同于已有关键词的检索关键词，并放入 keywords 数组。"
            ),
        },
    ]
    analysis_client = _load_analysis_client()
    request_kwargs: dict[str, Any] = {
        "model": analysis_client.config.model,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 1024,
    }
    if analysis_client.config.use_json_object:
        request_kwargs["response_format"] = {"type": "json_object"}
    raw = analysis_client._request_json(request_kwargs)
    parsed: object = raw if isinstance(raw, list) else None
    if parsed is None and isinstance(raw, dict):
        parsed = raw.get("keywords") or raw.get("suggestions") or []
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
    "AnalysisConfigurationError",
    "client",
    "IntelligenceNotFoundError",
    "IntelligenceStoreError",
    "build_final_query",
    "initialize_service",
    "normalize_report",
    "normalize_sources",
    "options_payload",
    "reanalyze_execution",
    "store",
    "submit_execution",
    "suggest_keywords",
]
