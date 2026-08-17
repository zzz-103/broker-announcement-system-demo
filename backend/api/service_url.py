from __future__ import annotations

from urllib.parse import SplitResult, urlsplit, urlunsplit


def service_url_with_port(value: str, port: int) -> str:
    """Validate an HTTP(S) service URL and replace its explicit port."""

    if not 1 <= port <= 65_535:
        raise ValueError("服务端口必须在 1 到 65535 之间")
    try:
        parsed = urlsplit(value.strip())
        _ = parsed.port
    except ValueError as exc:
        raise ValueError("服务地址包含无效端口") from exc
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("服务地址必须是有效的 HTTP(S) 地址，且不能包含凭据、查询参数或片段")
    hostname = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
    netloc = hostname if (parsed.scheme, port) in {("http", 80), ("https", 443)} else f"{hostname}:{port}"
    return urlunsplit(SplitResult(parsed.scheme, netloc, parsed.path, "", ""))


def service_url_port(value: str) -> int:
    """Return the explicit or scheme-default port for a validated service URL."""

    try:
        parsed = urlsplit(value.strip())
        port = parsed.port
    except ValueError as exc:
        raise ValueError("服务地址包含无效端口") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("服务地址必须是有效的 HTTP(S) 地址")
    return port or (443 if parsed.scheme == "https" else 80)
