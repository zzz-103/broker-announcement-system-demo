"""Lightweight collector for ordinary HTTP pages and JSON APIs."""

import logging
import ssl
from datetime import datetime
from functools import lru_cache
from zoneinfo import ZoneInfo

import certifi
import httpx

from broker_app_watch.collectors.base import CollectedContent, Collector
from broker_app_watch.core.config import BrokerSource


LOGGER = logging.getLogger(__name__)

# 部分券商站点仍使用旧版 TLS 重协商，OpenSSL 3.x 默认禁用；
# 这里显式允许并使用 certifi 证书链，仅为兼容老服务器，非反爬绕过。
_OP_LEGACY_SERVER_CONNECT = 0x4

_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
    )
}


@lru_cache(maxsize=1)
def _ssl_context() -> ssl.SSLContext:
    context = ssl.create_default_context(cafile=certifi.where())
    context.options |= _OP_LEGACY_SERVER_CONNECT
    return context


def fetch_binary(url: str, *, timeout_seconds: float = 20.0) -> bytes:
    """Download raw bytes (e.g. an image) reusing the shared TLS settings."""

    response = httpx.get(
        url,
        timeout=timeout_seconds,
        follow_redirects=True,
        verify=_ssl_context(),
        headers=_DEFAULT_HEADERS,
    )
    response.raise_for_status()
    return response.content


class HttpCollector(Collector):
    """Fetch a static page with conservative defaults."""

    def __init__(self, timeout_seconds: float = 20.0) -> None:
        self.timeout_seconds = timeout_seconds

    def collect(self, source: BrokerSource) -> CollectedContent:
        request_url = str(source.fetch_url or source.source_url)
        last_error: httpx.HTTPError | None = None
        for attempt in range(2):
            try:
                if source.request_method == "POST":
                    response = httpx.post(
                        request_url,
                        json=source.request_json,
                        timeout=self.timeout_seconds,
                        follow_redirects=True,
                        verify=_ssl_context(),
                        headers=_DEFAULT_HEADERS,
                    )
                else:
                    response = httpx.get(
                        request_url,
                        timeout=self.timeout_seconds,
                        follow_redirects=True,
                        verify=_ssl_context(),
                        headers=_DEFAULT_HEADERS,
                    )
                response.raise_for_status()
                crawl_time = datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(
                    timespec="seconds"
                )
                return CollectedContent(
                    source=source,
                    body=response.text,
                    content_type=response.headers.get("content-type"),
                    status_code=response.status_code,
                    final_url=str(response.url),
                    crawl_time=crawl_time,
                )
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt == 0:
                    LOGGER.warning("请求 %s 失败，将重试一次", source.broker_code)

        assert last_error is not None
        LOGGER.error("请求 %s 失败：%s", source.broker_code, type(last_error).__name__)
        raise RuntimeError(f"HTTP 获取失败：{source.broker_code}") from last_error
