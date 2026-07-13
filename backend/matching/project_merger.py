from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.matching import project_matcher


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_PROCUREMENT_CSV = ROOT_DIR / "data" / "staging" / "announcement_table.csv"
DEFAULT_RESULT_CSV = ROOT_DIR / "data" / "staging" / "result" / "result_table.csv"
DEFAULT_VERIFIED_LINKS_CSV = ROOT_DIR / "data" / "staging" / "llm_matching" / "llm_verified_links.csv"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "data" / "staging" / "final"
MERGER_VERSION = "p13e_project_merger_v1"

MERGED_RESULT_FIELDS = [
    "result_notice_id",
    "result_title",
    "result_type",
    "result_status",
    "result_publish_date",
    "winner",
    "winner_candidates",
    "winning_amount",
    "result_match_method",
    "result_match_confidence",
    "result_notice_count",
    "result_history_json",
]

ACCEPTED_LINK_FIELDS = [
    "result_notice_id",
    "procurement_notice_id",
    "first_confidence",
    "second_confidence",
    "final_confidence",
    "result_type",
    "result_publish_date",
]

EXCLUDED_RESULT_FIELDS = [
    "result_notice_id",
    "result_title",
    "final_status",
    "first_decision",
    "first_confidence",
    "second_decision",
    "second_confidence",
    "hard_conflict",
    "exclusion_reason",
]

REQUIRED_LINK_FIELDS = {
    "result_notice_id",
    "procurement_notice_id",
    "final_status",
    "first_decision",
    "first_procurement_notice_id",
    "first_confidence",
    "second_decision",
    "second_procurement_notice_id",
    "second_confidence",
    "hard_conflict",
}

REQUIRED_RESULT_FIELDS = {
    "title",
    "publish_date",
    "result_type",
    "result_status",
    "winner",
    "winner_candidates",
    "winning_amount",
}


class InputError(ValueError):
    """Raised when the merger input cannot support a conservative merge."""


def normalize_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def notice_id(row: dict[str, str]) -> str:
    return normalize_text(row.get("notice_id") or row.get("document_sha1"))


def read_csv(path: Path, label: str) -> tuple[list[str], list[dict[str, str]]]:
    if not path.is_file():
        raise InputError(f"{label} CSV 不存在: {path}")
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            if reader.fieldnames is None:
                raise InputError(f"{label} CSV 缺少表头: {path}")
            fieldnames = [normalize_text(field) for field in reader.fieldnames]
            if not fieldnames or not any(fieldnames):
                raise InputError(f"{label} CSV 缺少表头: {path}")
            rows = [
                {normalize_text(key): normalize_text(value) for key, value in row.items()}
                for row in reader
            ]
    except OSError as exc:
        raise InputError(f"无法读取 {label} CSV: {path} ({exc})") from exc
    if not rows:
        raise InputError(f"{label} CSV 只有表头或没有记录: {path}")
    return fieldnames, rows


def require_fields(fieldnames: list[str], required: set[str], label: str) -> None:
    missing = sorted(required.difference(fieldnames))
    if missing:
        raise InputError(f"{label} CSV 缺少关键字段: {', '.join(missing)}")


def require_id_source(fieldnames: list[str], label: str) -> None:
    if not {"notice_id", "document_sha1"}.intersection(fieldnames):
        raise InputError(f"{label} CSV 缺少公告 ID 字段（notice_id/document_sha1）")


def stable_row_hash(row: dict[str, str]) -> str:
    payload = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def record_key(row: dict[str, str]) -> str:
    package = project_matcher.normalize_package_number(
        row.get("package_number") or row.get("project_name") or row.get("title")
    )
    return f"{notice_id(row)}:{package or '-'}:{stable_row_hash(row)}"


def prepare_rows(
    rows: list[dict[str, str]],
) -> tuple[list[dict[str, str]], dict[str, list[dict[str, str]]], int, int]:
    valid: list[dict[str, str]] = []
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    seen_rows: set[str] = set()
    deduplicated_count = 0
    invalid_count = 0
    for original in rows:
        key = notice_id(original)
        if not key:
            invalid_count += 1
            continue
        fingerprint = stable_row_hash(original)
        if fingerprint in seen_rows:
            deduplicated_count += 1
            continue
        seen_rows.add(fingerprint)
        row = dict(original)
        row["record_key"] = record_key(original)
        valid.append(row)
        grouped[key].append(row)
    return valid, grouped, deduplicated_count, invalid_count


