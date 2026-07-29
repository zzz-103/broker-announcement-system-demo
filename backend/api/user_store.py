from __future__ import annotations

import hashlib
import hmac
import io
import os
import secrets
import sqlite3
import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = PROJECT_ROOT / "backend" / "data" / "users.db"
DEFAULT_QUALIFICATION_CSV_PATH = PROJECT_ROOT / "backend" / "config" / "user_qualification.csv"
HASH_ITERATIONS = 210_000


class UserStoreError(Exception):
    pass


class DuplicateUserError(UserStoreError):
    pass


class UserNotFoundError(UserStoreError):
    pass


class FeedbackNotFoundError(UserStoreError):
    pass


class InvalidUserCredentialsError(UserStoreError):
    pass


class QualificationNotFoundError(UserStoreError):
    pass


class QualificationServiceUnavailableError(UserStoreError):
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


@dataclass(frozen=True)
class FeedbackEntry:
    id: int
    category: str
    broker_name: str
    message: str
    related_context: str
    reporter_username: str
    reporter_name: str
    status: str
    created_at: str
    processed_at: str | None

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "category": self.category,
            "broker_name": self.broker_name,
            "message": self.message,
            "related_context": self.related_context,
            "reporter_username": self.reporter_username,
            "reporter_name": self.reporter_name,
            "status": self.status,
            "created_at": self.created_at,
            "processed_at": self.processed_at,
        }


def resolve_user_db_path() -> Path:
    configured = os.getenv("USER_DB_PATH")
    path = Path(configured) if configured else DEFAULT_DB_PATH
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


def resolve_qualification_csv_path() -> Path:
    configured = os.getenv("USER_QUALIFICATION_CSV_PATH")
    path = Path(configured) if configured else DEFAULT_QUALIFICATION_CSV_PATH
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


def normalize_email(email: str) -> str:
    return email.strip().lower()


def username_from_email(email: str) -> str:
    return email.split("@", 1)[0]


def qualification_email_domain() -> str:
    return os.getenv("USER_QUALIFICATION_EMAIL_DOMAIN", "csco.com.cn").strip().lower().lstrip("@")


def read_qualification_csv_text(path: Path) -> str:
    last_error: UnicodeError | None = None
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeError as exc:
            last_error = exc
    if last_error is not None:
        raise QualificationServiceUnavailableError("qualification CSV encoding is invalid") from last_error
    raise QualificationServiceUnavailableError("qualification CSV encoding is invalid")


def generate_initial_password() -> str:
    return "123456"


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
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS feedback_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            broker_name TEXT NOT NULL DEFAULT '',
            message TEXT NOT NULL DEFAULT '',
            related_context TEXT NOT NULL DEFAULT '',
            reporter_username TEXT NOT NULL,
            reporter_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            processed_at TEXT
        )
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_feedback_entries_status_created_at
        ON feedback_entries (status, created_at DESC)
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


def row_to_feedback(row: sqlite3.Row) -> FeedbackEntry:
    return FeedbackEntry(
        id=int(row["id"]),
        category=str(row["category"]),
        broker_name=str(row["broker_name"]),
        message=str(row["message"]),
        related_context=str(row["related_context"]),
        reporter_username=str(row["reporter_username"]),
        reporter_name=str(row["reporter_name"]),
        status=str(row["status"]),
        created_at=str(row["created_at"]),
        processed_at=str(row["processed_at"]) if row["processed_at"] is not None else None,
    )


