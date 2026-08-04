from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any

from .config import settings


ACTIVE_STATUSES = ("pending", "running")


class IntelligenceStoreError(Exception):
    pass


class ActiveExecutionError(IntelligenceStoreError):
    pass


class IntelligenceNotFoundError(IntelligenceStoreError):
    pass


class TopicNameConflictError(IntelligenceStoreError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _decode(value: object, fallback: object) -> object:
    if value is None or value == "":
        return fallback
    try:
        return json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


class IntelligenceStore:
    """Small SQLite repository sharing the existing user DB by default."""

    _schema_lock = threading.RLock()

    def __init__(self) -> None:
        self._recovery_lock = threading.Lock()
        self._recovered = False

    @property
    def db_path(self):
        return settings.custom_intelligence_db_path

    def _connect(self) -> sqlite3.Connection:
        path = self.db_path
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path, timeout=30, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        return connection

    def ensure_schema(self, connection: sqlite3.Connection | None = None) -> None:
        owns_connection = connection is None
        if owns_connection:
            connection = self._connect()
        assert connection is not None
        with self._schema_lock:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS intelligence_topics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    owner_user_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    keywords_json TEXT NOT NULL DEFAULT '[]',
                    focus_objects_json TEXT NOT NULL DEFAULT '[]',
                    analysis_perspective TEXT NOT NULL,
                    time_range TEXT NOT NULL,
                    source_preference TEXT NOT NULL,
                    specified_sites_json TEXT NOT NULL DEFAULT '[]',
                    report_type TEXT NOT NULL,
                    analysis_depth TEXT NOT NULL,
                    extra_requirements TEXT NOT NULL DEFAULT '',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_by_user_id INTEGER NOT NULL,
                    updated_by_user_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_intelligence_topics_owner_name
                    ON intelligence_topics(owner_user_id, name);
                CREATE INDEX IF NOT EXISTS idx_intelligence_topics_owner_updated
                    ON intelligence_topics(owner_user_id, updated_at DESC);
                CREATE TABLE IF NOT EXISTS intelligence_executions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    owner_user_id INTEGER NOT NULL,
                    topic_id INTEGER,
                    trigger_type TEXT NOT NULL,
                    topic_name TEXT NOT NULL DEFAULT '',
                    snapshot_json TEXT NOT NULL,
                    original_query TEXT NOT NULL DEFAULT '',
                    final_query TEXT NOT NULL DEFAULT '',
                    request_payload_json TEXT NOT NULL DEFAULT '{}',
                    report_json TEXT NOT NULL DEFAULT '{}',
                    sources_json TEXT NOT NULL DEFAULT '[]',
                    reference_aliases_json TEXT NOT NULL DEFAULT '{}',
                    status TEXT NOT NULL,
                    error_message TEXT,
                    request_id TEXT,
                    created_by_user_id INTEGER NOT NULL,
                    executed_by_user_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_intelligence_executions_owner_created
                    ON intelligence_executions(owner_user_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_intelligence_executions_status
                    ON intelligence_executions(status);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_intelligence_executions_owner_active
                    ON intelligence_executions(owner_user_id)
                    WHERE status IN ('pending', 'running');
                """
            )
            connection.commit()
        if owns_connection:
            connection.close()

    def recover_stale_executions(self) -> int:
        """Mark activities left by a previous process as failed, once per worker."""
        with self._recovery_lock:
            if self._recovered:
                return 0
            self._recovered = True
            try:
                with self._connect() as connection:
                    self.ensure_schema(connection)
                    cursor = connection.execute(
                        """
                        UPDATE intelligence_executions
                        SET status = 'failed',
                            error_message = '服务重启导致执行中断',
                            completed_at = COALESCE(completed_at, ?)
                        WHERE status IN ('pending', 'running')
                        """,
                        (utc_now(),),
                    )
                    connection.commit()
                    return int(cursor.rowcount)
            except sqlite3.Error as exc:
                raise IntelligenceStoreError("failed to recover intelligence executions") from exc

    @staticmethod
    def _topic_from_row(row: sqlite3.Row) -> dict[str, object]:
        return {
            "id": int(row["id"]),
            "owner_user_id": int(row["owner_user_id"]),
            "name": str(row["name"]),
            "description": str(row["description"] or ""),
            "keywords": _decode(row["keywords_json"], []),
            "focus_objects": _decode(row["focus_objects_json"], []),
            "analysis_perspective": str(row["analysis_perspective"]),
            "time_range": str(row["time_range"]),
            "source_preference": str(row["source_preference"]),
            "specified_sites": _decode(row["specified_sites_json"], []),
            "report_type": str(row["report_type"]),
            "analysis_depth": str(row["analysis_depth"]),
            "extra_requirements": str(row["extra_requirements"] or ""),
            "enabled": bool(row["enabled"]),
            "created_by_user_id": int(row["created_by_user_id"]),
            "updated_by_user_id": int(row["updated_by_user_id"]),
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
        }

    @staticmethod
    def _execution_from_row(row: sqlite3.Row) -> dict[str, object]:
        return {
            "id": int(row["id"]),
            "owner_user_id": int(row["owner_user_id"]),
            "topic_id": int(row["topic_id"]) if row["topic_id"] is not None else None,
            "trigger_type": str(row["trigger_type"]),
            "topic_name": str(row["topic_name"] or ""),
            "snapshot": _decode(row["snapshot_json"], {}),
            "original_query": str(row["original_query"] or ""),
            "final_query": str(row["final_query"] or ""),
            "request_payload": _decode(row["request_payload_json"], {}),
            "report": _decode(row["report_json"], {}),
            "sources": _decode(row["sources_json"], []),
            "reference_aliases": _decode(row["reference_aliases_json"], {}),
            "status": str(row["status"]),
            "error_message": str(row["error_message"]) if row["error_message"] else None,
            "request_id": str(row["request_id"]) if row["request_id"] else None,
            "created_by_user_id": int(row["created_by_user_id"]),
            "executed_by_user_id": int(row["executed_by_user_id"]),
            "created_at": str(row["created_at"]),
            "started_at": str(row["started_at"]) if row["started_at"] else None,
            "completed_at": str(row["completed_at"]) if row["completed_at"] else None,
        }

    def create_topic(self, owner_user_id: int, payload: dict[str, object], actor_user_id: int) -> dict[str, object]:
        now = utc_now()
        try:
            with self._connect() as connection:
                self.ensure_schema(connection)
                cursor = connection.execute(
                    """
                    INSERT INTO intelligence_topics
                        (owner_user_id, name, description, keywords_json, focus_objects_json,
                         analysis_perspective, time_range, source_preference, specified_sites_json,
                         report_type, analysis_depth, extra_requirements, enabled,
                         created_by_user_id, updated_by_user_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                    """,
                    (
                        owner_user_id,
                        payload["name"],
                        payload.get("description", ""),
                        _json(payload.get("keywords", [])),
                        _json(payload.get("focus_objects", [])),
                        payload["analysis_perspective"],
                        payload["time_range"],
                        payload["source_preference"],
                        _json(payload.get("specified_sites", [])),
                        payload["report_type"],
                        payload["analysis_depth"],
                        payload.get("extra_requirements", ""),
                        actor_user_id,
                        actor_user_id,
                        now,
                        now,
                    ),
                )
                row = connection.execute("SELECT * FROM intelligence_topics WHERE id = ?", (cursor.lastrowid,)).fetchone()
        except sqlite3.IntegrityError as exc:
            raise TopicNameConflictError("topic name already exists") from exc
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to create intelligence topic") from exc
        if row is None:
            raise IntelligenceStoreError("failed to create intelligence topic")
        return self._topic_from_row(row)

    def list_topics(self, owner_user_id: int) -> list[dict[str, object]]:
        try:
            with self._connect() as connection:
                self.ensure_schema(connection)
                rows = connection.execute(
                    "SELECT * FROM intelligence_topics WHERE owner_user_id = ? ORDER BY updated_at DESC, id DESC",
                    (owner_user_id,),
                ).fetchall()
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to list intelligence topics") from exc
        return [self._topic_from_row(row) for row in rows]

    def get_topic(self, owner_user_id: int, topic_id: int) -> dict[str, object]:
        try:
            with self._connect() as connection:
                self.ensure_schema(connection)
                row = connection.execute(
                    "SELECT * FROM intelligence_topics WHERE id = ? AND owner_user_id = ?",
                    (topic_id, owner_user_id),
                ).fetchone()
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to load intelligence topic") from exc
        if row is None:
            raise IntelligenceNotFoundError("topic not found")
        return self._topic_from_row(row)

    def update_topic(
        self,
        owner_user_id: int,
        topic_id: int,
        payload: dict[str, object],
        actor_user_id: int,
    ) -> dict[str, object]:
        now = utc_now()
        try:
            with self._connect() as connection:
                self.ensure_schema(connection)
                cursor = connection.execute(
                    """
                    UPDATE intelligence_topics
                    SET name = ?, description = ?, keywords_json = ?, focus_objects_json = ?,
                        analysis_perspective = ?, time_range = ?, source_preference = ?,
                        specified_sites_json = ?, report_type = ?, analysis_depth = ?,
                        extra_requirements = ?, updated_by_user_id = ?, updated_at = ?
                    WHERE id = ? AND owner_user_id = ?
                    """,
                    (
                        payload["name"],
                        payload.get("description", ""),
                        _json(payload.get("keywords", [])),
                        _json(payload.get("focus_objects", [])),
                        payload["analysis_perspective"],
                        payload["time_range"],
                        payload["source_preference"],
                        _json(payload.get("specified_sites", [])),
                        payload["report_type"],
                        payload["analysis_depth"],
                        payload.get("extra_requirements", ""),
                        actor_user_id,
                        now,
                        topic_id,
                        owner_user_id,
                    ),
                )
                if cursor.rowcount == 0:
                    exists = connection.execute("SELECT 1 FROM intelligence_topics WHERE id = ?", (topic_id,)).fetchone()
                    if exists is None:
                        raise IntelligenceNotFoundError("topic not found")
                    raise IntelligenceNotFoundError("topic not found")
                row = connection.execute("SELECT * FROM intelligence_topics WHERE id = ?", (topic_id,)).fetchone()
        except IntelligenceNotFoundError:
            raise
        except sqlite3.IntegrityError as exc:
            raise TopicNameConflictError("topic name already exists") from exc
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to update intelligence topic") from exc
        if row is None:
            raise IntelligenceNotFoundError("topic not found")
        return self._topic_from_row(row)

    def set_topic_enabled(self, owner_user_id: int, topic_id: int, enabled: bool, actor_user_id: int) -> dict[str, object]:
        try:
            with self._connect() as connection:
                self.ensure_schema(connection)
                cursor = connection.execute(
                    "UPDATE intelligence_topics SET enabled = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ? AND owner_user_id = ?",
                    (1 if enabled else 0, actor_user_id, utc_now(), topic_id, owner_user_id),
                )
                if cursor.rowcount == 0:
                    raise IntelligenceNotFoundError("topic not found")
                row = connection.execute("SELECT * FROM intelligence_topics WHERE id = ?", (topic_id,)).fetchone()
        except IntelligenceNotFoundError:
            raise
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to update intelligence topic status") from exc
        if row is None:
            raise IntelligenceNotFoundError("topic not found")
        return self._topic_from_row(row)

    def create_execution(
        self,
        owner_user_id: int,
        snapshot: dict[str, object],
        trigger_type: str,
        actor_user_id: int,
        topic_id: int | None = None,
        topic_name: str = "",
        original_query: str = "",
        final_query: str = "",
        request_payload: dict[str, object] | None = None,
    ) -> dict[str, object]:
        now = utc_now()
        try:
            with self._connect() as connection:
                self.ensure_schema(connection)
                cursor = connection.execute(
                    """
                    INSERT INTO intelligence_executions
                        (owner_user_id, topic_id, trigger_type, topic_name, snapshot_json,
                         original_query, final_query, request_payload_json, status,
                         created_by_user_id, executed_by_user_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
                    """,
                    (
                        owner_user_id,
                        topic_id,
                        trigger_type,
                        topic_name,
                        _json(snapshot),
                        original_query,
                        final_query,
                        _json(request_payload or {}),
                        actor_user_id,
                        actor_user_id,
                        now,
                    ),
                )
                row = connection.execute("SELECT * FROM intelligence_executions WHERE id = ?", (cursor.lastrowid,)).fetchone()
        except sqlite3.IntegrityError as exc:
            if "idx_intelligence_executions_owner_active" in str(exc) or "UNIQUE constraint failed: intelligence_executions.owner_user_id" in str(exc):
                raise ActiveExecutionError("an intelligence execution is already active") from exc
            raise IntelligenceStoreError("failed to create intelligence execution") from exc
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to create intelligence execution") from exc
        if row is None:
            raise IntelligenceStoreError("failed to create intelligence execution")
        return self._execution_from_row(row)

    def get_execution(self, owner_user_id: int, execution_id: int) -> dict[str, object]:
        try:
            with self._connect() as connection:
                self.ensure_schema(connection)
                row = connection.execute(
                    "SELECT * FROM intelligence_executions WHERE id = ? AND owner_user_id = ?",
                    (execution_id, owner_user_id),
                ).fetchone()
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to load intelligence execution") from exc
        if row is None:
            raise IntelligenceNotFoundError("execution not found")
        return self._execution_from_row(row)

    def list_executions(self, owner_user_id: int, page: int = 1, page_size: int = 20) -> tuple[list[dict[str, object]], dict[str, object]]:
        page = max(1, page)
        page_size = max(1, min(100, page_size))
        try:
            with self._connect() as connection:
                self.ensure_schema(connection)
                total = int(
                    connection.execute(
                        "SELECT COUNT(*) FROM intelligence_executions WHERE owner_user_id = ?", (owner_user_id,)
                    ).fetchone()[0]
                )
                total_pages = max(1, (total + page_size - 1) // page_size)
                effective_page = min(page, total_pages)
                rows = connection.execute(
                    """
                    SELECT * FROM intelligence_executions
                    WHERE owner_user_id = ?
                    ORDER BY created_at DESC, id DESC
                    LIMIT ? OFFSET ?
                    """,
                    (owner_user_id, page_size, (effective_page - 1) * page_size),
                ).fetchall()
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to list intelligence executions") from exc
        return [self._execution_from_row(row) for row in rows], {
            "page": effective_page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
        }

    def update_execution(self, execution_id: int, **updates: object) -> dict[str, object]:
        allowed = {
            "status",
            "started_at",
            "completed_at",
            "report_json",
            "sources_json",
            "reference_aliases_json",
            "error_message",
            "request_id",
            "final_query",
            "request_payload_json",
        }
        values = {key: value for key, value in updates.items() if key in allowed}
        if not values:
            return self.get_execution_by_id(execution_id)
        assignments = ", ".join(f"{key} = ?" for key in values)
        parameters = [values[key] for key in values]
        parameters.append(execution_id)
        try:
            with self._connect() as connection:
                self.ensure_schema(connection)
                cursor = connection.execute(
                    f"UPDATE intelligence_executions SET {assignments} WHERE id = ?",
                    parameters,
                )
                if cursor.rowcount == 0:
                    raise IntelligenceNotFoundError("execution not found")
                row = connection.execute("SELECT * FROM intelligence_executions WHERE id = ?", (execution_id,)).fetchone()
        except IntelligenceNotFoundError:
            raise
        except sqlite3.IntegrityError as exc:
            raise ActiveExecutionError("an intelligence execution is already active") from exc
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to update intelligence execution") from exc
        if row is None:
            raise IntelligenceNotFoundError("execution not found")
        return self._execution_from_row(row)

    def get_execution_by_id(self, execution_id: int) -> dict[str, object]:
        try:
            with self._connect() as connection:
                self.ensure_schema(connection)
                row = connection.execute("SELECT * FROM intelligence_executions WHERE id = ?", (execution_id,)).fetchone()
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to load intelligence execution") from exc
        if row is None:
            raise IntelligenceNotFoundError("execution not found")
        return self._execution_from_row(row)


store = IntelligenceStore()
