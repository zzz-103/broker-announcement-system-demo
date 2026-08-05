from __future__ import annotations

import secrets
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from ..auth import get_session, require_admin_token
from ..audit_store import (
    AuditStoreError,
    EVENT_TYPES as AUDIT_EVENT_TYPES,
    get_today_summary,
    list_events,
    record_event,
)
from ..config import settings
from ..contracts import (
    AdminUserCreateRequest,
    DashboardViewRequest,
    FeedbackCreateRequest,
    FeedbackStatusUpdateRequest,
    LoginRequest,
    LoginResponse,
    QrVisitRequest,
    UserApplyRequest,
    VerifyPasswordRequest,
)
from ..runtime import session_tokens
from ..user_store import (
    DuplicateUserError,
    FeedbackNotFoundError,
    InvalidUserCredentialsError,
    QualificationNotFoundError,
    QualificationServiceUnavailableError,
    UserNotFoundError,
    UserStoreError,
    apply_for_user,
    authenticate_user,
    create_feedback,
    create_user,
    delete_user,
    get_user_names_by_ids,
    list_feedback,
    list_users,
    normalize_email,
    update_feedback_status,
    username_from_email,
)


router = APIRouter()
session_tokens_lock = session_tokens.lock
QUALIFICATION_NOT_FOUND_MESSAGE = "未找到匹配资格，请联系管理员"
QUALIFICATION_SERVICE_UNAVAILABLE_MESSAGE = "资格服务暂不可用，请联系管理员"
FEEDBACK_CATEGORIES = {"broker_request", "data_issue", "product_suggestion"}
FEEDBACK_STATUSES = {"pending", "processed"}
AUDIT_SOURCES = {"qr", "qr_poster"}


def normalize_audit_context(visitor_id: str | None, source: str | None) -> tuple[str | None, str | None]:
    normalized_visitor_id: str | None = None
    if visitor_id:
        try:
            normalized_visitor_id = str(uuid.UUID(visitor_id.strip()))
        except (AttributeError, ValueError):
            pass
    normalized_source = source.strip() if source else ""
    return normalized_visitor_id, normalized_source if normalized_source in AUDIT_SOURCES else None


def masked_request_ip(request: Request) -> str:
    raw_ip = request.headers.get("x-real-ip") or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if not raw_ip and request.client is not None:
        raw_ip = request.client.host
    if not raw_ip:
        return "unknown"
    if ":" in raw_ip:
        parts = raw_ip.split(":")
        return ":".join(parts[:4] + ["xxxx", "xxxx", "xxxx", "xxxx"])
    parts = raw_ip.split(".")
    return f"{'.'.join(parts[:3])}.xxx" if len(parts) == 4 else "unknown"


def request_user_agent(request: Request) -> str | None:
    value = request.headers.get("user-agent", "").strip()
    return value[:512] if value else None


def write_audit_event_safely(**kwargs: object) -> bool:
    try:
        _, recorded = record_event(**kwargs)  # type: ignore[arg-type]
        return recorded
    except AuditStoreError:
        print("Audit event write failed")
        return False


def normalize_feedback_text(value: str, limit: int, field: str) -> str:
    normalized = value.strip()
    if len(normalized) > limit:
        raise HTTPException(status_code=400, detail=f"{field} is too long")
    return normalized


@router.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/api/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request) -> LoginResponse:
    expected_username = settings.admin_username
    expected_password = settings.admin_password
    username = payload.username.strip()
    password = payload.password
    is_admin_login = False
    if expected_password:
        is_admin_login = secrets.compare_digest(
            username,
            expected_username,
        ) and secrets.compare_digest(password, expected_password)

    if is_admin_login:
        token = secrets.token_urlsafe(32)
        session_tokens[token] = {
            "username": expected_username,
            "name": expected_username,
            "role": "admin",
            "is_admin": True,
            # Reserved stable owner ID for the administrator.  Roles remain
            # authorization metadata; custom intelligence ownership is always
            # keyed by this integer ID.
            "user_id": 0,
            "dashboard_view_recorded": False,
        }
        visitor_id, source = normalize_audit_context(payload.visitor_id, payload.source)
        write_audit_event_safely(
            event_type="login_success",
            visitor_id=visitor_id,
            username=expected_username,
            role="admin",
            source=source,
            ip_masked=masked_request_ip(request),
            user_agent=request_user_agent(request),
        )
        return LoginResponse(
            token=token,
            username=expected_username,
            name=expected_username,
            role="admin",
            is_admin=True,
        )

    try:
        user = authenticate_user(username, password)
    except InvalidUserCredentialsError as exc:
        raise HTTPException(status_code=401, detail="invalid credentials") from exc
    except UserStoreError as exc:
        raise HTTPException(status_code=500, detail="failed to authenticate user") from exc

    token = secrets.token_urlsafe(32)
    user_email = str(getattr(user, "email", "") or "")
    session_tokens[token] = {
        "username": user.username,
        "name": user.name,
        "email": user_email,
        "role": "user",
        "is_admin": False,
        "user_id": user.id,
        "dashboard_view_recorded": False,
    }
    visitor_id, source = normalize_audit_context(payload.visitor_id, payload.source)
    write_audit_event_safely(
        event_type="login_success",
        visitor_id=visitor_id,
        user_id=user.id,
        username=user.name or user_email or user.username,
        role="user",
        source=source,
        ip_masked=masked_request_ip(request),
        user_agent=request_user_agent(request),
        metadata={"account_username": user.username, "email": user_email},
    )
    return LoginResponse(
        token=token,
        username=user.username,
        name=user.name,
        role="user",
        is_admin=False,
    )


