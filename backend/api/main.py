from __future__ import annotations

import asyncio
import csv
import os
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .ai_analysis import (
    AiAnalysisError,
    generate_ai_analysis,
    load_cached_analysis,
    to_http_exception,
)
from .job_manager import JobConflictError, JobManager, JobNotFoundError, format_sse
from .user_store import (
    DuplicateUserError,
    InvalidUserCredentialsError,
    UserNotFoundError,
    UserStoreError,
    authenticate_user,
    create_user,
    delete_user,
    list_users,
    normalize_email,
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

if not admin_password:
    print("Warning: ADMIN_PASSWORD is not set in the environment.")
else:
    print(f"Admin username set to: {admin_username}")


class LoginRequest(BaseModel):
    username: str
    password: str


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


job_manager = JobManager()
session_tokens: dict[str, dict[str, str | bool]] = {}
ANNOUNCEMENT_REQUIRED_HEADERS = {"broker_name", "project_name", "publish_date"}

app = FastAPI(title="Broker Announcement API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


def get_session(authorization: Annotated[str | None, Header()] = None) -> dict[str, str | bool]:
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


def validate_publishable_csv(path: Path) -> tuple[list[dict[str, str]], int]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            fieldnames = [name.strip() for name in (reader.fieldnames or []) if name and name.strip()]
            if not fieldnames:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="staging announcement CSV is missing headers",
                )
            missing_headers = sorted(ANNOUNCEMENT_REQUIRED_HEADERS - set(fieldnames))
            if missing_headers:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="staging announcement CSV is missing required headers",
                )
            records = [
                row
                for row in reader
                if any(str(value or "").strip() for value in row.values())
            ]
    except csv.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="staging announcement CSV is invalid",
        ) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to read staging announcement CSV",
        ) from exc

    if not records:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="staging announcement CSV does not contain valid records",
        )
    return records, len(records)


def publish_csv_atomically(source_path: Path, target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.with_name(
        f".{target_path.stem}.{os.getpid()}.publish.tmp{target_path.suffix}"
    )
    try:
        with source_path.open("rb") as source_file, temp_path.open("wb") as temp_file:
            shutil.copyfileobj(source_file, temp_file)
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


@app.post("/api/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
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
        }
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
    }
    return LoginResponse(
        token=token,
        username=user.username,
        name=user.name,
        role="user",
        is_admin=False,
    )


@app.post("/api/jobs/scraper", dependencies=[Depends(require_admin_token)])
def start_scraper() -> dict[str, str]:
    try:
        job = job_manager.start_scraper()
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"job_id": job.job_id, "job_type": job.job_type, "status": job.status}


@app.post("/api/jobs/llm", dependencies=[Depends(require_admin_token)])
def start_llm() -> dict[str, str]:
    try:
        job = job_manager.start_llm()
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"job_id": job.job_id, "job_type": job.job_type, "status": job.status}


@app.get("/api/data/announcements", dependencies=[Depends(require_token)])
def get_announcements() -> dict[str, object]:
    csv_path = announcement_csv_path()

    if not csv_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="announcement data has not been generated; run scraper and LLM first",
        )

    _, records = read_announcement_csv(csv_path)

    updated_at = datetime.fromtimestamp(csv_path.stat().st_mtime, timezone.utc).isoformat()
    return {
        "records": records,
        "meta": {
            "count": len(records),
            "updated_at": updated_at,
        },
    }


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

        records, count = validate_publishable_csv(staging_path)
        publish_csv_atomically(staging_path, target_path)

        published_at = datetime.now(timezone.utc).isoformat()
        updated_at = datetime.fromtimestamp(target_path.stat().st_mtime, timezone.utc).isoformat()
        return {
            "message": "推送成功",
            "meta": {
                "count": count,
                "published_at": published_at,
                "updated_at": updated_at,
            },
        }
    finally:
        job_manager.release_operation("publish")


@app.get("/api/admin/users", dependencies=[Depends(require_admin_token)])
def get_admin_users() -> dict[str, object]:
    try:
        users = [user.to_dict() for user in list_users()]
    except UserStoreError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to load approved users",
        ) from exc
    return {"users": users}


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
        return job_manager.get_job(job_id).to_dict()
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found") from exc


@app.post("/api/jobs/{job_id}/cancel", dependencies=[Depends(require_admin_token)])
def cancel_job(job_id: str) -> dict[str, str]:
    try:
        job_manager.cancel_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found") from exc
    return {"status": "cancelling"}


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