def unique_rows_by_id(rows: list[dict[str, str]]) -> tuple[dict[str, dict[str, str]], set[str], int]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    invalid_count = 0
    for row in rows:
        key = notice_id(row)
        if key:
            grouped[key].append(row)
        else:
            invalid_count += 1
    duplicate_ids = {key for key, items in grouped.items() if len(items) > 1}
    return {key: items[0] for key, items in grouped.items() if len(items) == 1}, duplicate_ids, invalid_count


def resolve_procurement_row(
    result_row: dict[str, str], candidates: list[dict[str, str]]
) -> dict[str, str] | None:
    if len(candidates) == 1:
        return candidates[0]
    result_package = project_matcher.normalize_package_number(
        result_row.get("package_number") or result_row.get("project_name") or result_row.get("title")
    )
    if not result_package:
        return None
    matches = [
        row
        for row in candidates
        if project_matcher.normalize_package_number(
            row.get("package_number") or row.get("project_name") or row.get("title")
        )
        == result_package
    ]
    return matches[0] if len(matches) == 1 else None


def parse_confidence(value: str) -> float | None:
    try:
        parsed = float(normalize_text(value))
    except ValueError:
        return None
    return parsed if 0 <= parsed <= 1 else None


def hard_conflict_is_clear(value: str) -> bool:
    return normalize_text(value).lower() in {"", "false", "0", "none", "null"}


def parse_publish_date(value: str) -> datetime | None:
    text = normalize_text(value).replace("年", "-").replace("月", "-").replace("日", "")
    for candidate in (text, text.split(" ", 1)[0] if " " in text else text):
        try:
            return datetime.fromisoformat(candidate.replace("Z", "+00:00"))
        except ValueError:
            continue
    return None


def result_priority(result_type: str) -> int:
    normalized = normalize_text(result_type).lower()
    if normalized in {"winning", "transaction"}:
        return 0
    if normalized == "candidate":
        return 1
    if normalized in {"failed", "terminated", "cancelled"}:
        return 2
    return 3


def stable_result_key(item: dict[str, Any]) -> tuple[int, float, str]:
    published_at = parse_publish_date(item["result_row"].get("publish_date", ""))
    timestamp = published_at.timestamp() if published_at else float("-inf")
    return (result_priority(item["result_row"].get("result_type", "")), -timestamp, item["result_notice_id"])


def exclusion_row(link: dict[str, str], result_row: dict[str, str] | None, reason: str) -> dict[str, str]:
    return {
        "result_notice_id": link.get("result_notice_id", ""),
        "result_title": result_row.get("title", "") if result_row else "",
        "final_status": link.get("final_status", ""),
        "first_decision": link.get("first_decision", ""),
        "first_confidence": link.get("first_confidence", ""),
        "second_decision": link.get("second_decision", ""),
        "second_confidence": link.get("second_confidence", ""),
        "hard_conflict": link.get("hard_conflict", ""),
        "exclusion_reason": reason,
    }


