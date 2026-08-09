from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .custom_intelligence_service import initialize_service as initialize_custom_intelligence
from .dashboard_data import prune_old_announcement_backups
from .routes.accounts import router as accounts_router
from .routes.ai import router as ai_router
from .routes.dashboard_data import router as dashboard_data_router
from .routes.datasets import router as datasets_router
from .routes.jobs import router as jobs_router
from .routes.custom_intelligence import router as custom_intelligence_router
from .runtime import announcement_response_cache, job_manager, session_tokens


if not settings.admin_password:
    print("Warning: ADMIN_PASSWORD is not set in the environment.")

app = FastAPI(title="Broker Announcement API")
try:
    initialize_custom_intelligence()
except Exception:  # noqa: BLE001 - an optional domain must not stop the core API
    logging.getLogger(__name__).exception(
        "Custom intelligence initialization failed; the core API will remain available"
    )
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=3)

# The pinned FastAPI/Starlette pair does not dispatch its deferred include
# wrapper. The domain routers already contain complete APIRoute instances.
for domain_router in (
    accounts_router,
    datasets_router,
    jobs_router,
    ai_router,
    dashboard_data_router,
    custom_intelligence_router,
):
    app.router.routes.extend(domain_router.routes)


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


def frontend_dist_path() -> Path:
    return settings.frontend_dist_path


class FrontendStaticFiles(StaticFiles):
    """Serve Next static-export pages at their extensionless browser URLs.

    Next's export writes page files such as ``app-updates.html`` while the
    client-side router navigates to ``/app-updates``.  The production nginx
    image already tries ``$uri.html``; the FastAPI-hosted local/development
    path needs the same fallback.
    """

    async def get_response(self, path: str, scope):  # type: ignore[no-untyped-def]
        response = await super().get_response(path, scope)
        if response.status_code != status.HTTP_404_NOT_FOUND or Path(path).suffix:
            return response
        normalized_path = path.rstrip("/")
        if not normalized_path:
            return response
        return await super().get_response(f"{normalized_path}.html", scope)


_frontend_dist = frontend_dist_path()
if _frontend_dist.is_dir():
    @app.get("/version.json", include_in_schema=False)
    def frontend_version() -> JSONResponse:
        version_file = _frontend_dist / "version.json"
        if version_file.is_file():
            try:
                payload = json.loads(version_file.read_text(encoding="utf-8"))
                if isinstance(payload, dict):
                    return JSONResponse(payload)
            except (OSError, ValueError, TypeError):
                logging.getLogger(__name__).warning("Unable to read frontend version file")

        version = os.getenv("BROKER_VERSION", "").strip() or os.getenv("NEXT_PUBLIC_APP_VERSION", "").strip()
        if not version:
            package_file = _frontend_dist.parent / "package.json"
            try:
                package = json.loads(package_file.read_text(encoding="utf-8"))
                if isinstance(package, dict):
                    version = str(package.get("version") or "").strip()
            except (OSError, ValueError, TypeError):
                version = ""
        return JSONResponse({"version": version or "开发版本", "git_sha": os.getenv("GIT_SHA", "")})

    app.mount(
        "/",
        FrontendStaticFiles(directory=str(_frontend_dist), html=True),
        name="frontend",
    )
else:

    @app.get("/{frontend_path:path}", include_in_schema=False)
    def frontend_not_built(frontend_path: str) -> PlainTextResponse:
        if frontend_path == "api" or frontend_path.startswith("api/"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
        return PlainTextResponse("frontend build not found", status_code=503)
