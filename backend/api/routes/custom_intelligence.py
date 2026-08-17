from __future__ import annotations

import asyncio
import json
from urllib.parse import quote
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, status
from fastapi.responses import Response as RawResponse, StreamingResponse

from ..audit_store import AuditStoreError, record_event
from ..auth import get_session, require_admin_token, verify_session_password
from ..config import settings
from ..contracts import (
    ConfirmedPlanBody,
    InstantSearchRequest,
    SearchServiceConfigUpdate,
    VerifyPasswordRequest,
)
from ..intelligence_admin_config import (
    AdminPasswordRequest,
    DefaultRulesUpdate,
    DeepSeekConfigUpdate,
    EmailDeliveryRequest,
    IntelligenceTopicCreateCompat,
    IntelligenceTopicUpdateCompat,
    SMTPConfigUpdate,
    public_deepseek_config,
    read_deepseek_key,
    resolve_email_delivery_format,
    save_deepseek_config,
    test_deepseek_configuration,
)
from ..intelligence_email import (
    EmailConfigurationError,
    EmailRecipientError,
    ExternalRecipientConfirmationRequired,
    effective_smtp_config,
    public_smtp_config,
    send_report_email,
    test_smtp_configuration,
    validate_smtp_identity,
    validate_smtp_server,
)
from ..custom_intelligence_service import (
    ActiveExecutionError,
    AnalysisConfigurationError,
    IntelligenceNotFoundError,
    IntelligenceStoreError,
    analysis_service_configured,
    initialize_service,
    options_payload,
    query_plan_preview,
    reanalyze_execution,
    store,
    submit_execution,
)
from ..custom_intelligence_store import EXECUTIONS_RETENTION, TOPICS_PER_USER_LIMIT, TopicLimitError, TopicNameConflictError
from ..intelligence_report_pdf import build_report_pdf, report_pdf_filename
from ..intelligence_report_view import report_research_direction
from ..user_store import UserStoreError, get_user_identities_by_ids
from ..qianfan_search import (
    QianfanConfigurationError,
    QianfanDisabledError,
    QianfanError,
    QianfanTimeoutError,
    QIANFAN_WEB_SEARCH_ENDPOINT,
    effective_search_config,
    qianfan_http_status,
    test_search_configuration,
)
from ..service_url import service_url_port


router = APIRouter()
DEFAULT_ANALYSIS_RULES: dict[str, object] = {"analysis_instructions": ""}


def _owner_user_id(session: dict[str, object]) -> int:
    value = session.get("user_id")
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    # Sessions created before stable administrator IDs were introduced are
    # still safely mapped to the reserved administrator owner ID.
    if session.get("role") == "admin":
        return 0
    raise HTTPException(status_code=401, detail="session user identity is unavailable")


def _admin_actor_id(authorization: str | None) -> int:
    try:
        session = get_session(authorization)
    except HTTPException:
        return 0
    value = session.get("user_id")
    return int(value) if isinstance(value, int) and not isinstance(value, bool) else 0


def _audit_intelligence_event(
    authorization: str | None,
    event_type: str,
    *,
    action: str,
    target: str,
    result: str = "success",
    metadata: dict[str, object] | None = None,
) -> None:
    """Write a credential-free audit event without breaking the primary action."""
    try:
        session = get_session(authorization)
        event_metadata: dict[str, object] = {
            "action": action,
            "target": target,
            "result": result,
        }
        if metadata:
            event_metadata.update(metadata)
        record_event(
            event_type=event_type,
            user_id=_admin_actor_id(authorization),
            username=str(session.get("username") or ""),
            role=str(session.get("role") or ""),
            source="custom_intelligence",
            metadata=event_metadata,
        )
    except (AuditStoreError, HTTPException, TypeError, ValueError):
        pass


