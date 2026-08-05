from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx

from .config import settings


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


@dataclass(frozen=True, slots=True)
class QianfanSearchResult:
    answer: str
    references: list[QianfanReference] = field(default_factory=list)
    followups: list[str] = field(default_factory=list)
    request_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


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
    provider_id = _coerce_text(
        item.get("id")
        or item.get("reference_id")
        or item.get("referenceId")
        or item.get("citation_id")
        or item.get("index")
        or index
    ).strip()
    title = _coerce_text(item.get("title") or item.get("name")).strip()
    return QianfanReference(
        provider_reference_id=provider_id or str(index),
        title=title,
        url=url,
        site_name=_coerce_text(
            item.get("site_name") or item.get("website") or item.get("site") or item.get("domain")
        ).strip(),
        date=_coerce_text(item.get("date") or item.get("publish_time") or item.get("published_at")).strip(),
        snippet=_coerce_text(item.get("snippet") or item.get("summary") or item.get("content")).strip(),
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
    top_k: int = 8,
    specified_sites: list[str] | None = None,
    instruction: str = "",
    search_mode: str = "required",
) -> dict[str, Any]:
    """Build a stable, testable request without ever including an API key."""
    payload: dict[str, Any] = {
        "model": settings.baidu_qianfan_model,
        "messages": [{"role": "user", "content": query}],
        "stream": False,
        "search_source": "baidu_search_v2",
        "search_mode": search_mode,
        "response_format": "text",
        "enable_followup_queries": True,
        "enable_deep_search": False,
        "search_recency_filter": time_range,
        "resource_type_filter": [{"type": "web", "top_k": max(1, min(20, int(top_k)))}],
    }
    if instruction.strip():
        payload["instruction"] = instruction.strip()
    domains = [str(item).strip().lower() for item in (specified_sites or []) if str(item).strip()]
    if domains:
        payload["search_filter"] = {"match": {"site": domains[:20]}}
    return payload


def validate_configuration() -> None:
    missing: list[str] = []
    if not settings.baidu_qianfan_api_key:
        missing.append("BAIDU_QIANFAN_API_KEY")
    if not settings.baidu_qianfan_model:
        missing.append("BAIDU_QIANFAN_MODEL")
    if not settings.baidu_qianfan_endpoint:
        missing.append("BAIDU_QIANFAN_ENDPOINT")
    if missing:
        raise QianfanConfigurationError(f"百度智能搜索配置缺失：{', '.join(missing)}")


def _authorization_value(api_key: str, header_name: str) -> str:
    # Both documented variants accept bearer-style credentials; deployments
    # can override the header name while the secret remains server-side.
    return f"Bearer {api_key}" if header_name.casefold() == "authorization" else f"Bearer {api_key}"


def probe_auth_headers(
    send: Callable[[str], int],
    candidates: tuple[str, ...] = ("Authorization", "X-Appbuilder-Authorization"),
) -> str | None:
    """Choose an auth header based on an injected status probe.

    No network request is made by this helper; production startup can call it
    from a deployment-specific probe while tests provide a deterministic send.
    A status that reached parameter validation is treated as authenticated.
    """
    for header in candidates:
        try:
            status = int(send(header))
        except Exception:  # pragma: no cover - caller-owned probe
            continue
        if status not in {401, 403}:
            return header
    return None


class QianfanSearchClient:
    def __init__(self) -> None:
        self.endpoint = settings.baidu_qianfan_endpoint

    def search(self, payload: dict[str, Any]) -> QianfanSearchResult:
        validate_configuration()
        headers = {
            settings.baidu_qianfan_auth_header: _authorization_value(
                settings.baidu_qianfan_api_key,
                settings.baidu_qianfan_auth_header,
            ),
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        try:
            with httpx.Client(timeout=settings.baidu_qianfan_timeout_seconds) as client:
                response = client.post(settings.baidu_qianfan_endpoint, headers=headers, json=payload)
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
