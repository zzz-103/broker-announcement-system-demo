from __future__ import annotations

import asyncio
import csv
import os
import re
import secrets
import shutil
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .ai_analysis import (
    AiAnalysisError,
    generate_ai_analysis,
    load_cached_analysis,
    to_http_exception,
)
from .announcement_cache import AnnouncementResponseCache, accepts_gzip, etag_matches
from .audit_store import AuditStoreError, EVENT_TYPES as AUDIT_EVENT_TYPES, get_today_summary, list_events, record_event
from .job_manager import JobConflictError, JobManager, JobNotFoundError, format_sse
from .supplemental_seed import (
    CANONICAL_FIELDS,
    SupplementalDataError,
    merge_for_publication,
    supplemental_data_dir,
)
from .user_store import (
    DuplicateUserError,
    FeedbackNotFoundError,
    InvalidUserCredentialsError,
    QualificationNotFoundError,
    QualificationServiceUnavailableError,
    UserNotFoundError,
    UserStoreError,
    apply_for_user,
    authenticate_user,
    create_user,
    create_feedback,
    delete_user,
    list_users,
    list_feedback,
    normalize_email,
    update_feedback_status,
    username_from_email,
)

# Explicitly load .env from the project root
PROJECT_ROOT = Path(__file__).resolve().parents[2]
env_path = PROJECT_ROOT / ".env"
env_loaded = load_dotenv(env_path)

if env_loaded:
    print(f"Successfully loaded environment variables from {env_path}")
else:
    print(f"Warning: No .env file found at {env_path} or failed to load it")

admin_username = os.getenv("ADMIN_USERNAME", "admin")
admin_password = os.getenv("ADMIN_PASSWORD")
frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
frontend_origins = [
    origin.strip()
    for origin in frontend_origin.split(",")
    if origin.strip()
]
if not frontend_origins:
    frontend_origins = ["http://localhost:3000"]

if not admin_password:
    print("Warning: ADMIN_PASSWORD is not set in the environment.")
else:
    print(f"Admin username set to: {admin_username}")


class LoginRequest(BaseModel):
    username: str
    password: str
    visitor_id: str | None = None
    source: str | None = None


class LoginResponse(BaseModel):
    token: str
    username: str
    name: str
    role: str
    is_admin: bool


class AdminUserCreateRequest(BaseModel):
    name: str
    email: str
    department: str


class UserApplyRequest(BaseModel):
    name: str
    email: str
    department: str
    visitor_id: str | None = None
    source: str | None = None


class QrVisitRequest(BaseModel):
    visitor_id: str
    source: str


class DashboardViewRequest(BaseModel):
    visitor_id: str | None = None
    source: str | None = None


class FeedbackCreateRequest(BaseModel):
    category: str
    broker_name: str = ""
    message: str = ""
    related_context: str = ""


class FeedbackStatusUpdateRequest(BaseModel):
    status: str


class LlmJobRequest(BaseModel):
    mode: str = "incremental"
    overwrite: bool = False

    class Config:
        extra = "forbid"


job_manager = JobManager()
announcement_response_cache = AnnouncementResponseCache()
session_tokens: dict[str, dict[str, object]] = {}
session_tokens_lock = threading.Lock()
QUALIFICATION_NOT_FOUND_MESSAGE = "\u672a\u627e\u5230\u5339\u914d\u8d44\u683c\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458"
QUALIFICATION_SERVICE_UNAVAILABLE_MESSAGE = "\u8d44\u683c\u670d\u52a1\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458"
FEEDBACK_CATEGORIES = {"broker_request", "data_issue", "product_suggestion"}
FEEDBACK_STATUSES = {"pending", "processed"}
AUDIT_SOURCES = {"qr", "qr_poster"}


@dataclass
class PublishPlan:
    fieldnames: list[str]
    records: list[dict[str, str]]
    meta: dict[str, object]

app = FastAPI(title="Broker Announcement API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=3)


@app.middleware("http")
async def frontend_cache_headers(request: Request, call_next):
    response = await call_next(request)
    vary_header = response.headers.get("Vary")
    if vary_header:
        unique_vary: list[str] = []
        seen_vary: set[str] = set()
        for value in (item.strip() for item in vary_header.split(",")):
            normalized = value.casefold()
            if value and normalized not in seen_vary:
                seen_vary.add(normalized)
                unique_vary.append(value)
        response.headers["Vary"] = ", ".join(unique_vary)
    request_path = request.url.path
    if response.status_code < 400 and request_path.startswith("/_next/static/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif not request_path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


def get_session(authorization: Annotated[str | None, Header()] = None) -> dict[str, object]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    session = session_tokens.get(token)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
    return session


def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
    get_session(authorization)


def require_admin_token(authorization: Annotated[str | None, Header()] = None) -> None:
    session = get_session(authorization)
    if session.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin privileges required")


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
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field} is too long",
        )
    return normalized


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def resolve_project_path(value: str | None, default: Path) -> Path:
    project_root = Path(__file__).resolve().parents[2]
    path = Path(value) if value else default
    if not path.is_absolute():
        path = project_root / path
    return path.resolve()