def _public_assistant_fields(value: dict[str, object]) -> dict[str, object]:
    allowed_audiences = {
        "management",
        "wealth_management",
        "investment_banking",
        "institutional_business",
        "asset_management",
        "proprietary_investment",
        "research_business",
        "fintech_operations",
        "compliance_risk",
        "custom",
    }
    audience_aliases = {
        "product_business": "wealth_management",
        "business_product": "wealth_management",
        "technology": "fintech_operations",
        "industry_research": "research_business",
        "管理层": "management",
        "业务/产品": "wealth_management",
        "业务 / 产品": "wealth_management",
        "技术": "fintech_operations",
        "合规风控": "compliance_risk",
        "行业研究": "research_business",
    }
    raw_audience = str(value.get("audience") or value.get("analysis_perspective") or "research_business").strip()
    audience = audience_aliases.get(raw_audience, raw_audience)
    if audience not in allowed_audiences:
        audience = "research_business"

    raw_tags = value.get("focus_tags") or value.get("keywords") or []
    focus_tags: list[str] = []
    if isinstance(raw_tags, list):
        for item in raw_tags:
            tag = str(item).strip()[:80]
            if tag and tag not in focus_tags:
                focus_tags.append(tag)
            if len(focus_tags) >= 8:
                break
    focus_objects = value.get("focus_objects")
    legacy_focus = "、".join(str(item).strip() for item in focus_objects if str(item).strip()) if isinstance(focus_objects, list) else ""
    focus = str(value.get("focus") or value.get("question") or legacy_focus or "").strip()[:1_000]
    try:
        is_legacy = value.get("config_version") is not None and int(value.get("config_version") or 1) < 2
    except (TypeError, ValueError):
        is_legacy = False
    report_length = str(
        value.get("analysis_depth") if is_legacy else value.get("report_length") or value.get("analysis_depth") or "standard"
    ).strip()
    if report_length not in {"concise", "standard", "deep"}:
        report_length = "standard"
    time_range = str(value.get("time_range") or "month").strip()
    if time_range not in {"week", "month", "semiyear", "year"}:
        time_range = "month"
    return {
        "audience": audience,
        "audience_detail": str(value.get("audience_detail") or value.get("description") or "").strip()[:2_000],
        "focus_tags": focus_tags,
        "focus": focus,
        "extra_focus": str(value.get("extra_focus") or value.get("extra_requirements") or "").strip()[:2_000],
        "time_range": time_range,
        "report_length": report_length,
    }


def _public_topic(topic: dict[str, object]) -> dict[str, object]:
    public = {
        "id": topic.get("id"),
        "name": topic.get("name"),
        **_public_assistant_fields(topic),
        "created_at": topic.get("created_at"),
        "updated_at": topic.get("updated_at"),
    }
    latest = topic.get("latest_execution")
    public["latest_execution"] = _public_execution(latest) if isinstance(latest, dict) else None
    return public


def _public_delivery(delivery: dict[str, object]) -> dict[str, object]:
    return {
        key: delivery.get(key)
        for key in (
            "id",
            "execution_id",
            "recipient",
            "format",
            "status",
            "error_message",
            "external_confirmed",
            "created_at",
            "sent_at",
        )
    }


def _public_execution(execution: dict[str, object]) -> dict[str, object]:
    snapshot = execution.get("snapshot") if isinstance(execution.get("snapshot"), dict) else {}
    report = execution.get("report") if isinstance(execution.get("report"), dict) else None
    sources = execution.get("sources")
    public: dict[str, object] = {
        "id": execution.get("id"),
        "topic_id": execution.get("topic_id"),
        "topic_name": execution.get("topic_name"),
        "trigger_type": execution.get("trigger_type"),
        "snapshot": _public_assistant_fields(snapshot),
        "original_query": execution.get("original_query") or snapshot.get("focus") or snapshot.get("question") or "",
        "research_direction": report_research_direction(execution),
        "report": report,
        "report_version": report.get("version") if report else None,
        "sources": sources if isinstance(sources, list) else [],
        "status": execution.get("status"),
        "error_message": execution.get("error_message"),
        "search_status": execution.get("search_status"),
        "analysis_status": execution.get("analysis_status"),
        "search_error_message": execution.get("search_error_message"),
        "analysis_error_message": execution.get("analysis_error_message"),
        "created_at": execution.get("created_at"),
        "started_at": execution.get("started_at"),
        "completed_at": execution.get("completed_at"),
    }
    if isinstance(sources, list):
        public["sources"] = [
            {key: value for key, value in item.items() if key != "provider_reference_ids"}
            for item in sources
            if isinstance(item, dict)
        ]
    return public


def _admin_owner_payload(owner_user_id: int, identities: dict[int, dict[str, str]]) -> dict[str, object]:
    if owner_user_id == 0:
        return {
            "owner_name": settings.admin_username,
            "owner_username": settings.admin_username,
        }
    identity = identities.get(owner_user_id, {})
    return {
        "owner_name": identity.get("name") or identity.get("username") or "已删除账户",
        "owner_username": identity.get("username") or "",
    }


