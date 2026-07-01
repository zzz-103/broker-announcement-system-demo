from __future__ import annotations

import asyncio
import csv
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .job_manager import JobConflictError, JobManager, JobNotFoundError, format_sse


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str


job_manager = JobManager()
session_tokens: set[str] = set()

app = FastAPI(title="Broker Announcement API")

frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    if token not in session_tokens:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def resolve_project_path(value: str | None, default: Path) -> Path:
    project_root = Path(__file__).resolve().parents[2]
    path = Path(value) if value else default
    if not path.is_absolute():
        path = project_root / path
    return path.resolve()


@app.post("/api/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    expected_username = os.getenv("ADMIN_USERNAME", "admin")
    expected_password = os.getenv("ADMIN_PASSWORD", "change-me")
    username_ok = secrets.compare_digest(payload.username, expected_username)
    password_ok = secrets.compare_digest(payload.password, expected_password)
    if not (username_ok and password_ok):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    token = secrets.token_urlsafe(32)
    session_tokens.add(token)
    return LoginResponse(token=token)


@app.post("/api/jobs/scraper", dependencies=[Depends(require_token)])
def start_scraper() -> dict[str, str]:
    try:
        job = job_manager.start_scraper()
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"job_id": job.job_id, "job_type": job.job_type, "status": job.status}


@app.post("/api/jobs/llm", dependencies=[Depends(require_token)])
def start_llm() -> dict[str, str]:
    try:
        job = job_manager.start_llm()
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"job_id": job.job_id, "job_type": job.job_type, "status": job.status}


@app.get("/api/data/announcements", dependencies=[Depends(require_token)])
def get_announcements() -> dict[str, object]:
    project_root = Path(__file__).resolve().parents[2]
    csv_path = resolve_project_path(
        os.getenv("ANNOUNCEMENT_CSV_PATH"),
        project_root / "backend" / "data" / "announcement_table.csv",
    )

    if not csv_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="announcement data has not been generated; run scraper and LLM first",
        )

    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            records = list(reader)
    except csv.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"failed to parse announcement CSV: {exc}",
        ) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to read announcement data",
        ) from exc

    updated_at = datetime.fromtimestamp(csv_path.stat().st_mtime, timezone.utc).isoformat()
    return {
        "records": records,
        "meta": {
            "count": len(records),
            "updated_at": updated_at,
        },
    }


@app.get("/api/jobs/{job_id}", dependencies=[Depends(require_token)])
def get_job(job_id: str) -> dict[str, object]:
    try:
        return job_manager.get_job(job_id).to_dict()
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found") from exc


@app.get("/api/jobs/{job_id}/events", dependencies=[Depends(require_token)])
async def job_events(job_id: str) -> StreamingResponse:
    try:
        existing_events, _, _ = job_manager.snapshot_events(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found") from exc

    async def event_stream():
        sent_sequence = 0
        for event in existing_events:
            sent_sequence = int(event.get("_seq", sent_sequence))
            yield format_sse(event)
            if event.get("type") == "done":
                return

        while True:
            try:
                sequence = await asyncio.to_thread(
                    job_manager.wait_for_event_sequence, job_id, sent_sequence, 10.0
                )
                events, _, _ = job_manager.snapshot_events(job_id)
            except JobNotFoundError:
                return

            if sequence <= sent_sequence:
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