@router.post("/api/admin/verify-password", dependencies=[Depends(require_admin_token)])
def verify_admin_password(payload: VerifyPasswordRequest) -> dict[str, bool]:
    """重新验证管理员密码，不创建会话、不产生登录审计事件。

    用于全量重建等影响范围较大的操作前的二次身份确认。
    """
    expected_password = settings.admin_password
    if expected_password and secrets.compare_digest(payload.password, expected_password):
        return {"verified": True}
    raise HTTPException(status_code=401, detail="管理员密码不正确")


@router.post("/api/users/apply")
def apply_user(payload: UserApplyRequest, request: Request) -> dict[str, object]:
    name = payload.name.strip()
    email = normalize_email(payload.email)
    department = payload.department.strip()
    visitor_id, source = normalize_audit_context(payload.visitor_id, payload.source)
    audit_result = "invalid_request"
    user = None
    try:
        if not name or not email or not department:
            raise HTTPException(status_code=400, detail=QUALIFICATION_NOT_FOUND_MESSAGE)
        user, initial_password = apply_for_user(name, email, department)
        audit_result = "success"
        return {
            "user": user.to_dict(),
            "username": user.username,
            "initial_password": initial_password,
        }
    except QualificationServiceUnavailableError as exc:
        audit_result = "service_unavailable"
        print(f"Qualification service unavailable: {exc.__class__.__name__}")
        raise HTTPException(status_code=503, detail=QUALIFICATION_SERVICE_UNAVAILABLE_MESSAGE) from exc
    except QualificationNotFoundError as exc:
        audit_result = "qualification_not_found"
        raise HTTPException(status_code=404, detail=QUALIFICATION_NOT_FOUND_MESSAGE) from exc
    except UserStoreError as exc:
        audit_result = "internal_error"
        raise HTTPException(status_code=500, detail="failed to apply for user account") from exc
    finally:
        write_audit_event_safely(
            event_type="qualification_application",
            visitor_id=visitor_id,
            user_id=user.id if user is not None else None,
            username=user.username if user is not None else None,
            role="user" if user is not None else None,
            source=source,
            ip_masked=masked_request_ip(request),
            user_agent=request_user_agent(request),
            metadata={
                "name": name[:100],
                "email": email[:254],
                "department": department[:100],
                "result": audit_result,
            },
        )


@router.post("/api/audit/qr-visit")
def post_qr_visit(payload: QrVisitRequest, request: Request) -> dict[str, bool]:
    visitor_id, source = normalize_audit_context(payload.visitor_id, payload.source)
    if visitor_id is None or source is None:
        raise HTTPException(status_code=400, detail="audit context is invalid")
    try:
        _, recorded = record_event(
            event_type="qr_visit",
            visitor_id=visitor_id,
            source=source,
            ip_masked=masked_request_ip(request),
            user_agent=request_user_agent(request),
        )
    except AuditStoreError as exc:
        raise HTTPException(status_code=503, detail="audit service is unavailable") from exc
    return {"recorded": recorded}


@router.post("/api/audit/dashboard-view")
def post_dashboard_view(
    payload: DashboardViewRequest,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, bool]:
    session = get_session(authorization)
    visitor_id, source = normalize_audit_context(payload.visitor_id, payload.source)
    with session_tokens_lock:
        if bool(session.get("dashboard_view_recorded")):
            return {"recorded": False}
        recorded = write_audit_event_safely(
            event_type="dashboard_view",
            visitor_id=visitor_id,
            user_id=int(session["user_id"]) if isinstance(session.get("user_id"), int) else None,
            username=str(
                session.get("name")
                or session.get("email")
                or session.get("username")
                or ""
            ) or None,
            role=str(session.get("role") or "") or None,
            source=source,
            ip_masked=masked_request_ip(request),
            user_agent=request_user_agent(request),
        )
        if recorded:
            session["dashboard_view_recorded"] = True
    return {"recorded": recorded}