def _admin_execution_summary(
    execution: dict[str, object],
    identities: dict[int, dict[str, str]] | None = None,
) -> dict[str, object]:
    sources = execution.get("sources") if isinstance(execution.get("sources"), list) else []
    domains: set[str] = set()
    dates: set[str] = set()
    source_rows: list[dict[str, object]] = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        site = str(source.get("site_name") or source.get("domain") or "").strip()
        if site:
            domains.add(site.casefold())
        date = str(source.get("date") or "").strip()
        if date:
            dates.add(date[:10])
        source_rows.append(
            {
                key: source.get(key)
                for key in ("id", "title", "url", "site_name", "date")
                if source.get(key) is not None
            }
        )
    owner_user_id = int(execution.get("owner_user_id") or 0)
    return {
        "id": execution.get("id"),
        "owner_user_id": owner_user_id,
        **_admin_owner_payload(owner_user_id, identities or {}),
        "topic_id": execution.get("topic_id"),
        "topic_name": execution.get("topic_name"),
        "trigger_type": execution.get("trigger_type"),
        "status": execution.get("status"),
        "planning_status": execution.get("planning_status"),
        "planning_error_message": execution.get("planning_error_message"),
        "search_status": execution.get("search_status"),
        "analysis_status": execution.get("analysis_status"),
        "error_message": execution.get("error_message"),
        "search_error_message": execution.get("search_error_message"),
        "analysis_error_message": execution.get("analysis_error_message"),
        "request_id": execution.get("request_id"),
        "created_at": execution.get("created_at"),
        "started_at": execution.get("started_at"),
        "completed_at": execution.get("completed_at"),
        "source_count": len(source_rows),
        "domain_count": len(domains),
        "time_count": len(dates),
    }


def _admin_execution_diagnostics(execution: dict[str, object]) -> dict[str, object]:
    summary = _admin_execution_summary(execution)
    payload = execution.get("request_payload") if isinstance(execution.get("request_payload"), dict) else {}
    search_summary = payload.get("search_summary") if isinstance(payload.get("search_summary"), dict) else {}
    rounds = payload.get("search_rounds") if isinstance(payload.get("search_rounds"), list) else []
    safe_rounds: list[dict[str, object]] = []
    for item in rounds:
        if not isinstance(item, dict):
            continue
        row: dict[str, object] = {}
        for key in (
            "round",
            "round_type",
            "query",
            "purpose",
            "status",
            "requested_top_k",
            "raw_reference_count",
            "raw_reference_total",
            "deduplicated_count",
            "duplicate_removed_count",
            "stale_removed_count",
            "domain_removed_count",
            "limit_removed_count",
            "selected_count",
            "new_source_count",
            "new_domain_count",
            "cumulative_source_count",
            "request_id",
            "error",
        ):
            if item.get(key) is not None:
                value = item[key]
                row[key] = str(value)[:500] if key in {"query", "purpose", "error", "request_id"} else value
        safe_rounds.append(row)

    plan = payload.get("query_plan") if isinstance(payload.get("query_plan"), dict) else {}
    raw_queries = plan.get("queries") if isinstance(plan.get("queries"), list) else []
    planner_queries = [
        {
            "query": str(item.get("query") or "")[:300],
            "purpose": str(item.get("purpose") or "")[:200],
        }
        for item in raw_queries
        if isinstance(item, dict) and str(item.get("query") or "").strip()
    ]
    report_sources = summary.pop("source_count", 0)
    source_rows = []
    for source in execution.get("sources") if isinstance(execution.get("sources"), list) else []:
        if isinstance(source, dict):
            source_rows.append(
                {
                    key: source.get(key)
                    for key in ("id", "title", "url", "site_name", "date")
                    if source.get(key) is not None
                }
            )
    request_ids = list(
        dict.fromkeys(
            str(value)
            for value in [execution.get("request_id"), *(item.get("request_id") for item in safe_rounds)]
            if value
        )
    )
    started_at = execution.get("started_at")
    completed_at = execution.get("completed_at")
    duration_seconds: float | None = None
    if isinstance(started_at, str) and isinstance(completed_at, str):
        try:
            duration_seconds = max(
                0.0,
                round((datetime.fromisoformat(completed_at) - datetime.fromisoformat(started_at)).total_seconds(), 1),
            )
        except ValueError:
            duration_seconds = None
    if execution.get("status") in {"succeeded", "failed", "empty"}:
        stage = "completed"
    elif execution.get("analysis_status") == "running":
        stage = "analysis"
    elif execution.get("search_status") == "running":
        stage = "search"
    else:
        stage = "planning"
    return {
        **summary,
        "execution_id": execution.get("id"),
        "source_count": report_sources,
        "stage": stage,
        "message": execution.get("error_message") or "执行信息已更新",
        "duration_seconds": duration_seconds,
        "planner": {
            "status": execution.get("planning_status") or "not_run",
            "error_message": execution.get("planning_error_message"),
            "intent": str(plan.get("intent") or search_summary.get("planner_intent") or "")[:300],
            "queries": planner_queries[:50],
        },
        "search": {
            "rounds": safe_rounds,
            "per_query": [
                {
                    key: item.get(key)
                    for key in (
                        "round",
                        "query",
                        "purpose",
                        "status",
                        "raw_reference_count",
                        "selected_count",
                        "request_id",
                        "error",
                    )
                    if item.get(key) is not None
                }
                for item in safe_rounds
            ],
        },
        "counts": {
            "final_source_count": report_sources,
            "final_domain_count": summary.get("domain_count", 0),
            "final_time_count": summary.get("time_count", 0),
            "raw_reference_count": int(search_summary.get("raw_reference_count") or 0),
            "deduplicated_count": int(search_summary.get("deduplicated_count") or report_sources),
            "duplicate_removed_count": int(search_summary.get("duplicate_removed_count") or 0),
            "stale_removed_count": int(search_summary.get("stale_removed_count") or 0),
            "domain_removed_count": int(search_summary.get("domain_removed_count") or 0),
            "limit_removed_count": int(search_summary.get("limit_removed_count") or 0),
            "selected_count": int(search_summary.get("selected_count") or report_sources),
            "round_count": len(safe_rounds),
            "supplemental_query_count": int(search_summary.get("supplemental_query_count") or 0),
        },
        "final_sources": source_rows[:100],
        "request_ids": request_ids,
        "stage_errors": {
            key: execution.get(key)
            for key in ("error_message", "search_error_message", "analysis_error_message", "planning_error_message")
            if execution.get(key)
        },
        "delivery_logs": store.list_delivery_logs(int(execution["id"])),
    }


