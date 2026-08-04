from __future__ import annotations

import asyncio
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse

from ..auth import require_admin_token
from ..config import settings
from ..contracts import LlmJobRequest
from ..job_manager import JobConflictError, JobNotFoundError, JobStartError, format_sse
from ..runtime import job_manager


router = APIRouter()


def _started_job(job: object) -> dict[str, str]:
    return {
        "job_id": str(getattr(job, "job_id")),
        "job_type": str(getattr(job, "job_type")),
        "status": str(getattr(job, "status")),
    }


def _start(start_job) -> dict[str, str]:
    try:
        return _started_job(start_job())
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


def _require_scheduler_token(value: str | None) -> None:
    expected_token = settings.scheduler_token
    provided = (value or "").strip()
    if not expected_token:
        raise HTTPException(status_code=401, detail="scheduler token not configured")
    if not provided or not secrets.compare_digest(provided, expected_token):
        raise HTTPException(status_code=401, detail="invalid scheduler token")


@router.post("/api/jobs/scraper", dependencies=[Depends(require_admin_token)])
def start_scraper() -> dict[str, str]:
    return _start(job_manager.start_scraper)


@router.post("/api/jobs/llm", dependencies=[Depends(require_admin_token)])
def start_llm(payload: LlmJobRequest | None = None) -> dict[str, str]:
    mode = (payload.mode if payload else "incremental").strip()
    overwrite = bool(payload.overwrite) if payload else False
    if mode not in {"incremental", "full_refresh"}:
        raise HTTPException(status_code=422, detail="invalid LLM mode")
    if mode == "incremental" and overwrite:
        raise HTTPException(status_code=422, detail="overwrite is only allowed for full_refresh mode")
    if mode == "full_refresh" and not overwrite:
        raise HTTPException(status_code=422, detail="full_refresh mode requires overwrite=true")
    return _start(lambda: job_manager.start_llm(mode=mode, overwrite=overwrite))


@router.post("/api/jobs/llm-external", dependencies=[Depends(require_admin_token)])
def start_llm_external() -> dict[str, str]:
    return _start(job_manager.start_llm_external)


@router.post("/api/jobs/pipeline", dependencies=[Depends(require_admin_token)])
def start_pipeline() -> dict[str, str]:
    return _start(job_manager.start_pipeline)


@router.post("/api/jobs/app-watch", dependencies=[Depends(require_admin_token)])
def start_app_watch() -> dict[str, str]:
    try:
        return _start(job_manager.start_app_watch)
    except JobStartError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.post("/api/internal/scheduled-pipeline")
def scheduled_pipeline(
    x_scheduler_token: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    _require_scheduler_token(x_scheduler_token)
    return _start(job_manager.start_pipeline)


@router.post("/api/internal/scheduled-app-watch")
def scheduled_app_watch(
    x_scheduler_token: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    _require_scheduler_token(x_scheduler_token)
    try:
        return _start(job_manager.start_app_watch)
    except JobStartError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@router.get("/api/jobs/{job_id}", dependencies=[Depends(require_admin_token)])
def get_job(job_id: str) -> dict[str, object]:
    try:
        return job_manager.get_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="job not found") from exc


@router.post("/api/jobs/{job_id}/cancel", dependencies=[Depends(require_admin_token)])
def cancel_job(job_id: str) -> dict[str, object]:
    try:
        return job_manager.cancel_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="job not found") from exc


@router.get("/api/jobs/{job_id}/events", dependencies=[Depends(require_admin_token)])
async def job_events(job_id: str) -> StreamingResponse:
    try:
        existing_events, _, _ = job_manager.snapshot_events(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="job not found") from exc

    async def event_stream():
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
                    job_manager.wait_for_event_sequence,
                    job_id,
                    sent_sequence,
                    10.0,
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
