"""Artifact readers and writers used by the Markdown extraction builder.

The builder owns extraction and business-field normalization.  This module
keeps filesystem and tabular artifact handling in one place so every output
uses the same same-directory temporary-file + ``os.replace`` protocol.
"""

from __future__ import annotations

import csv
import json
import os
import time
from pathlib import Path
from typing import Any, Callable


RowNormalizer = Callable[[dict[str, Any]], dict[str, Any]]
RowSorter = Callable[[list[dict[str, Any]]], list[dict[str, Any]]]
PathFormatter = Callable[[Path], str]


def atomic_temp_path(target_path: Path) -> Path:
    """Return a unique temporary path next to ``target_path``.

    Keeping the temporary file in the target directory is important: an
    ``os.replace`` across filesystems is not atomic and can fail for output
    paths mounted on a separate volume.
    """

    target_path.parent.mkdir(parents=True, exist_ok=True)
    suffix = target_path.suffix
    return target_path.with_name(
        f".{target_path.stem}.{os.getpid()}.{time.time_ns()}.tmp{suffix}"
    )


def atomic_write_text(
    target_path: Path,
    content: str,
    encoding: str = "utf-8",
) -> None:
    """Write text atomically, preserving the previous target on failure."""

    temp_path = atomic_temp_path(target_path)
    try:
        temp_path.write_text(content, encoding=encoding)
        os.replace(temp_path, target_path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def atomic_write_json(
    target_path: Path,
    payload: Any,
    *,
    encoding: str = "utf-8",
    ensure_ascii: bool = False,
    indent: int | None = 2,
) -> None:
    """Serialize ``payload`` and atomically replace ``target_path``."""

    content = json.dumps(payload, ensure_ascii=ensure_ascii, indent=indent)
    atomic_write_text(target_path, content, encoding=encoding)


# Short aliases keep the module convenient for callers that do not need to
# distinguish the serialization helper from its atomic replacement strategy.
write_json = atomic_write_json


def read_json_file(path: Path, *, encoding: str = "utf-8") -> Any:
    """Read and decode one JSON artifact.

    Decode and filesystem errors are deliberately allowed to reach callers so
    they can choose the appropriate tolerance policy (for example, a corrupt
    LLM cache is a cache miss, while a malformed output bundle should remain
    visible to the caller).
    """

    return json.loads(path.read_text(encoding=encoding))


read_json = read_json_file


def is_valid_json_file(path: Path, *, encoding: str = "utf-8") -> bool:
    """Return whether ``path`` exists and contains a valid JSON document."""

    if not path.is_file():
        return False
    try:
        read_json_file(path, encoding=encoding)
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False
    return True


def read_jsonl_rows(jsonl_path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not jsonl_path.exists():
        return rows
    for line in jsonl_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        payload = json.loads(line)
        if isinstance(payload, dict):
            rows.append(payload)
    return rows


def read_csv_rows(csv_path: Path, table_fields: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not csv_path.exists():
        return rows
    with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            rows.append({field: row.get(field, "") for field in table_fields})
    return rows


def load_existing_output_rows(
    output_dir: Path,
    table_fields: list[str],
    output_stem: str = "announcement_table",
    *,
    normalize: RowNormalizer | None = None,
) -> list[dict[str, Any]]:
    """Load the JSONL-first, CSV-fallback output bundle.

    ``normalize`` is supplied by the builder because field coercion is part of
    its business schema, not generic artifact I/O.  Without it, raw rows are
    returned for callers that only need to inspect an artifact.
    """

    jsonl_path = output_dir / f"{output_stem}.jsonl"
    csv_path = output_dir / f"{output_stem}.csv"

    rows = read_jsonl_rows(jsonl_path)
    if not rows:
        rows = read_csv_rows(csv_path, table_fields)
    if normalize is not None:
        return [normalize(row) for row in rows]
    return rows


def write_csv(
    rows: list[dict[str, Any]],
    csv_path: Path,
    table_fields: list[str],
) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = atomic_temp_path(csv_path)
    try:
        with temp_path.open("w", encoding="utf-8-sig", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=table_fields)
            writer.writeheader()
            csv_rows = [
                {field: ("" if row.get(field) is None else row.get(field)) for field in table_fields}
                for row in rows
            ]
            writer.writerows(csv_rows)
        os.replace(temp_path, csv_path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def write_jsonl(rows: list[dict[str, Any]], jsonl_path: Path) -> None:
    content = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    atomic_write_text(jsonl_path, content, encoding="utf-8")


def write_failures_jsonl(
    failures: list[dict[str, Any]],
    jsonl_path: Path,
) -> None:
    content = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in failures)
    atomic_write_text(jsonl_path, content, encoding="utf-8")


def maybe_export_xlsx(
    rows: list[dict[str, Any]],
    xlsx_path: Path,
    table_fields: list[str],
) -> str | None:
    try:
        import pandas as pd
    except ImportError:
        return None

    dataframe = pd.DataFrame(rows, columns=table_fields)
    xlsx_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = atomic_temp_path(xlsx_path)
    try:
        dataframe.to_excel(temp_path, index=False)
        os.replace(temp_path, xlsx_path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass
    return str(xlsx_path)


def write_summary(summary_path: Path, summary_payload: dict[str, Any]) -> None:
    """Atomically persist a run summary JSON artifact."""

    atomic_write_json(summary_path, summary_payload, ensure_ascii=False, indent=2)


def write_output_bundle(
    rows: list[dict[str, Any]],
    output_dir: Path,
    summary_path: Path,
    summary_payload: dict[str, Any],
    table_fields: list[str],
    output_stem: str = "announcement_table",
    *,
    sort_rows: RowSorter | None = None,
    portable_path: PathFormatter | None = None,
) -> dict[str, str | None]:
    """Write CSV, JSONL, optional XLSX, and a summary atomically.

    Sorting and path presentation stay injectable so the builder retains its
    existing business ordering and repository-relative artifact references.
    """

    format_path = portable_path or (lambda path: str(path))
    sorted_rows = sort_rows(rows) if sort_rows is not None else list(rows)
    csv_path = output_dir / f"{output_stem}.csv"
    jsonl_path = output_dir / f"{output_stem}.jsonl"
    xlsx_path = output_dir / f"{output_stem}.xlsx"

    write_csv(sorted_rows, csv_path, table_fields)
    write_jsonl(sorted_rows, jsonl_path)
    xlsx_exported = maybe_export_xlsx(sorted_rows, xlsx_path, table_fields)
    write_summary(summary_path, summary_payload)
    return {
        "csv_path": format_path(csv_path),
        "jsonl_path": format_path(jsonl_path),
        "xlsx_path": format_path(Path(xlsx_exported)) if xlsx_exported else None,
        "summary_path": format_path(summary_path),
    }