def _mask_api_key(value: str) -> str:
    if not value:
        return ""
    prefix = "bce-v3/" if value.startswith("bce-v3/") else ""
    return f"{prefix}••••••••••••••••"


def _admin_search_config_payload() -> dict[str, object]:
    config = effective_search_config()
    analysis_configured = analysis_service_configured()
    try:
        last_test = store.get_search_test()
    except Exception:
        last_test = None
    return {
        "enabled": config.enabled,
        "endpoint": config.endpoint,
        "port": service_url_port(config.endpoint),
        "auth_header": config.auth_header,
        "timeout_seconds": config.timeout_seconds,
        "api_key_mask": _mask_api_key(config.api_key),
        "has_api_key": bool(config.api_key),
        "config_source": config.config_source,
        "last_test": last_test,
        "analysis_configured": analysis_configured,
        "analysis_service_status": "configured" if analysis_configured else "not_configured",
    }


def _test_error_message(exc: Exception) -> str:
    if isinstance(exc, QianfanDisabledError):
        return "搜索服务已停用。"
    if isinstance(exc, QianfanConfigurationError):
        return "搜索服务未配置，请先在后端环境配置有效的 API Key。"
    if isinstance(exc, QianfanTimeoutError):
        return "网络超时，请检查 Endpoint、网络连接或增加超时时间。"
    if isinstance(exc, QianfanError):
        code = (exc.error_code or "").casefold()
        if exc.status_code in {401, 403} or code in {"unauthorized", "forbidden", "permission_denied"}:
            return "鉴权失败，请检查 API Key 权限和鉴权头。"
        if code == "invalidappid" or "no permission to use the appid" in str(exc).casefold():
            return "API Key 未授权当前搜索服务，请在千帆控制台检查 Key 权限和应用绑定。"
        if exc.status_code in {400, 404} or "model" in code or "modelnotfound" in code:
            return "搜索接口不可用或参数错误，请检查服务权限与请求参数。"
        if exc.status_code == 429 or code in {"overratelimit", "ratelimit", "too_many_requests"}:
            return "额度不足或限流，请稍后重试。"
        return "上游服务异常，请稍后重试。"
    return "连接测试失败，请检查服务状态后重试。"