def create_feedback(
    category: str,
    broker_name: str,
    message: str,
    related_context: str,
    reporter_username: str,
    reporter_name: str,
) -> FeedbackEntry:
    created_at = datetime.now(timezone.utc).isoformat()
    try:
        with _connect() as connection:
            ensure_schema(connection)
            cursor = connection.execute(
                """
                INSERT INTO feedback_entries
                    (category, broker_name, message, related_context, reporter_username, reporter_name, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
                """,
                (category, broker_name, message, related_context, reporter_username, reporter_name, created_at),
            )
            connection.commit()
            row = connection.execute(
                """
                SELECT id, category, broker_name, message, related_context, reporter_username,
                       reporter_name, status, created_at, processed_at
                FROM feedback_entries WHERE id = ?
                """,
                (cursor.lastrowid,),
            ).fetchone()
    except sqlite3.Error as exc:
        raise UserStoreError("failed to create feedback") from exc
    if row is None:
        raise UserStoreError("failed to create feedback")
    return row_to_feedback(row)


def list_feedback() -> list[FeedbackEntry]:
    try:
        with _connect() as connection:
            ensure_schema(connection)
            rows = connection.execute(
                """
                SELECT id, category, broker_name, message, related_context, reporter_username,
                       reporter_name, status, created_at, processed_at
                FROM feedback_entries
                ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
                """
            ).fetchall()
    except sqlite3.Error as exc:
        raise UserStoreError("failed to list feedback") from exc
    return [row_to_feedback(row) for row in rows]


def update_feedback_status(feedback_id: int, feedback_status: str) -> FeedbackEntry:
    processed_at = datetime.now(timezone.utc).isoformat() if feedback_status == "processed" else None
    try:
        with _connect() as connection:
            ensure_schema(connection)
            cursor = connection.execute(
                "UPDATE feedback_entries SET status = ?, processed_at = ? WHERE id = ?",
                (feedback_status, processed_at, feedback_id),
            )
            connection.commit()
            if cursor.rowcount == 0:
                raise FeedbackNotFoundError("feedback not found")
            row = connection.execute(
                """
                SELECT id, category, broker_name, message, related_context, reporter_username,
                       reporter_name, status, created_at, processed_at
                FROM feedback_entries WHERE id = ?
                """,
                (feedback_id,),
            ).fetchone()
    except FeedbackNotFoundError:
        raise
    except sqlite3.Error as exc:
        raise UserStoreError("failed to update feedback") from exc
    if row is None:
        raise FeedbackNotFoundError("feedback not found")
    return row_to_feedback(row)


def _fetch_user_by_email_or_username(
    connection: sqlite3.Connection,
    email: str,
    username: str,
) -> ApprovedUser | None:
    row = connection.execute(
        """
        SELECT id, name, email, department, username, created_at
        FROM approved_users
        WHERE email = ? OR username = ?
        ORDER BY id ASC
        LIMIT 1
        """,
        (normalize_email(email), username.strip()),
    ).fetchone()
    return row_to_user(row) if row is not None else None


