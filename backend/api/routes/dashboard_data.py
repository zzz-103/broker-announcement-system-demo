from __future__ import annotations

import hashlib
import json
import csv

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response, status

from ..auth import require_admin_token, require_token
from ..contracts import DashboardDataSourceRequest
from ..dashboard_package import PACKAGE_FILES, dashboard_package_builder, package_zip_bytes
from ..dashboard_package_import import (
    DashboardPackageImportError,
    compare_import_warnings,
    persist_imported,
    resolve_active_package,
    source_status,
    validate_zip_bytes,
    write_preference,
    imported_package_store,
)
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


def _active_package():
    try:
        live = _build_package()
    except HTTPException:
        live = None
    package, source = resolve_active_package(live)
    if package is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="当前没有可用的看板数据包")
    return package


def _json_response(request: Request, body: bytes) -> Response:
    etag = f'W/"{hashlib.sha256(body).hexdigest()}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if request.headers.get("if-none-match", "").removeprefix("W/") == etag.removeprefix("W/"):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


@router.get("/api/dashboard-data/manifest", dependencies=[Depends(require_token)])
def get_dashboard_manifest(request: Request) -> Response:
    package = _active_package()
    return _json_response(request, package.body("manifest"))


@router.get("/api/dashboard-data/files/{dataset}", dependencies=[Depends(require_token)])
def get_dashboard_dataset(dataset: str, request: Request) -> Response:
    if dataset not in DATASET_KEYS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="dashboard dataset not found")
    package = _active_package()
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


@router.get("/api/dashboard-data/source", dependencies=[Depends(require_admin_token)])
def get_dashboard_source() -> dict[str, object]:
    try:
        live = _build_package()
    except HTTPException:
        live = None
    return source_status(live)


@router.post("/api/dashboard-data/source", dependencies=[Depends(require_admin_token)])
def set_dashboard_source(payload: DashboardDataSourceRequest) -> dict[str, object]:
    try:
        job_manager.acquire_operation("dashboard_import")
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    try:
        try:
            live = _build_package()
        except HTTPException:
            live = None
        _, current = resolve_active_package(live)
        selected = current["sources"].get(payload.source, {})
        if selected.get("available") is not True:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="所选看板数据源当前不可用")
        write_preference(payload.source)
        imported_package_store.invalidate()
        return source_status(live)
    except DashboardPackageImportError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="看板数据源偏好保存失败") from exc
    finally:
        job_manager.release_operation("dashboard_import")


def _raw_zip_body(body: bytes) -> bytes:
    if not isinstance(body, bytes):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="导入请求体必须是 ZIP 二进制内容")
    if len(body) > 64 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="导入 ZIP 超过大小限制")
    return body


@router.post("/api/dashboard-data/import/preview", dependencies=[Depends(require_admin_token)])
def preview_dashboard_import(body: bytes = Body(..., media_type="application/zip")) -> dict[str, object]:
    try:
        validated = validate_zip_bytes(_raw_zip_body(body))
    except DashboardPackageImportError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    try:
        active = _active_package()
    except HTTPException:
        active = None
    warnings = list(validated.warnings)
    warnings.extend(compare_import_warnings(validated.package, active))
    return {
        "valid": True,
        "manifest": validated.package.manifest,
        "warnings": warnings,
        "matching_baseline_available": validated.matching_baseline is not None,
    }


@router.post("/api/dashboard-data/import", dependencies=[Depends(require_admin_token)])
def import_dashboard_data(body: bytes = Body(..., media_type="application/zip")) -> dict[str, object]:
    try:
        job_manager.acquire_operation("dashboard_import")
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    try:
        try:
            raw_body = _raw_zip_body(body)
            candidate = validate_zip_bytes(raw_body)
            try:
                active_before_import = _active_package()
            except HTTPException:
                active_before_import = None
            warnings = list(candidate.warnings)
            warnings.extend(compare_import_warnings(candidate.package, active_before_import))
            validated = persist_imported(raw_body)
            imported_package_store.invalidate()
            try:
                live = _build_package()
            except HTTPException:
                live = None
            source = source_status(live)
        except DashboardPackageImportError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        except (OSError, UnicodeError, ValueError, TypeError, KeyError, csv.Error) as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="导入数据包保存失败") from exc
        return {
            "message": "看板数据包导入成功",
            "manifest": validated.package.manifest,
            "warnings": warnings,
            "source": source,
            "matching_baseline_restored": validated.matching_baseline is not None,
        }
    finally:
        job_manager.release_operation("dashboard_import")


@router.post("/api/dashboard-data/export", dependencies=[Depends(require_admin_token)])
def export_dashboard_data() -> dict[str, object]:
    try:
        job_manager.acquire_operation("dashboard_export")
    except JobConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    try:
        try:
            package = _active_package()
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
            package = _active_package()
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
