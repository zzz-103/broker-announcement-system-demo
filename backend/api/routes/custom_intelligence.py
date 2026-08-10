from __future__ import annotations

import secrets
from urllib.parse import quote
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from fastapi.responses import Response as RawResponse

from ..auth import get_session, require_admin_token
from ..config import settings
from ..contracts import (
    InstantSearchRequest,
    IntelligenceTopicCreate,
    IntelligenceTopicEnabled,
    IntelligenceTopicUpdate,
    KeywordSuggestionRequest,
    SearchServiceConfigUpdate,
    VerifyPasswordRequest,
)
from ..custom_intelligence_service import (
    ActiveExecutionError,
    AnalysisConfigurationError,
    IntelligenceNotFoundError,
    IntelligenceStoreError,
    analysis_service_configured,
    initialize_service,
    options_payload,
    reanalyze_execution,
    store,
    submit_execution,
    suggest_keywords,
)
from ..custom_intelligence_store import TOPICS_PER_USER_LIMIT, TopicLimitError, TopicNameConflictError
from ..intelligence_report_pdf import build_report_pdf, report_pdf_filename
from ..qianfan_search import (
    QianfanConfigurationError,
    QianfanDisabledError,
    QianfanError,
    QianfanTimeoutError,
    QIANFAN_WEB_SEARCH_ENDPOINT,
    effective_search_config,
    qianfan_error_message,
    qianfan_http_status,
    test_search_configuration,
)


router = APIRouter()


def _owner_user_id(session: dict[str, object]) -> int:
    value = session.get("user_id")
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    # Sessions created before stable administrator IDs were introduced are
    # still safely mapped to the reserved administrator owner ID.
    if session.get("role") == "admin":
        return 0
    raise HTTPException(status_code=401, detail="session user identity is unavailable")


def _public_topic(topic: dict[str, object]) -> dict[str, object]:
    public = {
        key: value
        for key, value in topic.items()
        if key not in {"owner_user_id", "created_by_user_id", "updated_by_user_id", "latest_execution"}
    }
    latest = topic.get("latest_execution")
    public["latest_execution"] = _public_execution(latest) if isinstance(latest, dict) else None
    return public


def _public_search_coverage(execution: dict[str, object]) -> dict[str, object] | None:
    payload = execution.get("request_payload")
    if not isinstance(payload, dict):
        return None
    summary = payload.get("search_summary")
    if not isinstance(summary, dict):
        return None

    def count(value: object) -> int:
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return 0

    rounds: list[dict[str, object]] = []
    raw_rounds = payload.get("search_rounds")
    if isinstance(raw_rounds, list):
        for item in raw_rounds:
            if not isinstance(item, dict):
                continue
            rounds.append(
                {
                    "round": count(item.get("round")),
                    "facet": str(item.get("facet") or ""),
                    "status": str(item.get("status") or ""),
                    "raw_reference_count": count(item.get("raw_reference_count")),
                    "new_source_count": count(item.get("new_source_count")),
                    "new_domain_count": count(item.get("new_domain_count")),
                    "cumulative_source_count": count(item.get("cumulative_source_count")),
                    **({"error": str(item["error"])} if item.get("error") else {}),
                }
            )
    return {
        "requested_source_count": count(summary.get("requested_source_count")),
        "unique_source_count": count(summary.get("unique_source_count")),
        "round_count": count(summary.get("round_count")),
        "supplemental_round_count": count(summary.get("supplemental_round_count")),
        "reached_source_target": bool(summary.get("reached_source_target")),
        "rounds": rounds,
    }


def _public_execution(execution: dict[str, object]) -> dict[str, object]:
    search_coverage = _public_search_coverage(execution)
    public = {
        key: value
        for key, value in execution.items()
        if key not in {
            "owner_user_id",
            "created_by_user_id",
            "executed_by_user_id",
            "request_payload",
            "reference_aliases",
        }
    }
    sources = public.get("sources")
    if isinstance(sources, list):
        public["sources"] = [
            {key: value for key, value in item.items() if key != "provider_reference_ids"}
            for item in sources
            if isinstance(item, dict)
        ]
    if search_coverage is not None:
        public["search_coverage"] = search_coverage
    return public


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
        return HTTPException(status_code=409, detail="百度智能搜索服务已停用")
    if isinstance(exc, QianfanConfigurationError):
        return HTTPException(status_code=503, detail="百度智能搜索服务尚未配置")
    if isinstance(exc, QianfanTimeoutError):
        return HTTPException(status_code=504, detail="百度智能搜索请求超时，请稍后重试")
    if isinstance(exc, QianfanError):
        return HTTPException(status_code=qianfan_http_status(exc), detail=qianfan_error_message(exc))
    if isinstance(exc, IntelligenceStoreError):
        return HTTPException(status_code=500, detail=fallback)
    return HTTPException(status_code=500, detail=fallback)


def _suggest_error_message(exc: Exception) -> str:
    text = f"{exc.__class__.__name__} {exc}".casefold()
    if "timeout" in text:
        return "LLM 关键词建议请求超时，请稍后重试。"
    if "connection" in text:
        return "LLM 服务连接失败，请检查服务网络或配置。"
    if "unable to parse json" in text:
        return "LLM 关键词建议结果解析失败，请重试。"
    return "关键词建议服务暂不可用，请稍后重试。"