def validate_link(
    link: dict[str, str],
    result_rows_by_id: dict[str, dict[str, str]],
    procurement_rows_by_id: dict[str, list[dict[str, str]]],
    duplicate_result_ids: set[str],
) -> tuple[bool, str, float | None, float | None]:
    result_notice_id = normalize_text(link.get("result_notice_id"))
    if result_notice_id in duplicate_result_ids:
        return False, "invalid_input", None, None
    if normalize_text(link.get("final_status")) != "auto_matched":
        return False, "not_auto_matched", None, None

    first_confidence = parse_confidence(link.get("first_confidence", ""))
    second_confidence = parse_confidence(link.get("second_confidence", ""))
    final_procurement_id = normalize_text(link.get("procurement_notice_id"))
    first_procurement_id = normalize_text(link.get("first_procurement_notice_id"))
    second_procurement_id = normalize_text(link.get("second_procurement_notice_id"))
    if not result_notice_id or not final_procurement_id or first_confidence is None or second_confidence is None:
        return False, "invalid_input", first_confidence, second_confidence
    if not hard_conflict_is_clear(link.get("hard_conflict", "")):
        return False, "hard_conflict", first_confidence, second_confidence
    if normalize_text(link.get("first_decision")) != "matched" or normalize_text(link.get("second_decision")) != "matched":
        return False, "llm_decision_mismatch", first_confidence, second_confidence
    if final_procurement_id != first_procurement_id or final_procurement_id != second_procurement_id:
        return False, "candidate_id_mismatch", first_confidence, second_confidence
    if first_confidence < 0.95 or second_confidence < 0.95:
        return False, "confidence_below_threshold", first_confidence, second_confidence
    if result_notice_id not in result_rows_by_id:
        return False, "missing_result_record", first_confidence, second_confidence
    if final_procurement_id not in procurement_rows_by_id:
        return False, "missing_procurement_record", first_confidence, second_confidence
    return True, "", first_confidence, second_confidence


