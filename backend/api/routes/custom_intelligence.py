from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, Response, status

from ..auth import get_session
from ..contracts import (
    InstantSearchRequest,
    IntelligenceTopicCreate,
    IntelligenceTopicEnabled,
    IntelligenceTopicUpdate,
    KeywordSuggestionRequest,
)
from ..custom_intelligence_service import (
    ActiveExecutionError,
    IntelligenceNotFoundError,
    IntelligenceStoreError,
    options_payload,
    store,
    submit_execution,
    suggest_keywords,
)
from ..custom_intelligence_store import TopicNameConflictError
from ..qianfan_search import QianfanConfigurationError, QianfanError, QianfanTimeoutError


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
    return {key: value for key, value in topic.items() if key not in {"owner_user_id", "created_by_user_id", "updated_by_user_id"}}


def _public_execution(execution: dict[str, object]) -> dict[str, object]:
    return {key: value for key, value in execution.items() if key not in {"owner_user_id", "created_by_user_id", "executed_by_user_id"}}


def _handle_store_error(exc: Exception, fallback: str = "自定义情报服务暂不可用") -> HTTPException:
    if isinstance(exc, IntelligenceNotFoundError):
        return HTTPException(status_code=404, detail="情报记录不存在")
    if isinstance(exc, ActiveExecutionError):
        return HTTPException(status_code=409, detail="当前已有情报执行正在进行，请稍后再试")
    if isinstance(exc, TopicNameConflictError):
        return HTTPException(status_code=409, detail="同名情报主题已存在")
    if isinstance(exc, QianfanConfigurationError):
        return HTTPException(status_code=503, detail="百度智能搜索服务尚未配置")
    if isinstance(exc, QianfanTimeoutError):
        return HTTPException(status_code=504, detail="百度智能搜索请求超时，请稍后重试")
    if isinstance(exc, QianfanError):
        return HTTPException(status_code=502, detail="百度智能搜索服务暂不可用，请稍后重试")
    if isinstance(exc, IntelligenceStoreError):
        return HTTPException(status_code=500, detail=fallback)
    return HTTPException(status_code=500, detail=fallback)


@router.get("/api/custom-intelligence/options")
def get_custom_intelligence_options(
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    get_session(authorization)
    return options_payload()


@router.post("/api/custom-intelligence/keyword-suggestions")
def post_keyword_suggestions(
    payload: KeywordSuggestionRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    get_session(authorization)
    try:
        suggestions = suggest_keywords(payload.model_dump(), payload.max_suggestions)
    except Exception as exc:
        raise _handle_store_error(exc, "关键词建议服务暂不可用") from exc
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
        raise _handle_store_error(exc, "无法更新情报主题状态") from exc
    return {"topic": _public_topic(topic)}


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
            raise HTTPException(status_code=409, detail="情报主题已停用，请先启用后执行")
        snapshot = {
            key: value
            for key, value in topic.items()
            if key
            in {
                "name",
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
        snapshot["question"] = f"请分析情报主题：{str(topic.get('name') or '证券行业近期动态')}"
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
