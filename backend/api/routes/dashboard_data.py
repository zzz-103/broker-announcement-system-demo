from __future__ import annotations

import hashlib
import json
import csv

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from ..auth import require_admin_token, require_token
from ..dashboard_package import PACKAGE_FILES, dashboard_package_builder, package_zip_bytes
from ..job_manager import JobConflictError
from ..runtime import job_manager


router = APIRouter()
DATASET_KEYS = frozenset(PACKAGE_FILES)
PACKAGE_ERRORS = (OSError, UnicodeError, ValueError, TypeError, KeyError, csv.Error)


def _build_package():
    try:
        return dashboard_package_builder.build()
    except PACKAGE_ERRORS as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="标准化看板数据暂时无法读取，请检查数据文件") from exc


def _json_response(request: Request, body: bytes) -> Response:
    etag = f'W/"{hashlib.sha256(body).hexdigest()}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if request.headers.get("if-none-match", "").removeprefix("W/") == etag.removeprefix("W/"):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


@router.get("/api/dashboard-data/manifest", dependencies=[Depends(require_token)])
def get_dashboard_manifest(request: Request) -> Response:
    package = _build_package()
    return _json_response(request, package.body("manifest"))


@router.get("/api/dashboard-data/files/{dataset}", dependencies=[Depends(require_token)])
def get_dashboard_dataset(dataset: str, request: Request) -> Response:
    if dataset not in DATASET_KEYS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="dashboard dataset not found")
    package = _build_package()
    return _json_response(request, package.body(dataset))


@router.get("/api/dashboard-data/export-status", dependencies=[Depends(require_admin_token)])
def get_dashboard_export_status() -> dict[str, object]:
    manifest_path = dashboard_package_builder.export_manifest_path()
    if not manifest_path.exists():
        return {"exported": False, "manifest": None}
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"exported": False, "manifest": None, "error": "导出目录中的 Manifest 无法解析"}
    return {"exported": True, "manifest": manifest}


@router.post("/api/dashboard-data/export", dependencies=[Depends(require_admin_token)])
def export_dashboard_data() -> dict[str, object]:
    try:
        job_manager.acquire_operation("dashboard_export")
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    try:
        try:
            package = dashboard_package_builder.build(force=True)
            dashboard_package_builder.export(package)
        except PACKAGE_ERRORS as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="前端数据包生成失败，请检查正式数据文件") from exc
        return {
            "message": "前端数据包导出成功",
            "manifest": package.manifest,
            "download_url": "/api/dashboard-data/export.zip",
        }
    finally:
        job_manager.release_operation("dashboard_export")


@router.get("/api/dashboard-data/export.zip", dependencies=[Depends(require_admin_token)])
def download_dashboard_data() -> Response:
    try:
        job_manager.acquire_operation("dashboard_export")
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    try:
        try:
            package = dashboard_package_builder.build()
            dashboard_package_builder.export(package)
        except PACKAGE_ERRORS as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="前端数据包生成失败，请检查正式数据文件") from exc
        return Response(
            content=package_zip_bytes(package),
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="dashboard-data.zip"'},
        )
    finally:
        job_manager.release_operation("dashboard_export")
