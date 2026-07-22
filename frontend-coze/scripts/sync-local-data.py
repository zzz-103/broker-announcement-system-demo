from __future__ import annotations

import csv
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
COZE_ROOT = PROJECT_ROOT / "frontend-coze"
SOURCE_DATA_DIR = PROJECT_ROOT / "backend" / "data"
PUBLIC_DATA_DIR = COZE_ROOT / "public" / "data"
MIGRATION_DIR = COZE_ROOT / "migration"

SENSITIVE_FIELD_NAMES = {
    "raw_json_path",
    "api_key",
    "apikey",
    "password",
    "password_hash",
    "token",
    "session",
    "debug",
    "traceback",
    "command",
}
LOCAL_OR_INTERNAL_VALUE = re.compile(
    r"(?i)(?:[a-z]:[\\/]|/Volumes/|/Users/|/home/|/app/|localhost|127\.0\.0\.1|"
    r"10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|"
    r"172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})"
)
SECRET_VALUE = re.compile(r"(?i)(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]")


def is_sensitive_field(name: str) -> bool:
    normalized = re.sub(r"[^a-z0-9_]", "", name.lower())
    return normalized in {re.sub(r"[^a-z0-9_]", "", item) for item in SENSITIVE_FIELD_NAMES} or any(
        marker in normalized for marker in ("debug", "traceback", "apikey", "password", "token")
    )


def redact_value(value: object) -> object:
    if not isinstance(value, str):
        return value
    if LOCAL_OR_INTERNAL_VALUE.search(value) or SECRET_VALUE.search(value):
        return ""
    return value


def scrub_json(value: object, key: str = "") -> object:
    if key and is_sensitive_field(key):
        return None
    if isinstance(value, dict):
        result: dict[str, object] = {}
        for child_key, child_value in value.items():
            if is_sensitive_field(str(child_key)):
                continue
            scrubbed = scrub_json(child_value, str(child_key))
            if scrubbed is not None:
                result[str(child_key)] = scrubbed
        return result
    if isinstance(value, list):
        return [scrub_json(item) for item in value]
    return redact_value(value)


def sync_announcements(source: Path, destination: Path) -> tuple[int, str]:
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        source_fields = reader.fieldnames or []
        fieldnames = [field for field in source_fields if not is_sensitive_field(field)]
        rows = []
        for row in reader:
            rows.append({field: str(redact_value(row.get(field, "") or "")) for field in fieldnames})

    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

    digest = hashlib.sha256(destination.read_bytes()).hexdigest()[:16]
    return len(rows), digest


def sync_analysis(source: Path, destination: Path) -> None:
    if not source.exists():
        return
    payload = json.loads(source.read_text(encoding="utf-8-sig"))
    scrubbed = scrub_json(payload)
    destination.write_text(json.dumps(scrubbed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def sync_users(source: Path, destination: Path) -> int:
    with sqlite3.connect(source) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT id, username, name, email, department, created_at
            FROM approved_users
            ORDER BY id ASC
            """
        ).fetchall()

    users = [
        {
            "id": int(row["id"]),
            "username": str(row["username"]),
            "name": str(row["name"]),
            "email": str(row["email"]),
            "department": str(row["department"]),
            "status": "active",
            "is_admin": False,
            "created_at": str(row["created_at"]),
            "updated_at": str(row["created_at"]),
            "password_state": "initialize_with_local_rule",
        }
        for row in rows
    ]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(users, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(users)


def main() -> None:
    source_csv = SOURCE_DATA_DIR / "announcement_table.csv"
    source_analysis = SOURCE_DATA_DIR / "ai-analysis.json"
    source_users = SOURCE_DATA_DIR / "users.db"
    destination_csv = PUBLIC_DATA_DIR / "announcement_table.csv"
    destination_analysis = PUBLIC_DATA_DIR / "ai-analysis.json"
    destination_manifest = PUBLIC_DATA_DIR / "manifest.json"
    destination_users = MIGRATION_DIR / "users-import.json"

    if not source_csv.exists():
        raise SystemExit(f"正式数据不存在: {source_csv}")
    if not source_users.exists():
        raise SystemExit(f"用户数据库不存在: {source_users}")

    record_count, digest = sync_announcements(source_csv, destination_csv)
    updated_at = datetime.fromtimestamp(source_csv.stat().st_mtime, timezone.utc).isoformat()
    sync_analysis(source_analysis, destination_analysis)
    user_count = sync_users(source_users, destination_users)
    manifest = {
        "version": f"local-{digest}",
        "updated_at": updated_at,
        "data_updated_at": updated_at,
        "record_count": record_count,
        "announcement_count": record_count,
        "analysis_updated_at": updated_at if source_analysis.exists() else None,
    }
    destination_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"synced announcements={record_count} users={user_count} version={manifest['version']}")


if __name__ == "__main__":
    main()
