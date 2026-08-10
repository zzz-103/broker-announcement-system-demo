from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

import httpx

from .config import settings
from .custom_intelligence_store import store

QIANFAN_WEB_SEARCH_ENDPOINT = "https://qianfan.baidubce.com/v2/ai_search/web_search"
QIANFAN_AUTH_HEADER = "Authorization"
QIANFAN_SEARCH_SOURCE = "baidu_search_v2"
QIANFAN_QUERY_TOP_K = 10


class QianfanError(Exception):
    def __init__(
        self,
        message: str,
        request_id: str | None = None,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.request_id = request_id
        self.status_code = status_code
        self.error_code = error_code


class QianfanConfigurationError(QianfanError):
    pass


class QianfanDisabledError(QianfanConfigurationError):
    pass


class QianfanTimeoutError(QianfanError):
    pass


class QianfanUpstreamError(QianfanError):
    pass


@dataclass(frozen=True, slots=True)
class QianfanReference:
    provider_reference_id: str
    title: str
    url: str
    site_name: str = ""
    date: str = ""
    snippet: str = ""
    provider_reference_id_is_fallback: bool = False


@dataclass(frozen=True, slots=True)
class QianfanSearchResult:
    answer: str
    references: list[QianfanReference] = field(default_factory=list)
    followups: list[str] = field(default_factory=list)
    request_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass(frozen=True, slots=True)
class EffectiveSearchConfig:
    enabled: bool
    api_key: str
    endpoint: str
    auth_header: str
    timeout_seconds: float
    config_source: str


def _coerce_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _message_content(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if isinstance(choices, list):
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            message = choice.get("message")
            if isinstance(message, dict) and message.get("content") is not None:
                return _coerce_text(message.get("content"))
            if choice.get("text") is not None:
                return _coerce_text(choice.get("text"))
    for key in ("answer", "result", "content", "output", "response"):
        value = payload.get(key)
        if isinstance(value, dict):
            nested = _message_content(value)
            if nested:
                return nested
        elif value is not None:
            return _coerce_text(value)
    return ""


def _reference_list(payload: dict[str, Any]) -> list[dict[str, Any]]:
    for key in ("references", "citations", "sources", "search_results", "web_pages"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    # Some responses nest references in a result/data object.
    for key in ("result", "data", "output"):
        value = payload.get(key)
        if isinstance(value, dict):
            nested = _reference_list(value)
            if nested:
                return nested
    return []


def _parse_reference(item: dict[str, Any], index: int) -> QianfanReference | None:
    url = _coerce_text(item.get("url") or item.get("link") or item.get("href")).strip()
    if not re.match(r"^https?://[^\s]+$", url, flags=re.IGNORECASE):
        return None
    explicit_provider_id = _coerce_text(
        item.get("id")
        or item.get("reference_id")
        or item.get("referenceId")
        or item.get("citation_id")
    ).strip()
    provider_id = explicit_provider_id or _coerce_text(item.get("index") or index).strip()
    title = _coerce_text(item.get("title") or item.get("name")).strip()
    return QianfanReference(
        provider_reference_id=provider_id or str(index),
        title=title,
        url=url,
        site_name=_coerce_text(
            item.get("site_name")
            or item.get("website")
            or item.get("site")
            or item.get("domain")
            or item.get("web_anchor")
        ).strip(),
        date=_coerce_text(item.get("date") or item.get("publish_time") or item.get("published_at")).strip(),
        snippet=_coerce_text(item.get("snippet") or item.get("summary") or item.get("content")).strip(),
        provider_reference_id_is_fallback=not bool(explicit_provider_id),
    )


def parse_search_response(payload: dict[str, Any]) -> QianfanSearchResult:
    references: list[QianfanReference] = []
    for index, item in enumerate(_reference_list(payload), start=1):
        reference = _parse_reference(item, index)
        if reference is not None:
            references.append(reference)
    followups_raw = (
        payload.get("followup_queries")
        or payload.get("followups")
        or payload.get("follow_up_questions")
        or payload.get("recommended_questions")
    )
    followups = [_coerce_text(item).strip() for item in followups_raw] if isinstance(followups_raw, list) else []
    request_id = _response_request_id(payload)
    return QianfanSearchResult(
        answer=_message_content(payload),
        references=references,
        followups=[item for item in followups if item],
        request_id=request_id,
        raw=payload,
    )


def _response_request_id(payload: dict[str, Any]) -> str | None:
    return _coerce_text(
        payload.get("request_id") or payload.get("request_Id") or payload.get("requestId") or payload.get("id")
    ).strip() or None


def _response_error_code(payload: dict[str, Any]) -> str | None:
    value = payload.get("code")
    return _coerce_text(value).strip() or None


def qianfan_error_message(error: QianfanError) -> str:
    """Return a safe, actionable message without exposing upstream response text."""
    if isinstance(error, QianfanConfigurationError):
        if isinstance(error, QianfanDisabledError):
            return "百度智能搜索服务已停用，请联系管理员启用。"
        return "百度智能搜索服务尚未配置。"
    if isinstance(error, QianfanTimeoutError):
        return "百度智能搜索请求超时，请稍后重试。"
    code = (error.error_code or "").casefold()
    if code in {"account_overdue", "accountoverdue", "overdue"}:
        return "百度智能搜索账户欠费或账单逾期，请在千帆控制台处理后重试。"
    if error.status_code == 429 or code in {"overratelimit", "ratelimit", "too_many_requests"}:
        return "百度智能搜索达到频率或额度限制，请稍后重试。"
    if error.status_code in {401, 403} or code in {"unauthorized", "forbidden", "permission_denied"}:
        return "百度智能搜索鉴权失败，请检查服务端密钥、模型权限和鉴权头。"
    if error.status_code == 400 or code in {"invalidargument", "invalid_argument", "bad_request"}:
        return "百度智能搜索请求参数无效，请检查模型和搜索参数。"
    if code == "invalidappid" or "no permission to use the appid" in str(error).casefold():
        return "百度智能搜索 API Key 无权调用当前模型或应用，请在千帆控制台检查 Key 权限和应用绑定。"
    return "百度智能搜索服务暂不可用，请稍后重试。"


def qianfan_http_status(error: QianfanError) -> int:
    if isinstance(error, QianfanConfigurationError):
        return 503
    if isinstance(error, QianfanTimeoutError):
        return 504
    if error.status_code == 429 or (error.error_code or "").casefold() in {"overratelimit", "ratelimit", "too_many_requests"}:
        return 429
    return 502


def build_search_payload(
    query: str,
    *,
    time_range: str = "month",
    top_k: int = QIANFAN_QUERY_TOP_K,
) -> dict[str, Any]:
    """Build a stable, testable Baidu web_search request without an API key."""
    payload: dict[str, Any] = {
        "messages": [{"role": "user", "content": query}],
        "search_source": QIANFAN_SEARCH_SOURCE,
        "search_recency_filter": time_range,
        # Report V2 deliberately uses a small, predictable ordinary-search
        # budget for every planned query.  Callers may ask for a smaller
        # value, but never expand one round beyond the fixed top_k=10 budget.
        "resource_type_filter": [{"type": "web", "top_k": max(1, min(QIANFAN_QUERY_TOP_K, int(top_k)))}],
    }
    return payload


def effective_search_config() -> EffectiveSearchConfig:
    """Return the effective Baidu config for each request.

    Administrator settings, including an explicitly saved API key, are stored
    in the shared configuration row.  The environment key remains a fallback
    for installations that have not saved an administrator configuration yet.
    """
    row = store.get_search_config_row()
    if row is not None:
        saved_api_key = str(row.get("api_key") or "").strip()
        return EffectiveSearchConfig(
            enabled=bool(row.get("enabled")),
            api_key=saved_api_key or settings.baidu_qianfan_api_key,
            endpoint=QIANFAN_WEB_SEARCH_ENDPOINT,
            # V2 intentionally removes the alternate AppBuilder header.  The
            # server always sends the documented bce-v3 Bearer credential in
            # the standard Authorization header.
            auth_header=QIANFAN_AUTH_HEADER,
            timeout_seconds=max(1.0, min(600.0, float(row.get("timeout_seconds") or 0))),
            config_source="admin",
        )
    api_key = settings.baidu_qianfan_api_key
    return EffectiveSearchConfig(
        enabled=bool(api_key),
        api_key=api_key,
        endpoint=QIANFAN_WEB_SEARCH_ENDPOINT,
        auth_header=QIANFAN_AUTH_HEADER,
        timeout_seconds=settings.baidu_qianfan_timeout_seconds,
        config_source="env",
    )


def validate_configuration() -> None:
    config = effective_search_config()
    if not config.enabled:
        raise QianfanDisabledError("百度智能搜索服务已停用")
    missing: list[str] = []
    if not config.api_key:
        missing.append("API Key")
    if not config.endpoint:
        missing.append("Endpoint")
    if missing:
        raise QianfanConfigurationError(f"百度智能搜索配置缺失：{', '.join(missing)}")


def _authorization_value(api_key: str) -> str:
    # The first production version formally supports bce-v3 API keys only.
    return f"Bearer {api_key}"


class QianfanSearchClient:
    def __init__(self) -> None:
        pass

    def search(self, payload: dict[str, Any]) -> QianfanSearchResult:
        config = effective_search_config()
        validate_configuration()
        headers = {
            QIANFAN_AUTH_HEADER: _authorization_value(config.api_key),
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        try:
            with httpx.Client(timeout=config.timeout_seconds) as client:
                response = client.post(config.endpoint, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise QianfanTimeoutError("百度智能搜索请求超时") from exc
        except httpx.HTTPError as exc:
            raise QianfanUpstreamError("百度智能搜索网络请求失败") from exc
        if response.status_code >= 400:
            # Do not expose upstream response text, which could contain
            # sensitive request details or untrusted model content.
            error_payload: dict[str, Any] = {}
            try:
                parsed_error = response.json()
                if isinstance(parsed_error, dict):
                    error_payload = parsed_error
            except (TypeError, ValueError):
                pass
            if response.status_code in {408, 501, 502, 504}:
                raise QianfanTimeoutError(
                    "百度智能搜索请求超时",
                    request_id=_response_request_id(error_payload),
                    status_code=response.status_code,
                    error_code=_response_error_code(error_payload),
                )
            raise QianfanUpstreamError(
                f"百度智能搜索服务返回 HTTP {response.status_code}",
                request_id=_response_request_id(error_payload),
                status_code=response.status_code,
                error_code=_response_error_code(error_payload),
            )
        try:
            data = response.json()
        except (TypeError, ValueError) as exc:
            raise QianfanUpstreamError("百度智能搜索响应格式无效") from exc
        if not isinstance(data, dict):
            raise QianfanUpstreamError("百度智能搜索响应格式无效")
        upstream_code = data.get("code")
        if upstream_code in (501, 502, "501", "502") and not _message_content(data):
            raise QianfanTimeoutError(
                "百度智能搜索请求超时",
                request_id=_response_request_id(data),
                status_code=response.status_code,
                error_code=_response_error_code(data),
            )
        if upstream_code not in (None, 0, "0") and not _message_content(data):
            raise QianfanUpstreamError(
                "百度智能搜索服务返回业务错误",
                request_id=_response_request_id(data),
                status_code=response.status_code,
                error_code=_response_error_code(data),
            )
        return parse_search_response(data)


client = QianfanSearchClient()


def test_search_configuration() -> dict[str, object]:
    """Run a minimal, secret-free connectivity check against the current config."""
    config = effective_search_config()
    if not config.enabled:
        raise QianfanDisabledError("百度智能搜索服务已停用")
    payload = build_search_payload(
        "百度千帆最新产品信息",
        time_range="month",
        top_k=QIANFAN_QUERY_TOP_K,
    )
    result = client.search(payload)
    return {
        "ok": True,
        "request_id": result.request_id,
        "message": "连接测试成功，服务可用。",
    }
