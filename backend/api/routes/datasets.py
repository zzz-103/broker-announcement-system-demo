from __future__ import annotations

import csv
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status

from ..announcement_cache import accepts_gzip, etag_matches
from ..auth import require_admin_token, require_token
from ..config import settings
from ..publication_service import PublicationError, publish_merged_announcements
from ..job_manager import JobConflictError
from ..runtime import announcement_response_cache, job_manager
from ..supplemental_seed import SupplementalDataError


router = APIRouter()

DASHBOARD_ANNOUNCEMENT_FIELDS = (
    "broker_folder",
    "markdown_file",
    "document_sha1",
    "processed_at",
    "raw_json_path",
    "broker_name",
    "is_broker_project",
    "publish_date",
    "announcement_stage",
    "procurement_category",
    "project_subcategory",
    "project_name",
    "procurement_method",
    "procurement_action",
    "procurement_scope_summary",
    "budget_amount_yuan",
    "winning_amount_yuan",
    "winning_supplier",
    "winner",
    "winner_candidates",
    "winning_amount",
    "source",
    "data_source",
)


def announcement_csv_path() -> Path:
    return settings.announcement_csv_path


def app_releases_csv_path() -> Path:
    return settings.app_releases_csv_path


def _cached_csv_response(request: Request, path: Path, projection: tuple[str, ...] | None = None) -> Response:
    try:
        cached = announcement_response_cache.get(path, projection)
    except (csv.Error, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to read dashboard data",
        ) from exc

    headers = {
        "ETag": cached.etag,
        "Vary": "Accept-Encoding",
        "Cache-Control": "private, no-cache",
    }
    if etag_matches(request.headers.get("if-none-match"), cached.etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    if accepts_gzip(request.headers.get("accept-encoding")):
        headers["Content-Encoding"] = "gzip"
        body = cached.gzip_body
    else:
        body = cached.raw_body
    return Response(content=body, media_type="application/json", headers=headers)


@router.get("/api/data/announcements", dependencies=[Depends(require_token)])
def get_announcements(
    request: Request,
    view: str = Query(default="full", pattern="^(full|dashboard)$"),
) -> Response:
    path = announcement_csv_path()
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="announcement data has not been generated; run scraper and LLM first",
        )
    projection = DASHBOARD_ANNOUNCEMENT_FIELDS if view == "dashboard" else None
    return _cached_csv_response(request, path, projection)


@router.get("/api/app-releases", dependencies=[Depends(require_token)])
def get_app_releases(request: Request) -> Response:
    path = app_releases_csv_path()
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="app release data has not been generated; run the app-watch job first",
        )
    return _cached_csv_response(request, path)


@router.post("/api/data/announcements/publish", dependencies=[Depends(require_admin_token)])
def publish_announcements() -> dict[str, object]:
    try:
        job_manager.acquire_operation("publish")
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    try:
        target_path = announcement_csv_path()
        try:
            meta = publish_merged_announcements()
        except FileNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except SupplementalDataError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
        except PublicationError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
        announcement_response_cache.invalidate(target_path)
        return {"message": "推送成功", "meta": meta}
    finally:
        job_manager.release_operation("publish")
