"""Shared constants and lightweight exceptions for CFCPN scraping."""

from __future__ import annotations


BASE_URL = "http://www.cfcpn.com"
LIST_PAGE_URL = (
    f"{BASE_URL}/jcw/sys/index/goUrl?url=modules/sys/login/list&column=cggg"
)
DATA_URL = f"{BASE_URL}/jcw/noticeinfo/noticeInfo/dataNoticeList"
DETAIL_PATH = "/jcw/sys/index/goUrl"
DEFAULT_TIMEOUT = (5, 20)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)


class CfcpnError(RuntimeError):
    """Raised when a CFCPN response cannot be validated."""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.headers = headers or {}
