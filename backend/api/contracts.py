from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict


class LoginRequest(BaseModel):
    username: str
    password: str
    visitor_id: str | None = None
    source: str | None = None


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


@dataclass(slots=True)
class PublishPlan:
    fieldnames: list[str]
    records: list[dict[str, str]]
    meta: dict[str, object]
