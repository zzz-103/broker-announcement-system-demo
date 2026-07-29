"""Minimal FastAPI application, kept independent from collection orchestration."""

from typing import Any

from fastapi import FastAPI


app = FastAPI(title="Broker App Watch", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/releases")
def list_releases() -> list[dict[str, Any]]:
    """Reserved endpoint; repository-backed queries will be added later."""

    return []
