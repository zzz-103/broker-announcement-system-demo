from __future__ import annotations

import ssl

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


DEFAULT_TIMEOUT = (5, 20)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0.0.0 Safari/537.36"
)
LEGACY_SERVER_CONNECT_OPTION = getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)


class LegacyServerConnectAdapter(HTTPAdapter):
    """Enable legacy TLS renegotiation only for sites that still require it."""

    def init_poolmanager(
        self,
        connections: int,
        maxsize: int,
        block: bool = False,
        **pool_kwargs: object,
    ) -> None:
        context = ssl.create_default_context()
        context.options |= LEGACY_SERVER_CONNECT_OPTION
        pool_kwargs["ssl_context"] = context
        super().init_poolmanager(
            connections,
            maxsize,
            block=block,
            **pool_kwargs,
        )


def create_session(*, allow_legacy_server_connect: bool = False) -> requests.Session:
    session = requests.Session()
    session.trust_env = False
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept-Language": "zh-CN,zh;q=0.9",
        }
    )
    retry = Retry(
        total=2,
        connect=2,
        read=2,
        status=2,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET", "POST"}),
        raise_on_status=False,
    )
    session.mount("http://", HTTPAdapter(max_retries=retry))
    https_adapter = (
        LegacyServerConnectAdapter(max_retries=retry)
        if allow_legacy_server_connect
        else HTTPAdapter(max_retries=retry)
    )
    session.mount("https://", https_adapter)
    return session