def list_users(page: int, page_size: int, query: str | None = None) -> tuple[list[ApprovedUser], int, int]:
    normalized_query = query.strip() if query else ""
    where_clause = ""
    parameters: list[object] = []
    if normalized_query:
        escaped_query = normalized_query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped_query}%"
        where_clause = """
            WHERE name LIKE ? ESCAPE '\\'
               OR email LIKE ? ESCAPE '\\'
               OR department LIKE ? ESCAPE '\\'
               OR username LIKE ? ESCAPE '\\'
        """
        parameters.extend([pattern, pattern, pattern, pattern])
    try:
        with _connect() as connection:
            ensure_schema(connection)
            total = int(
                connection.execute(
                    f"SELECT COUNT(*) FROM approved_users {where_clause}",
                    parameters,
                ).fetchone()[0]
            )
            total_pages = max(1, (total + page_size - 1) // page_size)
            effective_page = min(page, total_pages)
            offset = (effective_page - 1) * page_size
            rows = connection.execute(
                f"""
                SELECT id, name, email, department, username, created_at
                FROM approved_users
                {where_clause}
                ORDER BY id DESC
                LIMIT ? OFFSET ?
                """,
                [*parameters, page_size, offset],
            ).fetchall()
    except sqlite3.Error as exc:
        raise UserStoreError("failed to list users") from exc
    return [row_to_user(row) for row in rows], total, effective_page


def get_user_names_by_ids(user_ids: set[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    placeholders = ",".join("?" for _ in user_ids)
    try:
        with _connect() as connection:
            ensure_schema(connection)
            rows = connection.execute(
                f"SELECT id, name FROM approved_users WHERE id IN ({placeholders})",
                sorted(user_ids),
            ).fetchall()
    except sqlite3.Error as exc:
        raise UserStoreError("failed to load user names") from exc
    return {int(row["id"]): str(row["name"]).strip() for row in rows if str(row["name"]).strip()}


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


def create_or_get_user(
    name: str,
    email: str,
    department: str,
    username: str | None = None,
) -> tuple[ApprovedUser, str]:
    normalized_email = normalize_email(email)
    resolved_username = (username or username_from_email(normalized_email)).strip()
    initial_password = generate_initial_password()
    password_hash = hash_password(initial_password)
    created_at = datetime.now(timezone.utc).isoformat()

    try:
        with _connect() as connection:
            ensure_schema(connection)
            existing = _fetch_user_by_email_or_username(connection, normalized_email, resolved_username)
            if existing is not None:
                return existing, initial_password

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
                    resolved_username,
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
    except sqlite3.IntegrityError:
        try:
            with _connect() as connection:
                ensure_schema(connection)
                existing = _fetch_user_by_email_or_username(connection, normalized_email, resolved_username)
        except sqlite3.Error as exc:
            raise UserStoreError("failed to load existing user") from exc
        if existing is not None:
            return existing, initial_password
        raise DuplicateUserError("email or username already exists")
    except sqlite3.Error as exc:
        raise UserStoreError("failed to create user") from exc

    if row is None:
        raise UserStoreError("failed to create user")
    return row_to_user(row), initial_password


def find_qualified_contact(name: str, email: str) -> tuple[str, str, str]:
    normalized_name = name.strip()
    normalized_email = normalize_email(email)
    domain = qualification_email_domain()
    if not normalized_name or not normalized_email.endswith(f"@{domain}"):
        raise QualificationNotFoundError("qualification not found")

    csv_path = resolve_qualification_csv_path()
    try:
        reader = csv.DictReader(io.StringIO(read_qualification_csv_text(csv_path)))
        fieldnames = set(reader.fieldnames or [])
        required_headers = {"姓名中文", "邮箱", "邮箱前缀"}
        if not required_headers.issubset(fieldnames):
            raise QualificationServiceUnavailableError("qualification CSV headers are invalid")
        for row in reader:
            row_name = str(row.get("姓名中文") or "").strip()
            row_email = normalize_email(str(row.get("邮箱") or ""))
            row_prefix = str(row.get("邮箱前缀") or "").strip()
            if row_name == normalized_name and row_email == normalized_email and row_prefix:
                return row_name, row_email, row_prefix
        raise QualificationNotFoundError("qualification not found")
    except FileNotFoundError as exc:
        raise QualificationServiceUnavailableError("qualification CSV not found") from exc
    except OSError as exc:
        raise QualificationServiceUnavailableError("failed to read qualification CSV") from exc
    except UnicodeError as exc:
        raise QualificationServiceUnavailableError("qualification CSV encoding is invalid") from exc
    except csv.Error as exc:
        raise QualificationServiceUnavailableError("qualification CSV is invalid") from exc

    raise QualificationNotFoundError("qualification not found")


def apply_for_user(name: str, email: str, department: str) -> tuple[ApprovedUser, str]:
    department_value = department.strip()
    if not department_value:
        raise QualificationNotFoundError("qualification not found")
    qualified_name, qualified_email, username = find_qualified_contact(name, email)
    return create_or_get_user(
        name=qualified_name,
        email=qualified_email,
        department=department_value,
        username=username,
    )


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
