from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.matching import incremental_state

from .config import settings


BASELINE_SCHEMA_VERSION = "1.0"
BASELINE_FILENAME = "matching_baseline.json"


def _read_csv(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames is None:
            return []
        return [
            {str(key or "").strip(): "" if value is None else str(value).strip() for key, value in row.items()}
            for row in reader
        ]


def _file_keys(rows: list[dict[str, str]]) -> list[list[str]]:
    values = {
        (str(row.get("broker_folder") or "").strip(), str(row.get("markdown_file") or "").strip())
        for row in rows
    }
    return [list(value) for value in sorted(value for value in values if all(value))]


def _portable_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    portable: list[dict[str, str]] = []
    for row in rows:
        updated = dict(row)
        path_fields = {
            field
            for field in updated
            if field in {"source_file", "markdown_file", "broker_folder"}
            or field.lower().endswith(("_path", "_file", "_dir", "_root"))
        }
        for field in path_fields:
            value = str(updated.get(field) or "").strip().replace("\\", "/")
            if value:
                updated[field] = value.rsplit("/", 1)[-1]
        portable.append(updated)
    return portable


def build_matching_baseline(paths: dict[str, Path] | None = None) -> dict[str, Any] | None:
    active_paths = paths or {
        "procurement": settings.matching_procurement_csv_path,
        "result": settings.matching_result_csv_path,
        "verified_links": settings.matching_verified_links_path,
    }
    procurement_rows = _read_csv(active_paths["procurement"])
    result_rows = _read_csv(active_paths["result"])
    verified_links = _read_csv(active_paths["verified_links"])
    if not procurement_rows or not result_rows or not verified_links:
        return None
    procurement_rows = _portable_rows(procurement_rows)
    result_rows = _portable_rows(result_rows)
    verified_links = _portable_rows(verified_links)
    state = incremental_state.build_state(procurement_rows, result_rows, verified_links)
    payload = {
        "schema_version": BASELINE_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "procurement_rows": procurement_rows,
        "result_rows": result_rows,
        "verified_links": verified_links,
        "matching_state": state,
        "preserved_file_keys": {
            "procurement": _file_keys(procurement_rows),
            "result": _file_keys(result_rows),
        },
        "preserved_notice_ids": {
            "procurement": sorted({incremental_state.notice_id(row) for row in procurement_rows}),
            "result": sorted({incremental_state.notice_id(row) for row in result_rows}),
        },
    }
    try:
        return validate_matching_baseline(payload)
    except ValueError:
        return None


def validate_matching_baseline(payload: object) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("matching_baseline.json 必须是 JSON 对象")
    expected = {
        "schema_version",
        "generated_at",
        "procurement_rows",
        "result_rows",
        "verified_links",
        "matching_state",
        "preserved_file_keys",
        "preserved_notice_ids",
    }
    if set(payload) != expected or payload.get("schema_version") != BASELINE_SCHEMA_VERSION:
        raise ValueError("matching_baseline.json 版本或字段结构无效")
    for key in ("procurement_rows", "result_rows", "verified_links"):
        rows = payload.get(key)
        if not isinstance(rows, list) or not rows or not all(isinstance(row, dict) for row in rows):
            raise ValueError(f"matching_baseline.json.{key} 必须是非空对象数组")
    state = payload.get("matching_state")
    if not isinstance(state, dict) or not isinstance(state.get("results"), dict):
        raise ValueError("matching_baseline.json.matching_state 结构无效")
    procurements = {incremental_state.notice_id(row) for row in payload["procurement_rows"]}
    results = {incremental_state.notice_id(row) for row in payload["result_rows"]}
    if "" in procurements or "" in results or len(results) != len(payload["result_rows"]):
        raise ValueError("matching_baseline.json 包含缺失或重复公告 ID")
    verified_ids = {str(row.get("result_notice_id") or "").strip() for row in payload["verified_links"]}
    if "" in verified_ids or len(verified_ids) != len(payload["verified_links"]) or verified_ids != results:
        raise ValueError("matching_baseline.json 匹配状态与结果公告不一致")
    expected_notice_ids = {
        "procurement": sorted(procurements),
        "result": sorted(results),
    }
    if payload.get("preserved_notice_ids") != expected_notice_ids:
        raise ValueError("matching_baseline.json 保留公告 ID 索引无效")
    expected_file_keys = {
        "procurement": _file_keys(payload["procurement_rows"]),
        "result": _file_keys(payload["result_rows"]),
    }
    if payload.get("preserved_file_keys") != expected_file_keys:
        raise ValueError("matching_baseline.json 保留文件索引无效")
    if set(state["results"]) != results:
        raise ValueError("matching_baseline.json 增量状态与结果公告不一致")
    expected_state = incremental_state.build_state(
        payload["procurement_rows"], payload["result_rows"], payload["verified_links"]
    )
    if state.get("procurement_hashes") != expected_state["procurement_hashes"]:
        raise ValueError("matching_baseline.json 采购公告摘要无效")
    for result_id in results:
        if state["results"].get(result_id) != expected_state["results"].get(result_id):
            raise ValueError("matching_baseline.json 结果公告摘要或匹配状态无效")
    for row in payload["verified_links"]:
        procurement_id = str(row.get("procurement_notice_id") or "").strip()
        if row.get("final_status") == "auto_matched" and procurement_id not in procurements:
            raise ValueError("matching_baseline.json 匹配关系引用了不存在的采购公告")
    return payload


def csv_bytes(rows: list[dict[str, Any]]) -> bytes:
    import io

    fields: list[str] = []
    for row in rows:
        for field in row:
            if field not in fields:
                fields.append(field)
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows([{field: row.get(field, "") for field in fields} for row in rows])
    return ("\ufeff" + output.getvalue()).encode("utf-8")