def announcement_csv_path() -> Path:
    project_root = Path(__file__).resolve().parents[2]
    return resolve_project_path(
        os.getenv("ANNOUNCEMENT_CSV_PATH"),
        project_root / "backend" / "data" / "announcement_table.csv",
    )


def announcement_staging_csv_path() -> Path:
    project_root = Path(__file__).resolve().parents[2]
    return resolve_project_path(
        os.getenv("ANNOUNCEMENT_STAGING_CSV_PATH"),
        project_root / "backend" / "data" / "staging" / "announcement_table.csv",
    )


def read_announcement_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            fieldnames = list(reader.fieldnames or [])
            records = list(reader)
    except csv.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to parse announcement CSV",
        ) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to read announcement data",
        ) from exc
    return fieldnames, records


def count_csv_records(path: Path) -> int:
    if not path.exists():
        return 0
    _, records = read_announcement_csv(path)
    return len([row for row in records if any(str(value or "").strip() for value in row.values())])


def publish_csv_atomically(
    fieldnames: list[str],
    records: list[dict[str, str]],
    target_path: Path,
) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.with_name(
        f".{target_path.stem}.{os.getpid()}.publish.tmp{target_path.suffix}"
    )
    try:
        with temp_path.open("w", encoding="utf-8-sig", newline="") as temp_file:
            writer = csv.DictWriter(temp_file, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(records)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_path, target_path)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to publish announcement CSV",
        ) from exc
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def backup_csv_atomically(target_path: Path) -> str | None:
    if not target_path.exists():
        return None

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = target_path.with_name(f"{target_path.stem}-{timestamp}.backup{target_path.suffix}")
    temp_path = target_path.with_name(
        f".{target_path.stem}.{os.getpid()}.backup.tmp{target_path.suffix}"
    )
    try:
        with target_path.open("rb") as source, temp_path.open("wb") as temp_file:
            shutil.copyfileobj(source, temp_file)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_path, backup_path)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to backup announcement CSV",
        ) from exc
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass
    return backup_path.name


def announcement_backup_retention() -> int:
    raw_value = os.getenv("ANNOUNCEMENT_BACKUP_RETENTION", "3").strip()
    try:
        value = int(raw_value)
    except ValueError:
        return 3
    return value if 1 <= value <= 100 else 3


def prune_old_announcement_backups(
    target_path: Path,
    retention: int | None = None,
) -> list[str]:
    keep_count = retention if retention is not None else announcement_backup_retention()
    pattern = re.compile(
        rf"^{re.escape(target_path.stem)}-(\d{{8}}-\d{{6}})"
        rf"\.backup{re.escape(target_path.suffix)}$"
    )
    candidates: list[tuple[datetime, Path]] = []
    try:
        directory_entries = list(target_path.parent.iterdir())
    except OSError:
        return []

    for path in directory_entries:
        if not path.is_file():
            continue
        match = pattern.fullmatch(path.name)
        if match is None:
            continue
        try:
            timestamp = datetime.strptime(match.group(1), "%Y%m%d-%H%M%S")
        except ValueError:
            continue
        candidates.append((timestamp, path))

    candidates.sort(key=lambda item: (item[0], item[1].name), reverse=True)
    removed: list[str] = []
    for _, path in candidates[max(0, keep_count) :]:
        try:
            path.unlink()
        except OSError:
            print("Warning: failed to prune an old announcement backup.")
        else:
            removed.append(path.name)
    return removed


