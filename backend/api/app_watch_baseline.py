from __future__ import annotations

"""Portable App Watch processing history embedded in dashboard-data packages."""

import csv
import io
import json
import re
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

from backend.broker_app_watch.storage.models import APP_RELEASE_CSV_COLUMNS, AppReleaseRow


APP_WATCH_BASELINE_FILENAME = "app_watch_baseline.csv"


def _portable_markdown_file(value: object) -> str:
    text = str(value or "").strip().replace("\\", "/")
    if not text:
        return ""
    path = PurePosixPath(text)
    if path.is_absolute() or ".." in path.parts or re.match(r"^[A-Za-z]:/", text):
        return path.name
    return path.as_posix()


def _parse_rows(body: bytes, *, require_exact_contract: bool) -> list[AppReleaseRow]:
    try:
        text = body.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("app_watch_baseline.csv 不是有效 UTF-8 CSV") from exc
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""))
        fieldnames = tuple(reader.fieldnames or ())
        if not fieldnames or any(field not in APP_RELEASE_CSV_COLUMNS for field in fieldnames):
            raise ValueError("app_watch_baseline.csv 字段契约错误")
        if require_exact_contract and fieldnames != APP_RELEASE_CSV_COLUMNS:
            raise ValueError("app_watch_baseline.csv 字段名称或顺序错误")
        rows: list[AppReleaseRow] = []
        for index, raw in enumerate(reader):
            values = {column: raw.get(column, "") or "" for column in APP_RELEASE_CSV_COLUMNS}
            for field in ("feature_tags", "highlights"):
                value = values[field]
                if not value:
                    values[field] = []
                    continue
                try:
                    decoded = json.loads(value)
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"app_watch_baseline.csv 第 {index + 2} 行 {field} 不是合法 JSON"
                    ) from exc
                if not isinstance(decoded, list):
                    raise ValueError(
                        f"app_watch_baseline.csv 第 {index + 2} 行 {field} 必须是数组"
                    )
                values[field] = decoded
            try:
                row = AppReleaseRow.model_validate(values)
            except Exception as exc:
                raise ValueError(f"app_watch_baseline.csv 第 {index + 2} 行字段无效") from exc
            if row.source_url:
                parsed = urlsplit(row.source_url)
                if (
                    parsed.scheme not in {"http", "https"}
                    or not parsed.hostname
                    or parsed.username is not None
                    or parsed.password is not None
                    or parsed.hostname.lower() in {"localhost", "127.0.0.1", "::1"}
                ):
                    raise ValueError(
                        f"app_watch_baseline.csv 第 {index + 2} 行 source_url 无效"
                    )
            # Historical exports may contain non-SHA placeholders. They remain
            # portable history, but only a real 64-hex content hash participates
            # in the refresh pipeline's processed-identity skip gate.
            if row.content_sha256 and not re.fullmatch(r"[0-9a-fA-F]{64}", row.content_sha256):
                row.content_sha256 = ""
            row.markdown_file = _portable_markdown_file(row.markdown_file)
            rows.append(row)
    except csv.Error as exc:
        raise ValueError("app_watch_baseline.csv 无法解析") from exc
    if not rows:
        raise ValueError("app_watch_baseline.csv 必须包含至少一条结构化历史")
    return rows


def app_watch_csv_bytes(rows: list[AppReleaseRow]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=APP_RELEASE_CSV_COLUMNS)
    writer.writeheader()
    for row in rows:
        values = row.model_dump()
        values["markdown_file"] = _portable_markdown_file(values["markdown_file"])
        values["feature_tags"] = json.dumps(values["feature_tags"], ensure_ascii=False)
        values["highlights"] = json.dumps(values["highlights"], ensure_ascii=False)
        writer.writerow(values)
    return ("\ufeff" + output.getvalue()).encode("utf-8")


def build_app_watch_baseline(path: Path) -> bytes | None:
    if not path.is_file():
        return None
    rows = _parse_rows(path.read_bytes(), require_exact_contract=False)
    return app_watch_csv_bytes(rows)


def validate_app_watch_baseline(body: bytes) -> list[AppReleaseRow]:
    return _parse_rows(body, require_exact_contract=True)


def app_watch_baseline_skip_ready(body: bytes) -> bool:
    rows = validate_app_watch_baseline(body)
    return all(
        row.broker_code.strip()
        and row.source_url.strip()
        and re.fullmatch(r"[0-9a-fA-F]{64}", row.content_sha256)
        for row in rows
    )


def synthesize_app_watch_baseline(app_updates_body: bytes) -> bytes:
    """Best-effort migration for legacy packages without raw App history.

    Display rows retain the source identity and content hash needed by the
    refresh pipeline's skip gate, although older normalized packages may have
    already collapsed multiple source snapshots into one version event.
    """

    try:
        payload = json.loads(app_updates_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("app_updates.json 无法恢复 App Watch 增量基线") from exc
    if not isinstance(payload, list):
        raise ValueError("app_updates.json 无法恢复 App Watch 增量基线")
    rows: list[AppReleaseRow] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        values = {column: item.get(column, "") for column in APP_RELEASE_CSV_COLUMNS}
        values["markdown_file"] = ""
        try:
            rows.append(AppReleaseRow.model_validate(values))
        except Exception:
            continue
    if not rows:
        raise ValueError("旧版数据包没有可恢复的 App Watch 结构化历史")
    return app_watch_csv_bytes(rows)
