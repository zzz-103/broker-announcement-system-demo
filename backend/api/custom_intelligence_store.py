from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

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


class TopicLimitError(IntelligenceStoreError):
    pass


# Maximum number of saved configuration combinations per user.
TOPICS_PER_USER_LIMIT = 10


# Per-user execution history retention. Oldest finished records beyond this
# limit are pruned when a new execution is created; pending/running records
# are never deleted.
EXECUTIONS_RETENTION = 50


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

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            yield connection
        except Exception:
            connection.rollback()
            raise
        else:
            connection.commit()
        finally:
            connection.close()

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
                    search_answer TEXT NOT NULL DEFAULT '',
                    search_followups_json TEXT NOT NULL DEFAULT '[]',
                    status TEXT NOT NULL,
                    error_message TEXT,
                    search_status TEXT NOT NULL DEFAULT 'pending',
                    analysis_status TEXT NOT NULL DEFAULT 'pending',
                    search_error_message TEXT,
                    analysis_error_message TEXT,
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
                CREATE TABLE IF NOT EXISTS intelligence_search_config (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    enabled INTEGER NOT NULL DEFAULT 1,
                    api_key TEXT NOT NULL DEFAULT '',
                    model TEXT NOT NULL DEFAULT '',
                    endpoint TEXT NOT NULL DEFAULT 'https://qianfan.baidubce.com/v2/ai_search/web_search',
                    auth_header TEXT NOT NULL DEFAULT 'Authorization',
                    timeout_seconds REAL NOT NULL DEFAULT 120,
                    updated_at TEXT NOT NULL,
                    updated_by_user_id INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS intelligence_search_test (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    status TEXT NOT NULL DEFAULT 'unknown',
                    message TEXT NOT NULL DEFAULT '',
                    tested_at TEXT
                );
                """
            )
            columns = {
                str(row["name"])
                for row in connection.execute("PRAGMA table_info(intelligence_executions)").fetchall()
            }
            if "search_status" not in columns:
                connection.execute(
                    "ALTER TABLE intelligence_executions ADD COLUMN search_status TEXT NOT NULL DEFAULT 'pending'"
                )
            if "analysis_status" not in columns:
                connection.execute(
                    "ALTER TABLE intelligence_executions ADD COLUMN analysis_status TEXT NOT NULL DEFAULT 'pending'"
                )
            if "search_error_message" not in columns:
                connection.execute(
                    "ALTER TABLE intelligence_executions ADD COLUMN search_error_message TEXT"
                )
            if "analysis_error_message" not in columns:
                connection.execute(
                    "ALTER TABLE intelligence_executions ADD COLUMN analysis_error_message TEXT"
                )
            if "search_answer" not in columns:
                connection.execute(
                    "ALTER TABLE intelligence_executions ADD COLUMN search_answer TEXT NOT NULL DEFAULT ''"
                )
            if "search_followups_json" not in columns:
                connection.execute(
                    "ALTER TABLE intelligence_executions ADD COLUMN search_followups_json TEXT NOT NULL DEFAULT '[]'"
                )
            topic_columns = {
                str(row["name"])
                for row in connection.execute("PRAGMA table_info(intelligence_topics)").fetchall()
            }
            if "question" not in topic_columns:
                connection.execute(
                    "ALTER TABLE intelligence_topics ADD COLUMN question TEXT NOT NULL DEFAULT ''"
                )
            connection.execute(
                """
                UPDATE intelligence_search_config
                SET endpoint = 'https://qianfan.baidubce.com/v2/ai_search/web_search'
                WHERE endpoint = 'https://qianfan.baidubce.com/v2/ai_search/chat/completions'
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
                with self._connection() as connection:
                    self.ensure_schema(connection)
                    search_cursor = connection.execute(
                        """
                        UPDATE intelligence_executions
                        SET status = 'failed',
                            error_message = '服务重启导致执行中断',
                            search_status = 'failed',
                            analysis_status = 'not_run',
                            search_error_message = '服务重启导致检索中断',
                            completed_at = COALESCE(completed_at, ?)
                        WHERE status IN ('pending', 'running')
                          AND search_status != 'succeeded'
                        """,
                        (utc_now(),),
                    )
                    analysis_cursor = connection.execute(
                        """
                        UPDATE intelligence_executions
                        SET status = 'failed',
                            error_message = '服务重启导致分析中断',
                            analysis_status = 'failed',
                            analysis_error_message = '服务重启导致分析中断',
                            completed_at = COALESCE(completed_at, ?)
                        WHERE status IN ('pending', 'running')
                          AND search_status = 'succeeded'
                        """,
                        (utc_now(),),
                    )
                    connection.commit()
                    return int(search_cursor.rowcount) + int(analysis_cursor.rowcount)
            except sqlite3.Error as exc:
                raise IntelligenceStoreError("failed to recover intelligence executions") from exc

    @staticmethod
    def _topic_from_row(row: sqlite3.Row) -> dict[str, object]:
        return {
            "id": int(row["id"]),
            "owner_user_id": int(row["owner_user_id"]),
            "name": str(row["name"]),
            "question": str(row["question"] or "") if "question" in row.keys() else "",
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
            "search_answer": str(row["search_answer"] or ""),
            "search_followups": _decode(row["search_followups_json"], []),
            "status": str(row["status"]),
            "error_message": str(row["error_message"]) if row["error_message"] else None,
            "search_status": str(row["search_status"] or "pending"),
            "analysis_status": str(row["analysis_status"] or "pending"),
            "search_error_message": str(row["search_error_message"]) if row["search_error_message"] else None,
            "analysis_error_message": str(row["analysis_error_message"]) if row["analysis_error_message"] else None,
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
            with self._connection() as connection:
                self.ensure_schema(connection)
                existing = connection.execute(
                    "SELECT COUNT(*) AS total FROM intelligence_topics WHERE owner_user_id = ?",
                    (owner_user_id,),
                ).fetchone()
                if existing is not None and int(existing["total"]) >= TOPICS_PER_USER_LIMIT:
                    raise TopicLimitError("saved configuration limit reached")
                cursor = connection.execute(
                    """
                    INSERT INTO intelligence_topics
                        (owner_user_id, name, question, description, keywords_json, focus_objects_json,
                         analysis_perspective, time_range, source_preference, specified_sites_json,
                         report_type, analysis_depth, extra_requirements, enabled,
                         created_by_user_id, updated_by_user_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                    """,
                    (
                        owner_user_id,
                        payload["name"],
                        payload.get("question", ""),
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
        except TopicLimitError:
            raise
        except sqlite3.IntegrityError as exc:
            raise TopicNameConflictError("topic name already exists") from exc
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to create intelligence topic") from exc
        if row is None:
            raise IntelligenceStoreError("failed to create intelligence topic")
        return self._topic_from_row(row)

    def list_topics(self, owner_user_id: int) -> list[dict[str, object]]:
        try:
            with self._connection() as connection:
                self.ensure_schema(connection)
                rows = connection.execute(
                    "SELECT * FROM intelligence_topics WHERE owner_user_id = ? ORDER BY updated_at DESC, id DESC",
                    (owner_user_id,),
                ).fetchall()
                execution_rows = connection.execute(
                    """
                    SELECT execution.*
                    FROM intelligence_executions AS execution
                    INNER JOIN (
                        SELECT topic_id, MAX(id) AS execution_id
                        FROM intelligence_executions
                        WHERE owner_user_id = ? AND topic_id IS NOT NULL
                        GROUP BY topic_id
                    ) AS latest ON latest.execution_id = execution.id
                    """,
                    (owner_user_id,),
                ).fetchall()
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to list intelligence topics") from exc
        latest_by_topic = {
            int(row["topic_id"]): self._execution_from_row(row)
            for row in execution_rows
            if row["topic_id"] is not None
        }
        topics = [self._topic_from_row(row) for row in rows]
        for topic in topics:
            topic["latest_execution"] = latest_by_topic.get(int(topic["id"]))
        return topics

    def get_topic(self, owner_user_id: int, topic_id: int) -> dict[str, object]:
        try:
            with self._connection() as connection:
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
            with self._connection() as connection:
                self.ensure_schema(connection)
                cursor = connection.execute(
                    """
                    UPDATE intelligence_topics
                    SET name = ?, question = ?, description = ?, keywords_json = ?, focus_objects_json = ?,
                        analysis_perspective = ?, time_range = ?, source_preference = ?,
                        specified_sites_json = ?, report_type = ?, analysis_depth = ?,
                        extra_requirements = ?, updated_by_user_id = ?, updated_at = ?
                    WHERE id = ? AND owner_user_id = ?
                    """,
                    (
                        payload["name"],
                        payload.get("question", ""),
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

    def delete_topic(self, owner_user_id: int, topic_id: int) -> None:
        try:
            with self._connection() as connection:
                self.ensure_schema(connection)
                active = connection.execute(
                    """
                    SELECT 1 FROM intelligence_executions
                    WHERE owner_user_id = ? AND topic_id = ? AND status IN ('pending', 'running')
                    LIMIT 1
                    """,
                    (owner_user_id, topic_id),
                ).fetchone()
                if active is not None:
                    raise ActiveExecutionError("cannot delete a topic while it is executing")
                cursor = connection.execute(
                    "DELETE FROM intelligence_topics WHERE id = ? AND owner_user_id = ?",
                    (topic_id, owner_user_id),
                )
                if cursor.rowcount == 0:
                    raise IntelligenceNotFoundError("topic not found")
                connection.commit()
        except (ActiveExecutionError, IntelligenceNotFoundError):
            raise
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to delete intelligence topic") from exc

    def set_topic_enabled(self, owner_user_id: int, topic_id: int, enabled: bool, actor_user_id: int) -> dict[str, object]:
        try:
            with self._connection() as connection:
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

    @staticmethod
    def _search_config_from_row(row: sqlite3.Row) -> dict[str, object]:
        return {
            "id": int(row["id"]),
            "enabled": bool(row["enabled"]),
            "api_key": str(row["api_key"] or ""),
            "model": str(row["model"] or ""),
            "endpoint": str(row["endpoint"] or ""),
            "auth_header": str(row["auth_header"] or ""),
            "timeout_seconds": float(row["timeout_seconds"] or 0),
            "updated_at": str(row["updated_at"] or ""),
            "updated_by_user_id": int(row["updated_by_user_id"] or 0),
        }

    def get_search_config_row(self) -> dict[str, object] | None:
        try:
            with self._connection() as connection:
                self.ensure_schema(connection)
                row = connection.execute(
                    "SELECT * FROM intelligence_search_config WHERE id = 1"
                ).fetchone()
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to load intelligence search config") from exc
        return self._search_config_from_row(row) if row is not None else None

    def save_search_config(
        self,
        *,
        enabled: bool,
        endpoint: str,
        auth_header: str,
        timeout_seconds: float,
        updated_by_user_id: int,
        api_key: str = "",
    ) -> dict[str, object]:
        now = utc_now()
        try:
            with self._connection() as connection:
                self.ensure_schema(connection)
                connection.execute(
                    """
                    INSERT INTO intelligence_search_config
                        (id, enabled, api_key, model, endpoint, auth_header,
                         timeout_seconds, updated_at, updated_by_user_id)
                    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        enabled = excluded.enabled,
                        api_key = excluded.api_key,
                        model = excluded.model,
                        endpoint = excluded.endpoint,
                        auth_header = excluded.auth_header,
                        timeout_seconds = excluded.timeout_seconds,
                        updated_at = excluded.updated_at,
                        updated_by_user_id = excluded.updated_by_user_id
                    """,
                    (
                        1 if enabled else 0,
                        api_key,
                        "",
                        endpoint,
                        auth_header,
                        timeout_seconds,
                        now,
                        updated_by_user_id,
                    ),
                )
                row = connection.execute(
                    "SELECT * FROM intelligence_search_config WHERE id = 1"
                ).fetchone()
                connection.commit()
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to save intelligence search config") from exc
        if row is None:
            raise IntelligenceStoreError("failed to save intelligence search config")
        return self._search_config_from_row(row)

    def get_search_test(self) -> dict[str, object] | None:
        try:
            with self._connection() as connection:
                self.ensure_schema(connection)
                row = connection.execute(
                    "SELECT * FROM intelligence_search_test WHERE id = 1"
                ).fetchone()
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to load intelligence search test") from exc
        if row is None:
            return None
        return {
            "status": str(row["status"] or ""),
            "message": str(row["message"] or ""),
            "tested_at": str(row["tested_at"]) if row["tested_at"] else None,
        }

    def save_search_test(self, *, status: str, message: str, tested_at: str) -> dict[str, object]:
        try:
            with self._connection() as connection:
                self.ensure_schema(connection)
                connection.execute(
                    """
                    INSERT INTO intelligence_search_test (id, status, message, tested_at)
                    VALUES (1, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        status = excluded.status,
                        message = excluded.message,
                        tested_at = excluded.tested_at
                    """,
                    (status, message, tested_at),
                )
                row = connection.execute(
                    "SELECT * FROM intelligence_search_test WHERE id = 1"
                ).fetchone()
                connection.commit()
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to save intelligence search test") from exc
        if row is None:
            raise IntelligenceStoreError("failed to save intelligence search test")
        return {
            "status": str(row["status"] or ""),
            "message": str(row["message"] or ""),
            "tested_at": str(row["tested_at"]) if row["tested_at"] else None,
        }

    @staticmethod
    def _prune_executions(connection: sqlite3.Connection, owner_user_id: int) -> None:
        """Keep only the newest EXECUTIONS_RETENTION finished records per user.

        Pending/running records are never touched, and the caller is expected
        to run this inside the transaction that changes execution state.
        """
        connection.execute(
            """
            DELETE FROM intelligence_executions
            WHERE owner_user_id = ?
              AND status NOT IN ('pending', 'running')
              AND id NOT IN (
                  SELECT id FROM intelligence_executions
                  WHERE owner_user_id = ?
                    AND status NOT IN ('pending', 'running')
                  ORDER BY created_at DESC, id DESC
                  LIMIT ?
              )
            """,
            (owner_user_id, owner_user_id, EXECUTIONS_RETENTION),
        )

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
            with self._connection() as connection:
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
                self._prune_executions(connection, owner_user_id)
                connection.commit()
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
            with self._connection() as connection:
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
            with self._connection() as connection:
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
            "search_status",
            "analysis_status",
            "search_error_message",
            "analysis_error_message",
            "request_id",
            "final_query",
            "request_payload_json",
            "search_answer",
            "search_followups_json",
        }
        values = {key: value for key, value in updates.items() if key in allowed}
        if not values:
            return self.get_execution_by_id(execution_id)
        assignments = ", ".join(f"{key} = ?" for key in values)
        parameters = [values[key] for key in values]
        parameters.append(execution_id)
        try:
            with self._connection() as connection:
                self.ensure_schema(connection)
                cursor = connection.execute(
                    f"UPDATE intelligence_executions SET {assignments} WHERE id = ?",
                    parameters,
                )
                if cursor.rowcount == 0:
                    raise IntelligenceNotFoundError("execution not found")
                row = connection.execute("SELECT * FROM intelligence_executions WHERE id = ?", (execution_id,)).fetchone()
                if row is not None and values.get("status") in ("succeeded", "failed", "empty"):
                    self._prune_executions(connection, int(row["owner_user_id"]))
                    connection.commit()
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
            with self._connection() as connection:
                self.ensure_schema(connection)
                row = connection.execute("SELECT * FROM intelligence_executions WHERE id = ?", (execution_id,)).fetchone()
        except sqlite3.Error as exc:
            raise IntelligenceStoreError("failed to load intelligence execution") from exc
        if row is None:
            raise IntelligenceNotFoundError("execution not found")
        return self._execution_from_row(row)


store = IntelligenceStore()