@app.post("/api/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request) -> LoginResponse:
    expected_username = os.getenv("ADMIN_USERNAME", "admin")
    expected_password = os.getenv("ADMIN_PASSWORD")
    username = payload.username.strip()
    password = payload.password
    is_admin_login = False

    if expected_password:
        username_ok = secrets.compare_digest(username, expected_username)
        password_ok = secrets.compare_digest(password, expected_password)
        is_admin_login = username_ok and password_ok

    if is_admin_login:
        token = secrets.token_urlsafe(32)
        session_tokens[token] = {
            "username": expected_username,
            "name": expected_username,
            "role": "admin",
            "is_admin": True,
            "user_id": None,
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
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials") from exc
    except UserStoreError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to authenticate user",
        ) from exc

    token = secrets.token_urlsafe(32)
    session_tokens[token] = {
        "username": user.username,
        "name": user.name,
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
        username=user.username,
        role="user",
        source=source,
        ip_masked=masked_request_ip(request),
        user_agent=request_user_agent(request),
    )
    return LoginResponse(
        token=token,
        username=user.username,
        name=user.name,
        role="user",
        is_admin=False,
    )


@app.post("/api/users/apply")
def apply_user(payload: UserApplyRequest, request: Request) -> dict[str, object]:
    name = payload.name.strip()
    email = normalize_email(payload.email)
    department = payload.department.strip()
    visitor_id, source = normalize_audit_context(payload.visitor_id, payload.source)
    audit_result = "invalid_request"
    user = None
    try:
        if not name or not email or not department:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=QUALIFICATION_NOT_FOUND_MESSAGE,
            )
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
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=QUALIFICATION_SERVICE_UNAVAILABLE_MESSAGE,
        ) from exc
    except QualificationNotFoundError as exc:
        audit_result = "qualification_not_found"
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=QUALIFICATION_NOT_FOUND_MESSAGE,
        ) from exc
    except UserStoreError as exc:
        audit_result = "internal_error"
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to apply for user account",
        ) from exc
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


@app.post("/api/audit/qr-visit")
def post_qr_visit(payload: QrVisitRequest, request: Request) -> dict[str, bool]:
    visitor_id, source = normalize_audit_context(payload.visitor_id, payload.source)
    if visitor_id is None or source is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="audit context is invalid")
    try:
        _, recorded = record_event(
            event_type="qr_visit",
            visitor_id=visitor_id,
            source=source,
            ip_masked=masked_request_ip(request),
            user_agent=request_user_agent(request),
        )
    except AuditStoreError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="audit service is unavailable") from exc
    return {"recorded": recorded}


@app.post("/api/audit/dashboard-view")
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
            username=str(session.get("username") or "") or None,
            role=str(session.get("role") or "") or None,
            source=source,
            ip_masked=masked_request_ip(request),
            user_agent=request_user_agent(request),
        )
        if recorded:
            session["dashboard_view_recorded"] = True
    return {"recorded": recorded}


@app.post("/api/feedback")
def post_feedback(
    payload: FeedbackCreateRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    session = get_session(authorization)
    category = payload.category.strip()
    if category not in FEEDBACK_CATEGORIES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="feedback category is invalid")

    broker_name = normalize_feedback_text(payload.broker_name, 100, "broker name")
    message = normalize_feedback_text(payload.message, 1000, "message")
    related_context = normalize_feedback_text(payload.related_context, 200, "related context")
    if category == "broker_request" and not broker_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="broker name is required")
    if category in {"data_issue", "product_suggestion"} and not message:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="message is required")

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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to submit feedback",
        ) from exc
    return {"feedback": feedback.to_dict()}


@app.post("/api/jobs/scraper", dependencies=[Depends(require_admin_token)])
def start_scraper() -> dict[str, str]:
    try:
        job = job_manager.start_scraper()
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"job_id": job.job_id, "job_type": job.job_type, "status": job.status}


@app.post("/api/jobs/llm", dependencies=[Depends(require_admin_token)])
def start_llm(payload: LlmJobRequest | None = None) -> dict[str, str]:
    mode = (payload.mode if payload else "incremental").strip()
    overwrite = bool(payload.overwrite) if payload else False
    if mode not in {"incremental", "full_refresh"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="invalid LLM mode",
        )
    if mode == "incremental" and overwrite:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="overwrite is only allowed for full_refresh mode",
        )
    if mode == "full_refresh" and not overwrite:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="full_refresh mode requires overwrite=true",
        )
    try:
        job = job_manager.start_llm(mode=mode, overwrite=overwrite)
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"job_id": job.job_id, "job_type": job.job_type, "status": job.status}


@app.post("/api/jobs/llm-external", dependencies=[Depends(require_admin_token)])
def start_llm_external() -> dict[str, str]:
    try:
        job = job_manager.start_llm_external()
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"job_id": job.job_id, "job_type": job.job_type, "status": job.status}


@app.post("/api/jobs/pipeline", dependencies=[Depends(require_admin_token)])
def start_pipeline() -> dict[str, str]:
    try:
        job = job_manager.start_pipeline()
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"job_id": job.job_id, "job_type": job.job_type, "status": job.status}