@router.get(
    "/api/admin/custom-intelligence/search-config",
    dependencies=[Depends(require_admin_token)],
)
def get_admin_search_config() -> dict[str, object]:
    try:
        return _admin_search_config_payload()
    except Exception as exc:
        raise _handle_store_error(exc, "无法加载情报搜索服务配置") from exc


@router.post(
    "/api/admin/custom-intelligence/search-config",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_search_config(payload: SearchServiceConfigUpdate) -> dict[str, object]:
    try:
        current = effective_search_config()
        api_key = (payload.api_key or "").strip()
        if not api_key or "••" in api_key:
            api_key = current.api_key
        store.save_search_config(
            enabled=payload.enabled,
            endpoint=QIANFAN_WEB_SEARCH_ENDPOINT,
            auth_header=settings.baidu_qianfan_auth_header,
            timeout_seconds=payload.timeout_seconds,
            updated_by_user_id=0,
            api_key=api_key,
        )
        return _admin_search_config_payload()
    except Exception as exc:
        raise _handle_store_error(exc, "无法保存情报搜索服务配置") from exc


@router.post(
    "/api/admin/custom-intelligence/search-config/test",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_search_config_test() -> dict[str, object]:
    tested_at = datetime.now(timezone.utc).isoformat()
    try:
        result = test_search_configuration()
    except Exception as exc:
        message = _test_error_message(exc)
        try:
            store.save_search_test(status="failed", message=message, tested_at=tested_at)
        except Exception:
            pass
        return {
            "status": "failed",
            "message": message,
            "tested_at": tested_at,
        }
    try:
        store.save_search_test(
            status="success",
            message=str(result.get("message") or "连接测试成功，服务可用。"),
            tested_at=tested_at,
        )
    except Exception:
        pass
    return {
        "status": "success",
        "message": str(result.get("message") or "连接测试成功，服务可用。"),
        "tested_at": tested_at,
        "request_id": result.get("request_id"),
    }


@router.post(
    "/api/admin/custom-intelligence/search-config/reveal-key",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_search_config_reveal_key(payload: VerifyPasswordRequest) -> dict[str, str]:
    expected_password = settings.admin_password
    if expected_password and secrets.compare_digest(payload.password, expected_password):
        return {"api_key": effective_search_config().api_key}
    raise HTTPException(status_code=401, detail="管理员密码不正确")


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


@router.post("/api/custom-intelligence/keyword-suggestions")
def post_keyword_suggestions(
    payload: KeywordSuggestionRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    get_session(authorization)
    try:
        suggestions = suggest_keywords(payload.model_dump(), payload.max_suggestions)
    except AnalysisConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=_suggest_error_message(exc)) from exc
    return {"suggestions": suggestions}


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
    payload: IntelligenceTopicCreate,
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
    payload: IntelligenceTopicUpdate,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    try:
        topic = store.update_topic(owner_id, topic_id, payload.model_dump(), owner_id)
    except Exception as exc:
        raise _handle_store_error(exc, "无法更新情报主题") from exc
    return {"topic": _public_topic(topic)}


@router.post("/api/custom-intelligence/topics/{topic_id}/enabled")
def post_topic_enabled(
    topic_id: int,
    payload: IntelligenceTopicEnabled,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    try:
        topic = store.set_topic_enabled(owner_id, topic_id, payload.enabled, owner_id)
    except Exception as exc:
        raise _handle_store_error(exc, "无法更新已保存配置状态") from exc
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
    response: Response,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    try:
        topic = store.get_topic(owner_id, topic_id)
        if not bool(topic.get("enabled")):
            raise HTTPException(status_code=409, detail="该配置已停用，请先启用后执行")
        snapshot = {
            key: value
            for key, value in topic.items()
            if key
            in {
                "name",
                "question",
                "description",
                "keywords",
                "focus_objects",
                "analysis_perspective",
                "time_range",
                "source_preference",
                "specified_sites",
                "report_type",
                "analysis_depth",
                "extra_requirements",
            }
        }
        saved_question = str(topic.get("question") or "").strip()
        snapshot["question"] = saved_question or f"请分析情报主题：{str(topic.get('name') or '证券行业近期动态')}"
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


@router.post("/api/custom-intelligence/executions/{execution_id}/rerun", status_code=status.HTTP_202_ACCEPTED)
def post_execution_rerun(
    execution_id: int,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    owner_id = _owner_user_id(session)
    try:
        previous = store.get_execution(owner_id, execution_id)
        snapshot = previous.get("snapshot") if isinstance(previous.get("snapshot"), dict) else {}
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


@router.get("/api/custom-intelligence/executions/{execution_id}/report/pdf")
def get_execution_report_pdf(
    execution_id: int,
    authorization: Annotated[str | None, Header()] = None,
) -> RawResponse:
    session = get_session(authorization)
    try:
        execution = store.get_execution(_owner_user_id(session), execution_id)
    except Exception as exc:
        raise _handle_store_error(exc, "无法加载情报记录") from exc
    if execution.get("search_status") != "succeeded" or not execution.get("sources"):
        raise HTTPException(status_code=409, detail="该记录没有可导出的搜索结果")
    try:
        pdf_bytes = build_report_pdf(execution)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="报告 PDF 生成失败，请稍后重试") from exc
    filename = report_pdf_filename(execution)
    disposition = f"attachment; filename*=UTF-8''{quote(filename.encode('utf-8'))}"
    return RawResponse(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": disposition},
    )
