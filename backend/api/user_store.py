from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = PROJECT_ROOT / "backend" / "data" / "users.db"
HASH_ITERATIONS = 210_000


class UserStoreError(Exception):
    pass


class DuplicateUserError(UserStoreError):
    pass


class UserNotFoundError(UserStoreError):
    pass


class InvalidUserCredentialsError(UserStoreError):
    pass


@dataclass(frozen=True)
class ApprovedUser:
    id: int
    name: str
    email: str
    department: str
    username: str
    created_at: str

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "department": self.department,
            "username": self.username,
            "created_at": self.created_at,
        }


def resolve_user_db_path() -> Path:
    configured = os.getenv("USER_DB_PATH")
    path = Path(configured) if configured else DEFAULT_DB_PATH
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


def normalize_email(email: str) -> str:
    return email.strip().lower()


def username_from_email(email: str) -> str:
    return email.split("@", 1)[0]


def generate_initial_password() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        HASH_ITERATIONS,
    )
    return f"pbkdf2_sha256${HASH_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations_raw, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt_hex),
            int(iterations_raw),
        )
    except (TypeError, ValueError):
        return False
    return hmac.compare_digest(actual.hex(), digest_hex)


def _connect() -> sqlite3.Connection:
    db_path = resolve_user_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS approved_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            department TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    connection.commit()


def row_to_user(row: sqlite3.Row) -> ApprovedUser:
    return ApprovedUser(
        id=int(row["id"]),
        name=str(row["name"]),
        email=str(row["email"]),
        department=str(row["department"]),
        username=str(row["username"]),
        created_at=str(row["created_at"]),
    )


def list_users() -> list[ApprovedUser]:
    try:
        with _connect() as connection:
            ensure_schema(connection)
            rows = connection.execute(
                """
                SELECT id, name, email, department, username, created_at
                FROM approved_users
                ORDER BY id DESC
                """
            ).fetchall()
    except sqlite3.Error as exc:
        raise UserStoreError("failed to list users") from exc
    return [row_to_user(row) for row in rows]


def create_user(name: str, email: str, department: str) -> tuple[ApprovedUser, str]:
    normalized_email = normalize_email(email)
    username = username_from_email(normalized_email)
    initial_password = generate_initial_password()
    password_hash = hash_password(initial_password)
    created_at = datetime.now(timezone.utc).isoformat()

    try:
        with _connect() as connection:
            ensure_schema(connection)
            cursor = connection.execute(
                """
                INSERT INTO approved_users
                    (name, email, department, username, password_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    name.strip(),
                    normalized_email,
                    department.strip(),
                    username,
                    password_hash,
                    created_at,
                ),
            )
            connection.commit()
            row = connection.execute(
                """
                SELECT id, name, email, department, username, created_at
                FROM approved_users
                WHERE id = ?
                """,
                (cursor.lastrowid,),
            ).fetchone()
    except sqlite3.IntegrityError as exc:
        raise DuplicateUserError("email or username already exists") from exc
    except sqlite3.Error as exc:
        raise UserStoreError("failed to create user") from exc

    if row is None:
        raise UserStoreError("failed to create user")
    return row_to_user(row), initial_password


def authenticate_user(username: str, password: str) -> ApprovedUser:
    try:
        with _connect() as connection:
            ensure_schema(connection)
            row = connection.execute(
                """
                SELECT id, name, email, department, username, password_hash, created_at
                FROM approved_users
                WHERE username = ?
                """,
                (username.strip(),),
            ).fetchone()
    except sqlite3.Error as exc:
        raise UserStoreError("failed to authenticate user") from exc

    if row is None or not verify_password(password, str(row["password_hash"])):
        raise InvalidUserCredentialsError("invalid credentials")
    return row_to_user(row)


def delete_user(user_id: int) -> None:
    try:
        with _connect() as connection:
            ensure_schema(connection)
            cursor = connection.execute("DELETE FROM approved_users WHERE id = ?", (user_id,))
            connection.commit()
    except sqlite3.Error as exc:
        raise UserStoreError("failed to delete user") from exc
    if cursor.rowcount == 0:
        raise UserNotFoundError("user not found")
