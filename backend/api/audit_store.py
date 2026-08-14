from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = PROJECT_ROOT / "backend" / "data" / "audit.db"
EVENT_TYPES = {
    "qr_visit",
    "qualification_application",
    "login_success",
    "dashboard_view",
    "user_role_promoted",
    "user_role_demoted",
    "custom_intelligence_config_updated",
    "custom_intelligence_secret_revealed",
    "custom_intelligence_connection_tested",
    "custom_intelligence_email_sent",
}


class AuditStoreError(Exception):
    pass


@dataclass(frozen=True)
class AuditEvent:
    id: int
    event_type: str
    visitor_id: str | None
    user_id: int | None
    username: str | None
    role: str | None
    source: str | None
    ip_masked: str | None
    user_agent: str | None
    created_at: str
    metadata: dict[str, object]

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "event_type": self.event_type,
            "visitor_id": self.visitor_id,
            "user_id": self.user_id,
            "username": self.username,
            "role": self.role,
            "source": self.source,
            "ip_masked": self.ip_masked,
            "user_agent": self.user_agent,
            "created_at": self.created_at,
            "metadata": self.metadata,
        }


def resolve_audit_db_path() -> Path:
    configured = os.getenv("AUDIT_DB_PATH")
    path = Path(configured) if configured else DEFAULT_DB_PATH
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


def _connect() -> sqlite3.Connection:
    path = resolve_audit_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=5)
    connection.row_factory = sqlite3.Row
    return connection


def _ensure_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            visitor_id TEXT,
            user_id INTEGER,
            username TEXT,
            role TEXT,
            source TEXT,
            ip_masked TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}'
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_audit_events_type_created_at ON audit_events (event_type, created_at DESC)"
    )
    connection.execute("CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events (created_at DESC)")
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_qr_visit_visitor
        ON audit_events (event_type, visitor_id)
        WHERE event_type = 'qr_visit' AND visitor_id IS NOT NULL
        """
    )
    connection.commit()


def _row_to_event(row: sqlite3.Row) -> AuditEvent:
    try:
        metadata = json.loads(str(row["metadata_json"]))
    except (TypeError, json.JSONDecodeError):
        metadata = {}
    return AuditEvent(
        id=int(row["id"]),
        event_type=str(row["event_type"]),
        visitor_id=str(row["visitor_id"]) if row["visitor_id"] is not None else None,
        user_id=int(row["user_id"]) if row["user_id"] is not None else None,
        username=str(row["username"]) if row["username"] is not None else None,
        role=str(row["role"]) if row["role"] is not None else None,
        source=str(row["source"]) if row["source"] is not None else None,
        ip_masked=str(row["ip_masked"]) if row["ip_masked"] is not None else None,
        user_agent=str(row["user_agent"]) if row["user_agent"] is not None else None,
        created_at=str(row["created_at"]),
        metadata=metadata if isinstance(metadata, dict) else {},
    )


def record_event(
    *,
    event_type: str,
    visitor_id: str | None = None,
    user_id: int | None = None,
    username: str | None = None,
    role: str | None = None,
    source: str | None = None,
    ip_masked: str | None = None,
    user_agent: str | None = None,
    metadata: dict[str, object] | None = None,
) -> tuple[AuditEvent | None, bool]:
    if event_type not in EVENT_TYPES:
        raise AuditStoreError("audit event type is invalid")
    created_at = datetime.now(timezone.utc).isoformat()
    metadata_json = json.dumps(metadata or {}, ensure_ascii=False, separators=(",", ":"))
    try:
        with _connect() as connection:
            _ensure_schema(connection)
            try:
                cursor = connection.execute(
                    """
                    INSERT INTO audit_events
                    (event_type, visitor_id, user_id, username, role, source, ip_masked, user_agent, created_at, metadata_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (event_type, visitor_id, user_id, username, role, source, ip_masked, user_agent, created_at, metadata_json),
                )
            except sqlite3.IntegrityError:
                if event_type == "qr_visit" and visitor_id:
                    return None, False
                raise
            connection.commit()
            row = connection.execute("SELECT * FROM audit_events WHERE id = ?", (cursor.lastrowid,)).fetchone()
    except sqlite3.Error as exc:
        raise AuditStoreError("failed to write audit event") from exc
    if row is None:
        raise AuditStoreError("failed to write audit event")
    return _row_to_event(row), True


def list_events(
    event_type: str | None,
    page: int,
    page_size: int,
    query: str | None = None,
) -> tuple[list[AuditEvent], int, int]:
    if event_type and event_type not in EVENT_TYPES:
        raise AuditStoreError("audit event type is invalid")
    normalized_query = query.strip() if query else ""
    where_clauses: list[str] = []
    parameters: list[object] = []
    if event_type:
        where_clauses.append("event_type = ?")
        parameters.append(event_type)
    if normalized_query:
        escaped_query = normalized_query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped_query}%"
        where_clauses.append(
            "(username LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' "
            "OR ip_masked LIKE ? ESCAPE '\\' OR metadata_json LIKE ? ESCAPE '\\')"
        )
        parameters.extend([pattern, pattern, pattern, pattern, pattern])
    where_clause = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    try:
        with _connect() as connection:
            _ensure_schema(connection)
            total = int(
                connection.execute(
                    f"SELECT COUNT(*) FROM audit_events {where_clause}",
                    parameters,
                ).fetchone()[0]
            )
            total_pages = max(1, (total + page_size - 1) // page_size)
            effective_page = min(page, total_pages)
            offset = (effective_page - 1) * page_size
            rows = connection.execute(
                f"SELECT * FROM audit_events {where_clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                [*parameters, page_size, offset],
            ).fetchall()
    except sqlite3.Error as exc:
        raise AuditStoreError("failed to load audit events") from exc
    return [_row_to_event(row) for row in rows], total, effective_page


def _today_range() -> tuple[str, str]:
    local_zone = ZoneInfo("Asia/Shanghai")
    today = datetime.now(local_zone).date()
    start = datetime.combine(today, time.min, tzinfo=local_zone).astimezone(timezone.utc)
    end = (start + timedelta(days=1)).astimezone(timezone.utc)
    return start.isoformat(), end.isoformat()


def get_today_summary() -> dict[str, int]:
    start, end = _today_range()
    try:
        with _connect() as connection:
            _ensure_schema(connection)
            rows = connection.execute(
                "SELECT * FROM audit_events WHERE created_at >= ? AND created_at < ?", (start, end)
            ).fetchall()
    except sqlite3.Error as exc:
        raise AuditStoreError("failed to load audit summary") from exc

    events = [_row_to_event(row) for row in rows]
    applicants = {
        str(event.metadata.get("email") or "").lower()
        for event in events
        if event.event_type == "qualification_application" and event.metadata.get("email")
    }
    login_users = {event.username for event in events if event.event_type == "login_success" and event.username}
    dashboard_users = {event.username for event in events if event.event_type == "dashboard_view" and event.username}
    return {
        "today_qr_visits": sum(event.event_type == "qr_visit" for event in events),
        "today_qualification_applicants": len(applicants),
        "today_login_users": len(login_users),
        "today_dashboard_users": len(dashboard_users),
    }