@app.post("/api/internal/scheduled-pipeline")
def scheduled_pipeline(
    x_scheduler_token: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    """Internal endpoint for the independent scheduler process."""
    expected_token = os.getenv("SCHEDULER_TOKEN", "")
    if not expected_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="scheduler token not configured",
        )
    provided = (x_scheduler_token or "").strip()
    if not provided or not secrets.compare_digest(provided, expected_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid scheduler token",
        )
    try:
        job = job_manager.start_pipeline()
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"job_id": job.job_id, "job_type": job.job_type, "status": job.status}


@app.get("/api/data/announcements", dependencies=[Depends(require_token)])
def get_announcements(request: Request) -> Response:
    csv_path = announcement_csv_path()

    if not csv_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="announcement data has not been generated; run scraper and LLM first",
        )

    try:
        cached = announcement_response_cache.get(csv_path, read_announcement_csv)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to read announcement data",
        ) from exc

    use_gzip = accepts_gzip(request.headers.get("accept-encoding"))
    response_headers = {
        "ETag": cached.etag,
        "Vary": "Accept-Encoding",
        "Cache-Control": "private, no-cache",
    }
    if etag_matches(request.headers.get("if-none-match"), cached.etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=response_headers)
    if use_gzip:
        response_headers["Content-Encoding"] = "gzip"
        body = cached.gzip_body
    else:
        body = cached.raw_body
    return Response(content=body, media_type="application/json", headers=response_headers)


@app.post("/api/data/announcements/publish", dependencies=[Depends(require_admin_token)])
def publish_announcements() -> dict[str, object]:
    try:
        job_manager.acquire_operation("publish")
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    try:
        staging_path = announcement_staging_csv_path()
        target_path = announcement_csv_path()

        if not staging_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="staging announcement CSV not found",
            )

        previous_count = count_csv_records(target_path)
        try:
            merge_result = merge_for_publication(staging_path, supplemental_data_dir(PROJECT_ROOT))
        except SupplementalDataError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
        publish_plan = PublishPlan(
            fieldnames=CANONICAL_FIELDS,
            records=merge_result.records,
            meta={
                **merge_result.meta,
                "previous_count": previous_count,
                "source_count": merge_result.meta["staging_count"],
            },
        )
        backup_name = backup_csv_atomically(target_path)
        publish_csv_atomically(publish_plan.fieldnames, publish_plan.records, target_path)
        announcement_response_cache.invalidate(target_path)
        prune_old_announcement_backups(target_path)

        published_at = datetime.now(timezone.utc).isoformat()
        updated_at = datetime.fromtimestamp(target_path.stat().st_mtime, timezone.utc).isoformat()
        meta = {
            **publish_plan.meta,
            "count": len(publish_plan.records),
            "published_count": len(publish_plan.records),
            "published_at": published_at,
            "updated_at": updated_at,
            "backup_file": backup_name,
        }
        return {
            "message": "推送成功",
            "meta": meta,
        }
    finally:
        job_manager.release_operation("publish")


@app.get("/api/admin/users", dependencies=[Depends(require_admin_token)])
def get_admin_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=4, ge=1, le=100),
    query: str | None = Query(default=None, alias="q", max_length=100),
) -> dict[str, object]:
    try:
        users, total, effective_page = list_users(page, page_size, query)
    except UserStoreError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to load approved users",
        ) from exc
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


@app.get("/api/admin/audit/summary", dependencies=[Depends(require_admin_token)])
def get_admin_audit_summary() -> dict[str, object]:
    try:
        return {"timezone": "Asia/Shanghai", **get_today_summary()}
    except AuditStoreError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to load audit summary",
        ) from exc


@app.get("/api/admin/audit/events", dependencies=[Depends(require_admin_token)])
def get_admin_audit_events(
    event_type: str | None = Query(default=None, alias="type"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    query: str | None = Query(default=None, alias="q", max_length=100),
) -> dict[str, object]:
    normalized_type = event_type.strip() if event_type else None
    if normalized_type and normalized_type not in AUDIT_EVENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="audit event type is invalid")
    try:
        events, total, effective_page = list_events(normalized_type, page, page_size, query)
    except AuditStoreError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to load audit events",
        ) from exc
    return {
        "events": [event.to_dict() for event in events],
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


@app.get("/api/admin/feedback", dependencies=[Depends(require_admin_token)])
def get_admin_feedback() -> dict[str, object]:
    try:
        feedback = [entry.to_dict() for entry in list_feedback()]
    except UserStoreError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to load feedback",
        ) from exc
    return {"feedback": feedback}