def _handle_store_error(exc: Exception, fallback: str = "自定义情报服务暂不可用") -> HTTPException:
    if isinstance(exc, IntelligenceNotFoundError):
        return HTTPException(status_code=404, detail="情报记录不存在")
    if isinstance(exc, ActiveExecutionError):
        return HTTPException(status_code=409, detail="当前已有情报执行正在进行，请稍后再试")
    if isinstance(exc, TopicLimitError):
        return HTTPException(
            status_code=409,
            detail=f"已保存配置数量已达上限（{TOPICS_PER_USER_LIMIT} 个），请先删除或修改已有配置",
        )
    if isinstance(exc, TopicNameConflictError):
        return HTTPException(status_code=409, detail="同名已保存配置已存在")
    if isinstance(exc, QianfanDisabledError):
        return HTTPException(status_code=409, detail="情报检索服务已停用")
    if isinstance(exc, QianfanConfigurationError):
        return HTTPException(status_code=503, detail="情报检索服务尚未配置")
    if isinstance(exc, QianfanTimeoutError):
        return HTTPException(status_code=504, detail="情报检索请求超时，请稍后重试")
    if isinstance(exc, QianfanError):
        return HTTPException(status_code=qianfan_http_status(exc), detail="情报检索服务暂不可用，请稍后重试")
    if isinstance(exc, AnalysisConfigurationError):
        return HTTPException(status_code=503, detail="AI 规划与分析服务尚未配置")
    if isinstance(exc, IntelligenceStoreError):
        return HTTPException(status_code=500, detail=fallback)
    return HTTPException(status_code=500, detail=fallback)


