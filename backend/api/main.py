from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .dashboard_data import prune_old_announcement_backups
from .routes.accounts import router as accounts_router
from .routes.ai import router as ai_router
from .routes.dashboard_data import router as dashboard_data_router
from .routes.datasets import router as datasets_router
from .routes.jobs import router as jobs_router
from .runtime import announcement_response_cache, job_manager, session_tokens


if not settings.admin_password:
    print("Warning: ADMIN_PASSWORD is not set in the environment.")

app = FastAPI(title="Broker Announcement API")
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
for domain_router in (accounts_router, datasets_router, jobs_router, ai_router, dashboard_data_router):
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