@app.post("/api/admin/feedback/{feedback_id}/status", dependencies=[Depends(require_admin_token)])
def post_admin_feedback_status(
    feedback_id: int,
    payload: FeedbackStatusUpdateRequest,
) -> dict[str, object]:
    feedback_status = payload.status.strip()
    if feedback_status not in FEEDBACK_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="feedback status is invalid")
    try:
        feedback = update_feedback_status(feedback_id, feedback_status)
    except FeedbackNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="feedback not found") from exc
    except UserStoreError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to update feedback",
        ) from exc
    return {"feedback": feedback.to_dict()}


@app.post("/api/admin/users", dependencies=[Depends(require_admin_token)])
def post_admin_user(payload: AdminUserCreateRequest) -> dict[str, object]:
    name = payload.name.strip()
    email = normalize_email(payload.email)
    department = payload.department.strip()
    username = username_from_email(email)

    if not name or not email or not department:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="name, email and department are required",
        )
    if "@" not in email or not username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="email is invalid",
        )

    try:
        user, initial_password = create_user(name, email, department)
    except DuplicateUserError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="email or username already exists",
        ) from exc
    except UserStoreError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to create approved user",
        ) from exc

    return {"user": user.to_dict(), "initial_password": initial_password}


@app.delete("/api/admin/users/{user_id}", dependencies=[Depends(require_admin_token)])
def delete_admin_user(user_id: int) -> dict[str, bool]:
    try:
        delete_user(user_id)
    except UserNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found") from exc
    except UserStoreError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to delete approved user",
        ) from exc
    return {"deleted": True}


@app.get("/api/ai-analysis", dependencies=[Depends(require_token)])
def get_ai_analysis() -> dict[str, object]:
    try:
        return load_cached_analysis()
    except AiAnalysisError as exc:
        raise to_http_exception(exc) from exc


@app.post("/api/ai-analysis", dependencies=[Depends(require_admin_token)])
def post_ai_analysis() -> dict[str, object]:
    try:
        job_manager.acquire_operation("ai_analysis")
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    try:
        return generate_ai_analysis()
    except AiAnalysisError as exc:
        raise to_http_exception(exc) from exc
    finally:
        job_manager.release_operation("ai_analysis")


@app.get("/api/jobs/{job_id}", dependencies=[Depends(require_admin_token)])
def get_job(job_id: str) -> dict[str, object]:
    try:
        return job_manager.get_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found") from exc


@app.post("/api/jobs/{job_id}/cancel", dependencies=[Depends(require_admin_token)])
def cancel_job(job_id: str) -> dict[str, object]:
    try:
        return job_manager.cancel_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found") from exc


@app.get("/api/jobs/{job_id}/events", dependencies=[Depends(require_admin_token)])
async def job_events(job_id: str) -> StreamingResponse:
    try:
        existing_events, _, _ = job_manager.snapshot_events(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found") from exc

    async def event_stream():
        # Send 2KB padding to flush browser/proxy buffers instantly
        yield ":" + " " * 2048 + "\n\n"

        sent_sequence = 0
        for event in existing_events:
            sent_sequence = int(event.get("_seq", sent_sequence))
            yield format_sse(event)
            if event.get("type") == "done":
                return

        while True:
            try:
                events, finished, sequence = job_manager.snapshot_events(job_id)
            except JobNotFoundError:
                return

            if finished and sequence <= sent_sequence:
                return

            try:
                sequence = await asyncio.to_thread(
                    job_manager.wait_for_event_sequence, job_id, sent_sequence, 10.0
                )
                events, finished, sequence = job_manager.snapshot_events(job_id)
            except JobNotFoundError:
                return

            if sequence <= sent_sequence:
                if finished:
                    return
                yield ": ping\n\n"
                continue

            for event in events:
                event_sequence = int(event.get("_seq", 0))
                if event_sequence <= sent_sequence:
                    continue
                sent_sequence = event_sequence
                yield format_sse(event)
                if event.get("type") == "done":
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


def frontend_dist_path() -> Path:
    project_root = Path(__file__).resolve().parents[2]
    return resolve_project_path(
        os.getenv("FRONTEND_DIST_PATH"),
        project_root / "frontend" / "out",
    )


_frontend_dist = frontend_dist_path()
if _frontend_dist.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=str(_frontend_dist), html=True),
        name="frontend",
    )
else:
    @app.get("/{frontend_path:path}", include_in_schema=False)
    def frontend_not_built(frontend_path: str) -> PlainTextResponse:
        if frontend_path == "api" or frontend_path.startswith("api/"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
        return PlainTextResponse("frontend build not found", status_code=503)
