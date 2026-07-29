from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..ai_analysis import (
    AiAnalysisError,
    generate_ai_analysis,
    load_cached_analysis,
    to_http_exception,
)
from ..auth import require_admin_token, require_token
from ..job_manager import JobConflictError
from ..runtime import job_manager


router = APIRouter()


@router.get("/api/ai-analysis", dependencies=[Depends(require_token)])
def get_ai_analysis() -> dict[str, object]:
    try:
        return load_cached_analysis()
    except AiAnalysisError as exc:
        raise to_http_exception(exc) from exc


@router.post("/api/ai-analysis", dependencies=[Depends(require_admin_token)])
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
