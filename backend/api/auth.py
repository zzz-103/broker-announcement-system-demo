from __future__ import annotations

from typing import Annotated

from fastapi import Header, HTTPException, status

from .runtime import session_tokens


def get_session(
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    session = session_tokens.get(token)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
    return session


def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
    get_session(authorization)


def require_admin_token(authorization: Annotated[str | None, Header()] = None) -> None:
    session = get_session(authorization)
    if session.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin privileges required")
