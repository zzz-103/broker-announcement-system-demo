from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


CANONICAL_FIELDS = [
    "broker_folder",
    "markdown_file",
    "document_sha1",
    "processed_at",
    "raw_json_path",
    "broker_name",
    "is_broker_project",
    "publish_date",
    "announcement_stage",
    "procurement_category",
    "project_subcategory",
    "project_name",
    "procurement_method",
    "procurement_action",
    "procurement_scope_summary",
    "budget_amount_yuan",
    "ceiling_price_yuan",
    "winning_amount_yuan",
    "bid_deadline_at",
    "service_period_months",
    "delivery_period_days",
    "winning_supplier",
]
LEGACY_FIELDS = [field for field in CANONICAL_FIELDS if field != "is_broker_project"]
MANIFEST_FIELDS = {"batch_id", "active", "row_count", "sha256", "imported_at"}
OVERLAP_FIELDS = [
    "match_level",
    "seed_row_number",
    "staging_row_number",
    "seed_document_sha1",
    "staging_document_sha1",
    "seed_broker_name",
    "staging_broker_name",
    "seed_project_name",
    "staging_project_name",
    "seed_publish_date",
    "staging_publish_date",
]
STABLE_IDENTIFIER_FIELDS = ("announcement_id", "notice_id", "announcement_url", "source_url", "url")
BUSINESS_FIELDS = [
    "broker_name",
    "is_broker_project",
    "publish_date",
    "announcement_stage",
    "procurement_category",
    "project_subcategory",
    "project_name",
    "procurement_method",
    "procurement_action",
    "procurement_scope_summary",
    "budget_amount_yuan",
    "ceiling_price_yuan",
    "winning_amount_yuan",
    "bid_deadline_at",
    "service_period_months",
    "delivery_period_days",
    "winning_supplier",
]
PROJECT_LINE_FIELDS = [
    "broker_name",
    "project_name",
    "publish_date",
    "announcement_stage",
    "procurement_category",
    "project_subcategory",
    "procurement_method",
    "procurement_action",
    "winning_supplier",
]


class SupplementalDataError(ValueError):
    """A supplemental seed cannot safely participate in a publication."""


@dataclass
class CsvData:
    rows: list[dict[str, str]]
    source_rows: list[dict[str, str]]


@dataclass
class MergeResult:
    records: list[dict[str, str]]
    meta: dict[str, object]


def supplemental_data_dir(project_root: Path) -> Path:
    configured = os.getenv("SUPPLEMENTAL_DATA_DIR")
    path = Path(configured) if configured else project_root / "backend" / "data" / "supplemental"
    if not path.is_absolute():
        path = project_root / path
    return path.resolve()


def _normalized(value: object) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _digest(values: Iterable[str]) -> str:
    encoded = "\x1f".join(values).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _non_empty_rows(rows: Iterable[dict[str, str]]) -> list[dict[str, str]]:
    return [row for row in rows if any(str(value or "").strip() for value in row.values())]


def _canonicalize_rows(
    path: Path,
    *,
    allow_legacy_without_flag: bool,
    source_label: str,
) -> CsvData:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            fieldnames = [name.strip() for name in (reader.fieldnames or []) if name and name.strip()]
            rows = list(reader)
    except (OSError, csv.Error) as exc:
        raise SupplementalDataError(f"failed to read {source_label} CSV") from exc

    expected = CANONICAL_FIELDS
    is_legacy = fieldnames == LEGACY_FIELDS
    if fieldnames != expected and not (allow_legacy_without_flag and is_legacy):
        raise SupplementalDataError(f"{source_label} CSV headers must match the canonical announcement schema")

    canonical_rows: list[dict[str, str]] = []
    source_rows: list[dict[str, str]] = []
    for row in _non_empty_rows(rows):
        normalized_row = {field: str(row.get(field) or "") for field in expected}
        if is_legacy:
            normalized_row["is_broker_project"] = "true"
        else:
            classification = _normalized(normalized_row["is_broker_project"])
            if classification not in {"true", "false"}:
                raise SupplementalDataError(f"{source_label} CSV contains an invalid is_broker_project value")
            normalized_row["is_broker_project"] = classification
        canonical_rows.append(normalized_row)
        source_rows.append({key: str(value or "") for key, value in row.items() if key})

    if not canonical_rows:
        raise SupplementalDataError(f"{source_label} CSV does not contain valid records")
    return CsvData(rows=canonical_rows, source_rows=source_rows)


