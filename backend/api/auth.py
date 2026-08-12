from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Header, HTTPException, status

from .config import settings
from .runtime import session_tokens
from .user_store import InvalidUserCredentialsError, UserStoreError, authenticate_user


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


def require_super_admin_token(authorization: Annotated[str | None, Header()] = None) -> None:
    session = get_session(authorization)
    if session.get("role") != "admin" or session.get("is_super_admin") is not True:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="super admin privileges required")


def verify_session_password(session: dict[str, object], password: str) -> bool:
    if session.get("role") != "admin":
        return False
    if session.get("is_super_admin") is True:
        expected = settings.admin_password
        return bool(expected) and secrets.compare_digest(password, expected)
    try:
        user = authenticate_user(str(session.get("username") or ""), password)
    except (InvalidUserCredentialsError, UserStoreError):
        return False
    return isinstance(session.get("user_id"), int) and user.id == session["user_id"] and user.role == "admin"
