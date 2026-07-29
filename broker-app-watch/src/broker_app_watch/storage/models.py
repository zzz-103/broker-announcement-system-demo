"""Stable application data models independent of a database library."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ReleaseRecord(BaseModel):
    """Normalized App release record."""

    model_config = ConfigDict(extra="forbid")

    broker_code: str
    app_name: str
    version: str | None = None
    title: str
    content: str
    published_at: str | None = None
    collected_at: datetime | None = None
    source_url: str | None = None
