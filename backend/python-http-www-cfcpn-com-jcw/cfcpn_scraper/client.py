"""HTTP client for the verified CFCPN notice endpoints."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlencode

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .models import (
    BASE_URL,
    DATA_URL,
    DEFAULT_TIMEOUT,
    DETAIL_PATH,
    LIST_PAGE_URL,
    USER_AGENT,
    CfcpnError,
)

LOGGER = logging.getLogger("cfcpn_scraper.client")


def create_session() -> requests.Session:
    """Create a requests session with browser-like headers and finite retries."""
    session = requests.Session()
    session.trust_env = False
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Origin": BASE_URL,
            "Referer": LIST_PAGE_URL,
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest",
        }
    )
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        status=3,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def build_detail_url(notice_id: str, notice_type: str | int | None) -> str:
    column = str(notice_type or "")
    query = urlencode(
        {
            "url": "modules/sys/login/detail",
            "column": column,
            "searchVal": notice_id,
        }
    )
    return f"{BASE_URL}{DETAIL_PATH}?{query}"


def fetch_notice_list(
    page_no: int,
    page_size: int,
    keyword: str,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    """Fetch one notice-list page and return {"total": int, "rows": list}."""
    active_session = session or create_session()
    payload = {
        "noticeType": "1",
        "pageSize": str(page_size),
        "pageNo": str(page_no),
        "noticeState": "1",
        "isValid": "1",
        "orderBy": "publish_time desc",
        "noticeContent": "",
        "briefContent": keyword,
        "noticeTitle": "",
        "purchaseName": "",
        "purchaseId": "",
        "categoryLabName": "",
        "beginPublishTime": "",
        "endPublishTime": "",
        "areaProvince": "",
        "labelAllId": "",
    }
    LOGGER.debug("列表请求表单参数: %s", payload)
    response = active_session.post(
        DATA_URL,
        data=payload,
        headers={
            "Referer": LIST_PAGE_URL,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        timeout=DEFAULT_TIMEOUT,
    )
    data = _validate_json_response(response)
    rows = data.get("rows")
    if not isinstance(rows, list):
        raise CfcpnError("List response field 'rows' is not a list")
    total = _coerce_total(data.get("total"))
    return {"total": total, "rows": rows}


def fetch_notice_detail(
    notice_id: str,
    notice_type: str | int | None,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    """Fetch detail JSON for one notice using the verified detail Referer.

    Probe results showed the detail shell page does not need to be fetched first.
    A direct POST succeeds as long as the Referer is the constructed shell URL.
    """
    active_session = session or create_session()
    detail_url = build_detail_url(notice_id, notice_type)
    response = active_session.post(
        DATA_URL,
        data={"id": notice_id, "isDetail": "1"},
        headers={
            "Referer": detail_url,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        timeout=DEFAULT_TIMEOUT,
    )
    data = _validate_json_response(response)
    rows = data.get("rows")
    if not isinstance(rows, list):
        raise CfcpnError("Detail response field 'rows' is not a list")
    data["_detail_url"] = detail_url
    data["_status_code"] = response.status_code
    return data


def _validate_json_response(response: requests.Response) -> dict[str, Any]:
    if response.status_code != 200:
        raise CfcpnError(
            f"Unexpected HTTP status: {response.status_code}",
            status_code=response.status_code,
            headers=dict(response.headers),
        )
    content_type = response.headers.get("Content-Type", "")
    if "json" not in content_type.lower():
        raise CfcpnError(
            f"Unexpected Content-Type: {content_type}",
            status_code=response.status_code,
            headers=dict(response.headers),
        )
    try:
        data = response.json()
    except ValueError as exc:
        raise CfcpnError("Response body is not valid JSON") from exc
    if not isinstance(data, dict):
        raise CfcpnError("JSON response is not an object")
    if data.get("result") is not True:
        raise CfcpnError(f"Response result is not true: {data.get('result')!r}")
    return data


def _coerce_total(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise CfcpnError(f"List response total is not an integer: {value!r}") from exc