@router.post("/api/feedback")
def post_feedback(
    payload: FeedbackCreateRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    category = payload.category.strip()
    if category not in FEEDBACK_CATEGORIES:
        raise HTTPException(status_code=400, detail="feedback category is invalid")
    broker_name = normalize_feedback_text(payload.broker_name, 100, "broker name")
    message = normalize_feedback_text(payload.message, 1000, "message")
    related_context = normalize_feedback_text(payload.related_context, 200, "related context")
    if category == "broker_request" and not broker_name:
        raise HTTPException(status_code=400, detail="broker name is required")
    if category in {"data_issue", "product_suggestion"} and not message:
        raise HTTPException(status_code=400, detail="message is required")
    try:
        feedback = create_feedback(
            category=category,
            broker_name=broker_name,
            message=message,
            related_context=related_context,
            reporter_username=str(session.get("username") or ""),
            reporter_name=str(session.get("name") or session.get("username") or ""),
        )
    except UserStoreError as exc:
        raise HTTPException(status_code=500, detail="failed to submit feedback") from exc
    return {"feedback": feedback.to_dict()}


@router.get("/api/admin/users", dependencies=[Depends(require_admin_token)])
def get_admin_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=4, ge=1, le=100),
    query: str | None = Query(default=None, alias="q", max_length=100),
) -> dict[str, object]:
    try:
        users, total, effective_page = list_users(page, page_size, query)
    except UserStoreError as exc:
        raise HTTPException(status_code=500, detail="failed to load approved users") from exc
    return {
        "users": [user.to_dict() for user in users],
        "meta": {
            "page": effective_page,
            "page_size": page_size,
            "total": total,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "q": query.strip() if query else "",
        },
    }


@router.get("/api/admin/audit/summary", dependencies=[Depends(require_admin_token)])
def get_admin_audit_summary() -> dict[str, object]:
    try:
        return {"timezone": "Asia/Shanghai", **get_today_summary()}
    except AuditStoreError as exc:
        raise HTTPException(status_code=500, detail="failed to load audit summary") from exc


@router.get("/api/admin/audit/events", dependencies=[Depends(require_admin_token)])
def get_admin_audit_events(
    event_type: str | None = Query(default=None, alias="type"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    query: str | None = Query(default=None, alias="q", max_length=100),
) -> dict[str, object]:
    normalized_type = event_type.strip() if event_type else None
    if normalized_type and normalized_type not in AUDIT_EVENT_TYPES:
        raise HTTPException(status_code=400, detail="audit event type is invalid")
    try:
        events, total, effective_page = list_events(normalized_type, page, page_size, query)
    except AuditStoreError as exc:
        raise HTTPException(status_code=500, detail="failed to load audit events") from exc
    try:
        user_names = get_user_names_by_ids(
            {event.user_id for event in events if event.user_id is not None}
        )
    except UserStoreError:
        user_names = {}
    event_payloads = []
    for event in events:
        payload = event.to_dict()
        if event.user_id is not None and user_names.get(event.user_id):
            payload["username"] = user_names[event.user_id]
        event_payloads.append(payload)
    return {
        "events": event_payloads,
        "meta": {
            "type": normalized_type,
            "page": effective_page,
            "page_size": page_size,
            "total": total,
            "total_pages": max(1, (total + page_size - 1) // page_size),
            "q": query.strip() if query else "",
            "count": len(events),
        },
    }


@router.get("/api/admin/feedback", dependencies=[Depends(require_admin_token)])
def get_admin_feedback() -> dict[str, object]:
    try:
        feedback = [entry.to_dict() for entry in list_feedback()]
    except UserStoreError as exc:
        raise HTTPException(status_code=500, detail="failed to load feedback") from exc
    return {"feedback": feedback}


@router.post("/api/admin/feedback/{feedback_id}/status", dependencies=[Depends(require_admin_token)])
def post_admin_feedback_status(
    feedback_id: int,
    payload: FeedbackStatusUpdateRequest,
) -> dict[str, object]:
    feedback_status = payload.status.strip()
    if feedback_status not in FEEDBACK_STATUSES:
        raise HTTPException(status_code=400, detail="feedback status is invalid")
    try:
        feedback = update_feedback_status(feedback_id, feedback_status)
    except FeedbackNotFoundError as exc:
        raise HTTPException(status_code=404, detail="feedback not found") from exc
    except UserStoreError as exc:
        raise HTTPException(status_code=500, detail="failed to update feedback") from exc
    return {"feedback": feedback.to_dict()}


@router.post("/api/admin/users", dependencies=[Depends(require_admin_token)])
def post_admin_user(payload: AdminUserCreateRequest) -> dict[str, object]:
    name = payload.name.strip()
    email = normalize_email(payload.email)
    department = payload.department.strip()
    username = username_from_email(email)
    if not name or not email or not department:
        raise HTTPException(status_code=400, detail="name, email and department are required")
    if "@" not in email or not username:
        raise HTTPException(status_code=400, detail="email is invalid")
    try:
        user, initial_password = create_user(name, email, department)
    except DuplicateUserError as exc:
        raise HTTPException(status_code=409, detail="email or username already exists") from exc
    except UserStoreError as exc:
        raise HTTPException(status_code=500, detail="failed to create approved user") from exc
    return {"user": user.to_dict(), "initial_password": initial_password}


@router.delete("/api/admin/users/{user_id}", dependencies=[Depends(require_admin_token)])
def delete_admin_user(user_id: int) -> dict[str, bool]:
    try:
        delete_user(user_id)
    except UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail="user not found") from exc
    except UserStoreError as exc:
        raise HTTPException(status_code=500, detail="failed to delete approved user") from exc
    return {"deleted": True}