def write_csv_atomic(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8-sig", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows([{field: row.get(field, "") for field in fieldnames} for row in rows])
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2, sort_keys=True)
            file.write("\n")
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def run_merger(
    procurement_csv: Path,
    result_csv: Path,
    verified_links_csv: Path,
    output_dir: Path,
) -> dict[str, Any]:
    procurement_fields, procurement_rows = read_csv(procurement_csv, "采购公告")
    result_fields, result_rows = read_csv(result_csv, "结果公告")
    link_fields, links = read_csv(verified_links_csv, "LLM 匹配结果")
    require_id_source(procurement_fields, "采购公告")
    require_id_source(result_fields, "结果公告")
    require_fields(result_fields, REQUIRED_RESULT_FIELDS, "结果公告")
    require_fields(link_fields, REQUIRED_LINK_FIELDS, "LLM 匹配结果")

    procurement_rows, procurement_rows_by_id, deduplicated_count, invalid_procurement_count = prepare_rows(procurement_rows)
    result_rows_by_id, duplicate_result_rows, invalid_result_count = unique_rows_by_id(result_rows)
    duplicate_result_ids = duplicate_result_rows | {
        result_notice_id
        for result_notice_id, count in Counter(normalize_text(row.get("result_notice_id")) for row in links).items()
        if result_notice_id and count > 1
    }

    accepted: list[dict[str, Any]] = []
    excluded: list[dict[str, str]] = []
    for link in links:
        result_notice_id = normalize_text(link.get("result_notice_id"))
        result_row = result_rows_by_id.get(result_notice_id)
        is_accepted, reason, first_confidence, second_confidence = validate_link(
            link, result_rows_by_id, procurement_rows_by_id, duplicate_result_ids
        )
        if not is_accepted:
            excluded.append(exclusion_row(link, result_row, reason))
            continue
        procurement_candidates = procurement_rows_by_id[normalize_text(link.get("procurement_notice_id"))]
        procurement_row = resolve_procurement_row(result_row, procurement_candidates)
        if procurement_row is None:
            excluded.append(exclusion_row(link, result_row, "ambiguous_procurement_rows"))
            continue
        accepted.append(
            {
                "result_notice_id": result_notice_id,
                "procurement_notice_id": normalize_text(link.get("procurement_notice_id")),
                "first_confidence": first_confidence,
                "second_confidence": second_confidence,
                "final_confidence": min(first_confidence, second_confidence),
                "result_row": result_row,
                "procurement_record_key": procurement_row["record_key"],
            }
        )

    accepted.sort(key=lambda item: (item["procurement_notice_id"], *stable_result_key(item)))
    accepted_by_procurement: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in accepted:
        accepted_by_procurement[item["procurement_record_key"]].append(item)

    merged_rows: list[dict[str, Any]] = []
    for procurement_row in procurement_rows:
        merged = dict(procurement_row)
        linked_results = accepted_by_procurement.get(procurement_row["record_key"], [])
        for field in MERGED_RESULT_FIELDS:
            merged[field] = ""
        if linked_results:
            primary = linked_results[0]
            primary_result = primary["result_row"]
            history = [
                {
                    "confidence": item["final_confidence"],
                    "publish_date": item["result_row"].get("publish_date", ""),
                    "result_notice_id": item["result_notice_id"],
                    "result_status": item["result_row"].get("result_status", ""),
                    "result_title": item["result_row"].get("title", ""),
                    "result_type": item["result_row"].get("result_type", ""),
                    "winner": item["result_row"].get("winner", ""),
                    "winning_amount": item["result_row"].get("winning_amount", ""),
                }
                for item in linked_results
            ]
            merged.update(
                {
                    "result_notice_id": primary["result_notice_id"],
                    "result_title": primary_result.get("title", ""),
                    "result_type": primary_result.get("result_type", ""),
                    "result_status": primary_result.get("result_status", ""),
                    "result_publish_date": primary_result.get("publish_date", ""),
                    "winner": primary_result.get("winner", ""),
                    "winner_candidates": primary_result.get("winner_candidates", ""),
                    "winning_amount": primary_result.get("winning_amount", ""),
                    "result_match_method": "double_llm_verified",
                    "result_match_confidence": format_confidence(primary["final_confidence"]),
                    "result_notice_count": str(len(linked_results)),
                    "result_history_json": json.dumps(history, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                }
            )
        merged_rows.append(merged)

    accepted_link_rows = [
        {
            "result_notice_id": item["result_notice_id"],
            "procurement_notice_id": item["procurement_notice_id"],
            "first_confidence": format_confidence(item["first_confidence"]),
            "second_confidence": format_confidence(item["second_confidence"]),
            "final_confidence": format_confidence(item["final_confidence"]),
            "result_type": item["result_row"].get("result_type", ""),
            "result_publish_date": item["result_row"].get("publish_date", ""),
        }
        for item in accepted
    ]
    missing_procurement_count = sum(row["exclusion_reason"] == "missing_procurement_record" for row in excluded)
    missing_result_count = sum(row["exclusion_reason"] == "missing_result_record" for row in excluded)
    summary = {
        "procurement_count": len(procurement_rows),
        "deduplicated_count": deduplicated_count,
        "invalid_procurement_count": invalid_procurement_count,
        "invalid_result_count": invalid_result_count,
        "result_count": len(result_rows),
        "verified_link_count": len(links),
        "accepted_link_count": len(accepted_link_rows),
        "excluded_link_count": len(excluded),
        "merged_procurement_count": len(accepted_by_procurement),
        "multi_result_project_count": sum(len(items) > 1 for items in accepted_by_procurement.values()),
        "missing_procurement_count": missing_procurement_count,
        "missing_result_count": missing_result_count,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "merger_version": MERGER_VERSION,
    }

    # All validation and selection completes before the output directory is created.
    write_csv_atomic(output_dir / "announcement_table_merged_test.csv", procurement_fields + ["record_key"] + MERGED_RESULT_FIELDS, merged_rows)
    write_csv_atomic(output_dir / "accepted_links.csv", ACCEPTED_LINK_FIELDS, accepted_link_rows)
    write_csv_atomic(output_dir / "excluded_results.csv", EXCLUDED_RESULT_FIELDS, excluded)
    write_json_atomic(output_dir / "run_summary.json", summary)
    return summary


def format_confidence(value: float) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".")


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="基于双重 LLM 验证结果生成保守合并测试表。")
    parser.add_argument("--procurement-csv", type=Path, default=DEFAULT_PROCUREMENT_CSV)
    parser.add_argument("--result-csv", type=Path, default=DEFAULT_RESULT_CSV)
    parser.add_argument("--verified-links-csv", type=Path, default=DEFAULT_VERIFIED_LINKS_CSV)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser


def main() -> int:
    parser = build_argument_parser()
    args = parser.parse_args()
    try:
        summary = run_merger(
            args.procurement_csv.resolve(),
            args.result_csv.resolve(),
            args.verified_links_csv.resolve(),
            args.output_dir.resolve(),
        )
    except InputError as exc:
        parser.error(str(exc))
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
