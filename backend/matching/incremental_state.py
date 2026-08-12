from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


STATE_VERSION = "1.0"
MATCHING_CORE_FIELDS = (
    "title",
    "project_name",
    "project_number",
    "purchaser",
    "broker_name",
    "package_number",
    "publish_date",
    "result_type",
    "result_status",
)


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def notice_id(row: dict[str, Any]) -> str:
    return text(
        row.get("notice_id")
        or row.get("document_sha1")
        or row.get("source_file")
        or row.get("markdown_file")
    )


def matching_content_hash(row: dict[str, Any]) -> str:
    """Return a stable digest for fields that can change a match decision."""
    document_sha1 = text(row.get("document_sha1"))
    if document_sha1:
        payload: object = {"document_sha1": document_sha1}
    else:
        payload = {field: text(row.get(field)) for field in MATCHING_CORE_FIELDS}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def grouped_content_hashes(rows: list[dict[str, Any]]) -> dict[str, str]:
    grouped: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        key = notice_id(row)
        if key:
            grouped[key].append(matching_content_hash(row))
    return {
        key: hashlib.sha256("\n".join(sorted(values)).encode("utf-8")).hexdigest()
        for key, values in grouped.items()
    }


def build_state(
    procurement_rows: list[dict[str, Any]],
    result_rows: list[dict[str, Any]],
    verified_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    procurement_hashes = grouped_content_hashes(procurement_rows)
    result_hashes = grouped_content_hashes(result_rows)
    verified_by_result = {
        text(row.get("result_notice_id")): row
        for row in verified_rows
        if text(row.get("result_notice_id"))
    }
    results: dict[str, dict[str, str]] = {}
    for result_notice_id, result_hash in result_hashes.items():
        verified = verified_by_result.get(result_notice_id, {})
        procurement_notice_id = text(verified.get("procurement_notice_id"))
        results[result_notice_id] = {
            "content_hash": result_hash,
            "final_status": text(verified.get("final_status")),
            "procurement_notice_id": procurement_notice_id,
            "procurement_content_hash": procurement_hashes.get(procurement_notice_id, ""),
        }
    return {
        "state_version": STATE_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "procurement_hashes": procurement_hashes,
        "results": results,
    }


def load_state(path: Path | None) -> dict[str, Any]:
    if path is None or not path.is_file():
        return {"state_version": STATE_VERSION, "procurement_hashes": {}, "results": {}}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {"state_version": STATE_VERSION, "procurement_hashes": {}, "results": {}}
    if not isinstance(payload, dict):
        return {"state_version": STATE_VERSION, "procurement_hashes": {}, "results": {}}
    procurement_hashes = payload.get("procurement_hashes")
    results = payload.get("results")
    if not isinstance(procurement_hashes, dict) or not isinstance(results, dict):
        return {"state_version": STATE_VERSION, "procurement_hashes": {}, "results": {}}
    return payload


def write_state_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2, sort_keys=True)
            file.write("\n")
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)

