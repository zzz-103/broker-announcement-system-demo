"""Stable application data models independent of a database library."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


APP_RELEASE_CSV_COLUMNS = (
    "broker_code",
    "broker_name",
    "app_name",
    "source_url",
    "content_sha256",
    "crawl_time",
    "markdown_file",
    "processed_at",
    "app_version",
    "platform",
    "publish_date",
    "update_type",
    "update_summary",
    "feature_tags",
    "highlights",
)


class AppReleaseAnalysis(BaseModel):
    """One LLM-produced App update item.

    The fields intentionally mirror the frontend's CSV contract. Source and
    processing metadata are added by the refresh pipeline, not guessed by the
    model.
    """

    model_config = ConfigDict(extra="ignore")

    app_name: str = ""
    app_version: str = ""
    platform: str = "未知"
    publish_date: str = ""
    update_type: str = "其他"
    update_summary: str = ""
    feature_tags: list[str] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)

    @field_validator("app_name", "app_version", "platform", "publish_date", "update_type", "update_summary", mode="before")
    @classmethod
    def coerce_text(cls, value: object) -> str:
        return "" if value is None else str(value).strip()

    @field_validator("feature_tags", "highlights", mode="before")
    @classmethod
    def coerce_list(cls, value: object) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        text = str(value).strip()
        return [text] if text else []


class AppReleaseAnalysisResponse(BaseModel):
    """Accepted JSON envelope returned by the App Watch LLM."""

    model_config = ConfigDict(extra="forbid")

    releases: list[AppReleaseAnalysis]


class AppReleaseRow(BaseModel):
    """A complete row exported for ``GET /api/app-releases``."""

    model_config = ConfigDict(extra="forbid")

    broker_code: str = ""
    broker_name: str = ""
    app_name: str = ""
    source_url: str = ""
    content_sha256: str = ""
    crawl_time: str = ""
    markdown_file: str = ""
    processed_at: str = ""
    app_version: str = ""
    platform: str = "未知"
    publish_date: str = ""
    update_type: str = "其他"
    update_summary: str = ""
    feature_tags: list[str] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)
