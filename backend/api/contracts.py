from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class LoginRequest(BaseModel):
    username: str
    password: str
    visitor_id: str | None = None
    source: str | None = None


class VerifyPasswordRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str
    name: str
    role: str
    is_admin: bool


class AdminUserCreateRequest(BaseModel):
    name: str
    email: str
    department: str


class UserApplyRequest(BaseModel):
    name: str
    email: str
    department: str
    visitor_id: str | None = None
    source: str | None = None


class QrVisitRequest(BaseModel):
    visitor_id: str
    source: str


class DashboardViewRequest(BaseModel):
    visitor_id: str | None = None
    source: str | None = None


class FeedbackCreateRequest(BaseModel):
    category: str
    broker_name: str = ""
    message: str = ""
    related_context: str = ""


class FeedbackStatusUpdateRequest(BaseModel):
    status: str


class LlmJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: str = "incremental"
    overwrite: bool = False


TimeRange = Literal["week", "month", "semiyear", "year"]
ReportItemType = Literal["fact", "analysis", "recommendation"]
AssistantAudience = Literal[
    "management",
    "business_product",
    "technology",
    "compliance_risk",
    "industry_research",
    "custom",
]
ReportLength = Literal["concise", "standard", "deep"]


class SearchServiceConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    enabled: bool
    timeout_seconds: float = Field(default=120, ge=1, le=600)
    api_key: str | None = Field(default=None, max_length=1_000)


class InstantSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    audience: AssistantAudience
    audience_detail: str = Field(default="", max_length=2_000)
    focus_tags: list[str] = Field(default_factory=list, max_length=3)
    focus: str = Field(min_length=1, max_length=1_000)
    extra_focus: str = Field(default="", max_length=2_000)
    time_range: TimeRange = "month"
    report_length: ReportLength = "standard"

    @field_validator("focus_tags")
    @classmethod
    def normalize_focus_tags(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))

    @model_validator(mode="after")
    def ensure_question(self) -> "InstantSearchRequest":
        if self.audience == "custom" and not self.audience_detail.strip():
            raise ValueError("audience_detail is required for custom audience")
        return self


class ExecutionListResponse(BaseModel):
    executions: list[dict[str, object]]
    meta: dict[str, object]


class IntelligenceReportItem(BaseModel):
    """A grounded V2 report item.

    The service performs the source-id validity check because it owns the
    canonical/alias mapping. Recommendations may intentionally have no source
    ids; factual and analytical items are filtered before persistence when
    they cannot be grounded.
    """

    model_config = ConfigDict(extra="ignore")

    type: ReportItemType = "analysis"
    text: str = ""
    source_ids: list[str] = Field(default_factory=list, max_length=30)


class IntelligenceReport(BaseModel):
    """Report V2 wire shape consumed by web, PDF and mail renderers."""

    model_config = ConfigDict(extra="ignore")

    version: Literal[2] = 2
    title: str = "AI 自定义情报报告"
    audience: str = ""
    executed_at: str = ""
    time_range: str = "month"
    report_length: str = "standard"
    core_judgment: list[IntelligenceReportItem] = Field(default_factory=list, max_length=30)
    key_developments: list[IntelligenceReportItem] = Field(default_factory=list, max_length=30)
    impact_analysis: list[IntelligenceReportItem] = Field(default_factory=list, max_length=30)
    company_implications: list[IntelligenceReportItem] = Field(default_factory=list, max_length=30)
    risks_and_watch_items: list[IntelligenceReportItem] = Field(default_factory=list, max_length=30)
    reference_warnings: list[str] = Field(default_factory=list, max_length=30)


@dataclass(slots=True)
class PublishPlan:
    fieldnames: list[str]
    records: list[dict[str, str]]
    meta: dict[str, object]
