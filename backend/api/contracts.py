from __future__ import annotations

import re
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


AnalysisPerspective = Literal[
    "management",
    "product_business",
    "technology",
    "compliance_risk",
    "industry_research",
]
TimeRange = Literal["week", "month", "semiyear", "year"]
ReportType = Literal["management_brief", "competitive_analysis", "industry_trends", "risk_monitoring"]
AnalysisDepth = Literal["concise", "standard", "deep"]
SourcePreference = Literal["authoritative", "balanced", "news", "research"]


class IntelligenceConfigBase(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    description: str = Field(default="", max_length=2_000)
    keywords: list[str] = Field(default_factory=list, max_length=30)
    focus_objects: list[str] = Field(default_factory=list, max_length=20)
    analysis_perspective: AnalysisPerspective = "industry_research"
    time_range: TimeRange = "month"
    source_preference: SourcePreference = "balanced"
    specified_sites: list[str] = Field(default_factory=list, max_length=20)
    report_type: ReportType = "industry_trends"
    analysis_depth: AnalysisDepth = "standard"
    extra_requirements: str = Field(default="", max_length=2_000)

    @field_validator("keywords", "focus_objects", "specified_sites")
    @classmethod
    def normalize_list(cls, values: list[str]) -> list[str]:
        result: list[str] = []
        for value in values:
            item = str(value).strip()
            if item and item not in result:
                result.append(item)
        return result

    @field_validator("specified_sites")
    @classmethod
    def validate_sites(cls, values: list[str]) -> list[str]:
        import re

        normalized: list[str] = []
        for value in values:
            site = value.lower().strip()
            site = re.sub(r"^https?://", "", site).split("/", 1)[0]
            if not site or len(site) > 253 or "." not in site or any(ch.isspace() for ch in site):
                raise ValueError("specified_sites contains an invalid domain")
            if site not in normalized:
                normalized.append(site)
        return normalized


class IntelligenceTopicCreate(IntelligenceConfigBase):
    name: str = Field(min_length=1, max_length=120)


class IntelligenceTopicUpdate(IntelligenceConfigBase):
    name: str = Field(min_length=1, max_length=120)


class IntelligenceTopicEnabled(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class SearchServiceConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    enabled: bool
    model: str | None = Field(default=None, max_length=200)
    endpoint: str = Field(min_length=1, max_length=500)
    auth_header: str = Field(min_length=1, max_length=64)
    timeout_seconds: float = Field(default=120, ge=1, le=600)
    api_key: str | None = Field(default=None, max_length=1_000)

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not re.match(r"^https?://[^\s]+$", value, flags=re.IGNORECASE):
            raise ValueError("endpoint must be an HTTP or HTTPS URL")
        return value

    @field_validator("auth_header")
    @classmethod
    def validate_auth_header(cls, value: str) -> str:
        value = value.strip()
        if not value or re.search(r"[\r\n:]", value):
            raise ValueError("auth_header contains an invalid character")
        return value


class InstantSearchRequest(IntelligenceConfigBase):
    question: str = Field(default="", max_length=1_000)
    search_question: str | None = Field(default=None, max_length=1_000)
    query: str | None = Field(default=None, max_length=1_000)

    @model_validator(mode="after")
    def ensure_question(self) -> "InstantSearchRequest":
        alternate = (self.search_question or self.query or "").strip()
        if not self.question.strip() and not alternate:
            raise ValueError("question is required")
        if not self.question.strip() and alternate:
            self.question = alternate
        else:
            self.question = self.question.strip()
        return self


class KeywordSuggestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    description: str = Field(default="", max_length=2_000)
    keywords: list[str] = Field(default_factory=list, max_length=30)
    focus_objects: list[str] = Field(default_factory=list, max_length=20)
    analysis_perspective: AnalysisPerspective = "industry_research"
    max_suggestions: int = Field(default=8, ge=1, le=8)

    @field_validator("keywords", "focus_objects")
    @classmethod
    def normalize_suggestion_inputs(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(item.strip() for item in values if item and item.strip()))


class ExecutionListResponse(BaseModel):
    executions: list[dict[str, object]]
    meta: dict[str, object]


class IntelligenceDynamic(BaseModel):
    title: str = ""
    institutions: list[str] = Field(default_factory=list, max_length=20)
    information_time: str = ""
    summary: str = ""
    impact_analysis: str = ""
    event_tags: list[str] = Field(default_factory=list, max_length=20)
    source_ids: list[str] = Field(default_factory=list, max_length=30)


class IntelligenceFocusSection(BaseModel):
    title: str = ""
    items: list[str] = Field(default_factory=list, max_length=20)


class IntelligenceReport(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = "AI 自定义情报报告"
    question: str = ""
    executed_at: str = ""
    time_range: str = "month"
    valid_source_count: int = Field(default=0, ge=0)
    report_type: ReportType = "industry_trends"
    service: str = "baidu_qianfan"
    search_service: str = "baidu_web_search"
    analysis_service: str = "deepseek"
    request_id: str = ""
    is_fallback: bool = False
    core_conclusion: str = ""
    key_dynamics: list[IntelligenceDynamic] = Field(default_factory=list, max_length=30)
    impact_analysis: str = ""
    opportunities: list[str] = Field(default_factory=list, max_length=30)
    risks: list[str] = Field(default_factory=list, max_length=30)
    watch_items: list[str] = Field(default_factory=list, max_length=30)
    recommended_followups: list[str] = Field(default_factory=list, max_length=20)
    focus_sections: list[IntelligenceFocusSection] = Field(default_factory=list, max_length=6)


@dataclass(slots=True)
class PublishPlan:
    fieldnames: list[str]
    records: list[dict[str, str]]
    meta: dict[str, object]
