"""Admin-only models and helpers for custom intelligence service settings."""

from __future__ import annotations

import secrets
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..llm_table.llm_client import (
    LLMApiConfig,
    OpenAICompatibleClient,
    parse_json_text,
    resolve_llm_override_path,
    write_llm_config_override,
)
from .config import settings
from .contracts import AssistantAudience, ReportLength, TimeRange
from .service_url import service_url_port, service_url_with_port


class IntelligenceTopicCreateCompat(BaseModel):
    """Public V2 saved-assistant input; legacy columns are read-only migration data."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=120)
    audience: AssistantAudience
    audience_detail: str = Field(default="", max_length=2_000)
    focus_tags: list[str] = Field(default_factory=list, max_length=8)
    focus: str = Field(min_length=1, max_length=1_000)
    extra_focus: str = Field(default="", max_length=2_000)
    time_range: TimeRange = "month"
    report_length: ReportLength = "standard"

    @field_validator("focus_tags")
    @classmethod
    def normalize_focus_tags(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))[:8]

    @model_validator(mode="after")
    def validate_v2_assistant(self) -> "IntelligenceTopicCreateCompat":
        if self.audience == "custom" and not self.audience_detail.strip():
            raise ValueError("audience_detail is required for custom audience")
        return self


class IntelligenceTopicUpdateCompat(IntelligenceTopicCreateCompat):
    """Saved-assistant updates use the same exact V2 shape as creates."""


class AdminPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    password: str = Field(min_length=1, max_length=1_000)


class DeepSeekConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    enabled: bool = True
    base_url: str = Field(default="", max_length=1_000)
    port: int | None = Field(default=None, ge=1, le=65_535)
    model: str = Field(default="", max_length=300)
    api_key: str | None = Field(default=None, max_length=2_000)
    temperature: float = Field(default=0.1, ge=0, le=2)
    top_p: float = Field(default=1, ge=0, le=1)
    max_tokens: int = Field(default=16_384, ge=1, le=1_000_000)
    timeout_seconds: int = Field(default=180, ge=1, le=600)
    use_json_object: bool = True


class SMTPConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    enabled: bool = False
    host: str | None = Field(default=None, max_length=253)
    port: int | None = Field(default=None, ge=1, le=65_535)
    use_ssl: bool | None = None
    username: str = Field(default="", max_length=320)
    from_address: str = Field(default="", max_length=320)
    authorization_code: str | None = Field(default=None, max_length=1_000)
    timeout_seconds: float = Field(default=30, ge=1, le=180)


class DefaultRulesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    analysis_instructions: str = Field(default="", max_length=4_000)


class EmailDeliveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    recipients: list[str] = Field(min_length=1, max_length=5)
    note: str = Field(default="", max_length=500)
    delivery_format: Literal["html_pdf", "html_only", "pdf_only"] = "html_pdf"
    template_style: Literal["research", "newsletter"] = "research"
    # Compatibility field for clients that used the old mutually exclusive
    # selector. It is mapped to html_only/pdf_only by the route.
    format: Literal["html", "pdf"] | None = None
    external_confirmed: bool = False


def resolve_email_delivery_format(payload: EmailDeliveryRequest) -> Literal["html_pdf", "html_only", "pdf_only"]:
    """Map legacy ``format`` only when the new selector stayed at its default."""

    if payload.delivery_format == "html_pdf" and payload.format in {"html", "pdf"}:
        return "html_only" if payload.format == "html" else "pdf_only"
    return payload.delivery_format


def verify_admin_password(password: str) -> bool:
    expected = settings.admin_password
    return bool(expected and secrets.compare_digest(password, expected))


def _config_payload(config: LLMApiConfig) -> dict[str, object]:
    return {
        "base_url": config.base_url,
        "api_key": config.api_key,
        "model": config.model,
        "temperature": config.temperature,
        "top_p": config.top_p,
        "max_tokens": config.max_tokens,
        "frequency_penalty": config.frequency_penalty,
        "presence_penalty": config.presence_penalty,
        "timeout_seconds": config.timeout_seconds,
        "use_json_object": config.use_json_object,
    }


def _load_effective_llm_config() -> tuple[LLMApiConfig | None, Path | None, str | None]:
    path = settings.llm_config_path
    try:
        override = resolve_llm_override_path()
        source = override if override.exists() else path
        config = LLMApiConfig.load(path)
        return config, source, "override" if source == override else "fallback"
    except (OSError, ValueError, TypeError, KeyError, FileNotFoundError):
        return None, None, None


def public_deepseek_config() -> dict[str, object]:
    config, source, source_kind = _load_effective_llm_config()
    if config is None:
        return {
            "enabled": False,
            "base_url": "",
            "port": 443,
            "model": "",
            "temperature": 0.1,
            "top_p": 1.0,
            "max_tokens": 16_384,
            "timeout_seconds": 180,
            "use_json_object": True,
            "api_key_mask": "",
            "has_api_key": False,
            "config_source": "not_configured",
        }
    try:
        config.validate()
        configured = True
    except ValueError:
        configured = False
    return {
        "enabled": configured,
        "base_url": config.base_url,
        "port": service_url_port(config.base_url),
        "model": config.model,
        "api_key_mask": _mask_secret(config.api_key),
        "has_api_key": bool(config.api_key),
        "temperature": config.temperature,
        "top_p": config.top_p,
        "max_tokens": config.max_tokens,
        "timeout_seconds": config.timeout_seconds,
        "use_json_object": config.use_json_object,
        "config_source": source_kind or (str(source) if source else "unknown"),
    }


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    return f"{value[:2]}{'•' * 14}" if len(value) > 2 else "••••••••••••••••"


def save_deepseek_config(payload: DeepSeekConfigUpdate) -> dict[str, object]:
    current, _, _ = _load_effective_llm_config()
    base = _config_payload(current) if current is not None else {}
    api_key = (payload.api_key or "").strip()
    if not api_key or "••" in api_key:
        api_key = str(base.get("api_key") or "")
    if payload.enabled and not api_key:
        raise ValueError("DeepSeek API Key 不能为空")
    base_url = payload.base_url.strip() or str(base.get("base_url") or "")
    if base_url:
        base_url = service_url_with_port(base_url, payload.port or service_url_port(base_url))
    data = {
        **base,
        "base_url": base_url,
        "model": payload.model.strip() or str(base.get("model") or ""),
        "api_key": api_key,
        "temperature": payload.temperature,
        "top_p": payload.top_p,
        "max_tokens": payload.max_tokens,
        "timeout_seconds": payload.timeout_seconds,
        "use_json_object": payload.use_json_object,
    }
    if payload.enabled and (not data["base_url"] or not data["model"]):
        raise ValueError("DeepSeek base_url 和 model 不能为空")
    LLMApiConfig(**data).validate()
    write_llm_config_override(data)
    return public_deepseek_config()


def reveal_deepseek_key(password: str) -> str:
    if not verify_admin_password(password):
        raise PermissionError("管理员密码不正确")
    config, _, _ = _load_effective_llm_config()
    if config is None:
        raise ValueError("DeepSeek 尚未配置")
    return config.api_key


def read_deepseek_key() -> str:
    config, _, _ = _load_effective_llm_config()
    if config is None:
        raise ValueError("DeepSeek 尚未配置")
    return config.api_key


def test_deepseek_configuration() -> dict[str, object]:
    config, _, _ = _load_effective_llm_config()
    if config is None:
        raise ValueError("DeepSeek 尚未配置")
    config.validate()
    client = OpenAICompatibleClient(config)
    # Exercise the same structured-output capability used by reports without
    # transmitting any user data. Merely checking that ``choices`` exists can
    # report success even when JSON mode returns an empty content field.
    request_kwargs: dict[str, object] = {
        "model": config.model,
        "messages": [
            {
                "role": "system",
                "content": "只输出严格 JSON，格式示例：{\"status\":\"ok\"}",
            },
            {"role": "user", "content": "返回结构化连通性结果。"},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 4_096,
        "temperature": 0,
    }
    if config.model.casefold().startswith("deepseek-v4"):
        request_kwargs["reasoning_effort"] = "high"
        request_kwargs["extra_body"] = {"thinking": {"type": "enabled"}}
    response = client.client.chat.completions.create(
        **request_kwargs,
    )
    content = client._extract_message_content(response)
    parsed = parse_json_text(content)
    if not isinstance(parsed, dict) or str(parsed.get("status") or "").casefold() != "ok":
        raise ValueError("DeepSeek JSON 模式返回格式不正确")
    return {"status": "success", "message": "DeepSeek 连接与 JSON 报告模式测试成功"}