@router.get("/api/custom-intelligence/options")
def get_custom_intelligence_options(
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    get_session(authorization)
    try:
        initialize_service()
        return options_payload()
    except Exception as exc:
        raise _handle_store_error(exc) from exc


@router.post("/api/custom-intelligence/query-plan")
def post_custom_intelligence_query_plan(
    payload: InstantSearchRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    """Preview DeepSeek's natural-language research directions.

    This endpoint deliberately does not initialize the intelligence store or
    create an execution.  It only validates the session and invokes the
    bounded planner; planner failures return a focus-only degraded preview so
    the user can still explicitly confirm before any Baidu request starts.
    """
    get_session(authorization)
    return query_plan_preview(payload.model_dump(exclude_none=True))


@router.get("/api/custom-intelligence/topics")
def get_topics(
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    try:
        topics = store.list_topics(_owner_user_id(session))
    except Exception as exc:
        raise _handle_store_error(exc, "无法加载情报主题") from exc
    return {"topics": [_public_topic(topic) for topic in topics]}


@router.post("/api/custom-intelligence/topics", status_code=status.HTTP_201_CREATED)
def post_topic(
    payload: IntelligenceTopicCreateCompat,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    try:
        topic = store.create_topic(owner_id, payload.model_dump(), owner_id)
    except Exception as exc:
        raise _handle_store_error(exc, "无法创建情报主题") from exc
    return {"topic": _public_topic(topic)}


@router.get("/api/custom-intelligence/topics/{topic_id}")
def get_topic(
    topic_id: int,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    try:
        topic = store.get_topic(_owner_user_id(session), topic_id)
    except Exception as exc:
        raise _handle_store_error(exc, "无法加载情报主题") from exc
    return {"topic": _public_topic(topic)}


@router.post("/api/custom-intelligence/topics/{topic_id}")
def post_topic_update(
    topic_id: int,
    payload: IntelligenceTopicUpdateCompat,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    try:
        topic = store.update_topic(owner_id, topic_id, payload.model_dump(), owner_id)
    except Exception as exc:
        raise _handle_store_error(exc, "无法更新情报主题") from exc
    return {"topic": _public_topic(topic)}


@router.delete("/api/custom-intelligence/topics/{topic_id}")
def delete_topic(
    topic_id: int,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    try:
        store.delete_topic(owner_id, topic_id)
    except Exception as exc:
        raise _handle_store_error(exc, "无法删除已保存配置") from exc
    return {"deleted": True, "id": topic_id}


@router.post("/api/custom-intelligence/topics/{topic_id}/execute", status_code=status.HTTP_202_ACCEPTED)
def post_topic_execute(
    topic_id: int,
    body: ConfirmedPlanBody | None = Body(default=None),
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    try:
        topic = store.get_topic(owner_id, topic_id)
        snapshot = {"name": topic.get("name"), **_public_assistant_fields(topic)}
        saved_question = str(topic.get("question") or "").strip()
        snapshot["question"] = saved_question or str(topic.get("focus") or "").strip() or f"请分析情报主题：{str(topic.get('name') or '证券行业近期动态')}"
        if body is not None and body.confirmed_plan is not None:
            snapshot["confirmed_plan"] = body.confirmed_plan.model_dump()
        execution = submit_execution(
            owner_id,
            snapshot,
            owner_id,
            trigger_type="topic",
            topic_id=topic_id,
            topic_name=str(topic.get("name") or ""),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _handle_store_error(exc, "无法启动情报主题执行") from exc
    return {"execution": _public_execution(execution)}


@router.get("/api/custom-intelligence/executions")
def get_executions(
    authorization: Annotated[str | None, Header()] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> dict[str, object]:
    session = get_session(authorization)
    try:
        executions, meta = store.list_executions(_owner_user_id(session), page, page_size)
    except Exception as exc:
        raise _handle_store_error(exc, "无法加载情报执行记录") from exc
    return {"executions": [_public_execution(execution) for execution in executions], "meta": meta}


@router.post("/api/custom-intelligence/executions", status_code=status.HTTP_202_ACCEPTED)
def post_instant_execution(
    payload: InstantSearchRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    try:
        execution = submit_execution(
            owner_id,
            payload.model_dump(),
            owner_id,
            trigger_type="instant",
        )
    except Exception as exc:
        raise _handle_store_error(exc, "无法启动即时情报搜索") from exc
    return {"execution": _public_execution(execution)}


@router.get("/api/custom-intelligence/executions/{execution_id}")
def get_execution(
    execution_id: int,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    try:
        execution = store.get_execution(_owner_user_id(session), execution_id)
    except Exception as exc:
        raise _handle_store_error(exc, "无法加载情报执行记录") from exc
    return {"execution": _public_execution(execution)}


@router.get("/api/custom-intelligence/executions/{execution_id}/events")
async def get_execution_events(
    execution_id: int,
    authorization: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    """Stream public execution snapshots, ending after the execution is terminal."""
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    try:
        initial = store.get_execution(owner_id, execution_id)
    except Exception as exc:
        raise _handle_store_error(exc, "无法加载情报执行记录") from exc

    def format_event(execution: dict[str, object]) -> tuple[str, str]:
        payload = {"type": "execution", "execution": _public_execution(execution)}
        serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        return serialized, f"data: {serialized}\n\n"

    async def event_stream():
        # Encourage reverse proxies and browsers to deliver the first event
        # immediately instead of buffering a small streaming response.
        yield ":" + " " * 2048 + "\n\n"
        serialized, event = format_event(initial)
        yield event
        if str(initial.get("status") or "") not in {"pending", "running"}:
            return

        last_serialized = serialized
        while True:
            await asyncio.sleep(1)
            try:
                execution = await asyncio.to_thread(store.get_execution, owner_id, execution_id)
            except IntelligenceNotFoundError:
                return
            serialized, event = format_event(execution)
            if serialized != last_serialized:
                last_serialized = serialized
                yield event
            else:
                yield ": ping\n\n"
            if str(execution.get("status") or "") not in {"pending", "running"}:
                return

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/custom-intelligence/executions/{execution_id}/rerun", status_code=status.HTTP_202_ACCEPTED)
def post_execution_rerun(
    execution_id: int,
    body: ConfirmedPlanBody | None = Body(default=None),
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    try:
        previous = store.get_execution(owner_id, execution_id)
        snapshot = previous.get("snapshot") if isinstance(previous.get("snapshot"), dict) else {}
        snapshot = dict(snapshot)
        if body is not None and body.confirmed_plan is not None:
            snapshot["confirmed_plan"] = body.confirmed_plan.model_dump()
        execution = submit_execution(
            owner_id,
            dict(snapshot),
            owner_id,
            trigger_type="rerun",
            topic_id=int(previous["topic_id"]) if isinstance(previous.get("topic_id"), int) else None,
            topic_name=str(previous.get("topic_name") or ""),
        )
    except Exception as exc:
        raise _handle_store_error(exc, "无法重新执行情报记录") from exc
    return {"execution": _public_execution(execution)}


@router.post(
    "/api/custom-intelligence/executions/{execution_id}/reanalyze",
    status_code=status.HTTP_202_ACCEPTED,
)
def post_execution_reanalyze(
    execution_id: int,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    try:
        execution = reanalyze_execution(owner_id, execution_id)
    except Exception as exc:
        raise _handle_store_error(exc, "无法重新分析情报记录") from exc
    return {"execution": _public_execution(execution)}


@router.post("/api/custom-intelligence/executions/{execution_id}/email")
def post_execution_email(
    execution_id: int,
    payload: EmailDeliveryRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    delivery_format = resolve_email_delivery_format(payload)
    try:
        execution = store.get_execution(owner_id, execution_id)
        results = send_report_email(
            execution,
            payload.recipients,
            note=payload.note,
            template_style=payload.template_style,
            delivery_format=delivery_format,
            external_confirmed=payload.external_confirmed,
            config=effective_smtp_config(store),
        )
    except ExternalRecipientConfirmationRequired as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except EmailRecipientError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except EmailConfigurationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise _handle_store_error(exc, "报告邮件发送失败") from exc

    sent_at = datetime.now(timezone.utc).isoformat()
    delivery_rows: list[dict[str, object]] = []
    for result in results:
        status_value = str(result.get("status") or "failed")
        delivery_rows.append(
            store.create_delivery_log(
                execution_id=execution_id,
                owner_user_id=owner_id,
                recipient=str(result.get("recipient") or ""),
                format=delivery_format,
                status=status_value,
                message_id=str(result.get("message_id") or "") or None,
                error_message=str(result.get("error_message") or "") or None,
                external_confirmed=payload.external_confirmed,
                sent_at=sent_at if status_value == "sent" else None,
            )
        )
    sent_count = sum(1 for item in delivery_rows if item.get("status") == "sent")
    _audit_intelligence_event(
        authorization,
        "custom_intelligence_email_sent",
        action="send",
        target="report_email",
        result="success" if sent_count == len(delivery_rows) else "partial_failed",
        metadata={
            "execution_id": execution_id,
            "format": delivery_format,
            "template_style": payload.template_style,
            "recipient_count": len(delivery_rows),
            "sent_count": sent_count,
            "external_confirmed": payload.external_confirmed,
        },
    )
    return {
        "status": "success" if sent_count == len(delivery_rows) else "partial_failed",
        "deliveries": [_public_delivery(item) for item in delivery_rows],
    }


@router.get("/api/custom-intelligence/executions/{execution_id}/report/pdf")
def get_execution_report_pdf(
    execution_id: int,
    template_style: Literal["research", "newsletter"] = Query("research"),
    authorization: Annotated[str | None, Header()] = None,
) -> RawResponse:
    session = get_session(authorization)
    try:
        execution = store.get_execution(_owner_user_id(session), execution_id)
    except Exception as exc:
        raise _handle_store_error(exc, "无法加载情报记录") from exc
    if (
        execution.get("status") != "succeeded"
        or execution.get("analysis_status") != "succeeded"
        or execution.get("search_status") != "succeeded"
        or not execution.get("sources")
        or not isinstance(execution.get("report"), dict)
        or execution["report"].get("version") != 2
    ):
        raise HTTPException(status_code=409, detail="该记录没有可导出的搜索结果")
    try:
        pdf_bytes = build_report_pdf(execution, template_style=template_style)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="报告 PDF 生成失败，请稍后重试") from exc
    filename = report_pdf_filename(execution)
    disposition = f"attachment; filename*=UTF-8''{quote(filename.encode('utf-8'))}"
    return RawResponse(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": disposition},
    )


# Keep direct imports used by existing service-level callers while the
# administrator endpoints live on the dedicated admin router.
from .custom_intelligence_admin import (  # noqa: E402  (intentional cycle-safe compatibility export)
    get_admin_default_rules,
    get_admin_execution,
    get_admin_execution_diagnostics,
    get_admin_executions,
    get_admin_llm_config,
    get_admin_search_config,
    get_admin_smtp_config,
    post_admin_default_rules,
    post_admin_llm_config,
    post_admin_llm_config_reveal_key,
    post_admin_llm_config_test,
    post_admin_search_config,
    post_admin_search_config_reveal_key,
    post_admin_search_config_test,
    post_admin_smtp_config,
    post_admin_smtp_config_reveal_authorization_code,
    post_admin_smtp_config_test,
)