def _write_bytes_atomically(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with temp_path.open("wb") as file:
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)


def write_csv_atomically(path: Path, fieldnames: list[str], rows: Iterable[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.stem}.{os.getpid()}.tmp{path.suffix}")
    try:
        with temp_path.open("w", encoding="utf-8-sig", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def import_temporary_seed(source_path: Path, destination_dir: Path) -> dict[str, object]:
    source_path = source_path.resolve()
    if not source_path.exists():
        raise SupplementalDataError("source CSV does not exist")
    imported = _canonicalize_rows(
        source_path,
        allow_legacy_without_flag=True,
        source_label="source",
    )
    batch_id = str(uuid.uuid4())
    imported_at = datetime.now(timezone.utc).isoformat()
    archive_path = destination_dir / "source" / f"{batch_id}_{source_path.name}"
    _write_bytes_atomically(archive_path, source_path.read_bytes())

    seed_path = destination_dir / "temporary_seed.csv"
    write_csv_atomically(seed_path, CANONICAL_FIELDS, imported.rows)
    manifest = {
        "batch_id": batch_id,
        "active": True,
        "row_count": len(imported.rows),
        "sha256": sha256_file(seed_path),
        "imported_at": imported_at,
    }
    _write_bytes_atomically(
        destination_dir / "temporary_seed_manifest.json",
        json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"),
    )
    return {
        **manifest,
        "source_archive": str(archive_path),
        "true_count": sum(row["is_broker_project"] == "true" for row in imported.rows),
        "false_count": sum(row["is_broker_project"] == "false" for row in imported.rows),
    }


def _load_active_seed(destination_dir: Path) -> CsvData | None:
    manifest_path = destination_dir / "temporary_seed_manifest.json"
    if not manifest_path.exists():
        return None
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SupplementalDataError("temporary seed manifest is invalid") from exc
    if set(manifest) != MANIFEST_FIELDS or not isinstance(manifest.get("active"), bool):
        raise SupplementalDataError("temporary seed manifest has an invalid schema")
    if not manifest["active"]:
        return None
    if not isinstance(manifest["row_count"], int) or manifest["row_count"] < 1:
        raise SupplementalDataError("temporary seed manifest row_count is invalid")
    if not isinstance(manifest["sha256"], str) or len(manifest["sha256"]) != 64:
        raise SupplementalDataError("temporary seed manifest sha256 is invalid")

    seed_path = destination_dir / "temporary_seed.csv"
    if not seed_path.exists():
        raise SupplementalDataError("active temporary seed CSV is missing")
    if sha256_file(seed_path).lower() != manifest["sha256"].lower():
        raise SupplementalDataError("active temporary seed CSV checksum does not match its manifest")
    seed = _canonicalize_rows(seed_path, allow_legacy_without_flag=False, source_label="temporary seed")
    if len(seed.rows) != manifest["row_count"]:
        raise SupplementalDataError("active temporary seed CSV row count does not match its manifest")
    return seed


def _project_line_key(row: dict[str, str]) -> str:
    return _digest(_normalized(row.get(field)) for field in PROJECT_LINE_FIELDS)


def _business_fingerprint(row: dict[str, str]) -> str:
    return _digest(_normalized(row.get(field)) for field in BUSINESS_FIELDS)


def _stable_document_key(row: dict[str, str], source_row: dict[str, str]) -> str | None:
    for field in STABLE_IDENTIFIER_FIELDS:
        value = _normalized(source_row.get(field))
        if value:
            return f"external:{field}:{value}"
    folder = _normalized(row.get("broker_folder"))
    markdown_file = _normalized(row.get("markdown_file"))
    if folder and markdown_file:
        return f"file:{folder}:{markdown_file}"
    return None


def _exact_keys(row: dict[str, str], source_row: dict[str, str]) -> set[tuple[str, str]]:
    line_key = _project_line_key(row)
    keys: set[tuple[str, str]] = {("fingerprint", _business_fingerprint(row))}
    stable_key = _stable_document_key(row, source_row)
    if stable_key:
        keys.add(("stable", f"{stable_key}:{line_key}"))
    document_sha1 = _normalized(row.get("document_sha1"))
    if document_sha1:
        keys.add(("sha1_line", f"{document_sha1}:{line_key}"))
    return keys


def _candidate_key(row: dict[str, str]) -> tuple[str, str]:
    return (_normalized(row.get("broker_name")), _normalized(row.get("project_name")))


def _overlap_row(
    level: str,
    seed_row_number: int,
    seed_row: dict[str, str],
    staging_row_number: int,
    staging_row: dict[str, str],
) -> dict[str, str]:
    return {
        "match_level": level,
        "seed_row_number": str(seed_row_number),
        "staging_row_number": str(staging_row_number),
        "seed_document_sha1": seed_row.get("document_sha1", ""),
        "staging_document_sha1": staging_row.get("document_sha1", ""),
        "seed_broker_name": seed_row.get("broker_name", ""),
        "staging_broker_name": staging_row.get("broker_name", ""),
        "seed_project_name": seed_row.get("project_name", ""),
        "staging_project_name": staging_row.get("project_name", ""),
        "seed_publish_date": seed_row.get("publish_date", ""),
        "staging_publish_date": staging_row.get("publish_date", ""),
    }


def merge_for_publication(staging_path: Path, destination_dir: Path) -> MergeResult:
    staging = _canonicalize_rows(
        staging_path,
        allow_legacy_without_flag=True,
        source_label="staging",
    )
    seed = _load_active_seed(destination_dir)
    overlaps: list[dict[str, str]] = []
    staging_exact: dict[tuple[str, str], int] = {}
    staging_candidates: dict[tuple[str, str], list[int]] = {}
    for index, (row, source_row) in enumerate(zip(staging.rows, staging.source_rows), start=1):
        for key in _exact_keys(row, source_row):
            staging_exact.setdefault(key, index)
        candidate_key = _candidate_key(row)
        if all(candidate_key):
            staging_candidates.setdefault(candidate_key, []).append(index)

    retained_seed: list[dict[str, str]] = []
    exact_duplicate_count = 0
    if seed is not None:
        for seed_index, (row, source_row) in enumerate(zip(seed.rows, seed.source_rows), start=1):
            matching_keys = _exact_keys(row, source_row) & staging_exact.keys()
            if matching_keys:
                exact_duplicate_count += 1
                level, _ = sorted(matching_keys)[0]
                staging_index = staging_exact[sorted(matching_keys)[0]]
                overlaps.append(_overlap_row(f"exact_{level}", seed_index, row, staging_index, staging.rows[staging_index - 1]))
                continue
            candidate_key = _candidate_key(row)
            if all(candidate_key):
                for staging_index in staging_candidates.get(candidate_key, []):
                    overlaps.append(_overlap_row("candidate_broker_project", seed_index, row, staging_index, staging.rows[staging_index - 1]))
            retained_seed.append(row)

    write_csv_atomically(destination_dir / "temporary_overlap_candidates.csv", OVERLAP_FIELDS, overlaps)
    records = [*staging.rows, *retained_seed]
    true_count = sum(row["is_broker_project"] == "true" for row in records)
    false_count = sum(row["is_broker_project"] == "false" for row in records)
    visible_brokers = {row["broker_name"].strip() for row in records if row["is_broker_project"] == "true" and row["broker_name"].strip()}
    return MergeResult(
        records=records,
        meta={
            "staging_count": len(staging.rows),
            "temporary_seed_active": seed is not None,
            "temporary_seed_count": len(seed.rows) if seed else 0,
            "temporary_seed_retained_count": len(retained_seed),
            "exact_duplicate_count": exact_duplicate_count,
            "overlap_candidate_count": len(overlaps) - exact_duplicate_count,
            "true_count": true_count,
            "false_count": false_count,
            "visible_broker_count": len(visible_brokers),
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a temporary supplemental announcement CSV")
    parser.add_argument("--source", required=True, type=Path, help="CSV file to preserve and normalize")
    parser.add_argument("--supplemental-dir", type=Path, help="Override the supplemental data directory")
    args = parser.parse_args()
    project_root = Path(__file__).resolve().parents[2]
    destination = args.supplemental_dir or supplemental_data_dir(project_root)
    result = import_temporary_seed(args.source, destination)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
