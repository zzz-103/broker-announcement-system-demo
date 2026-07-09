from __future__ import annotations

import argparse
import csv
import json
import os
import re
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ROOT_DIR.parent
DEFAULT_PROCUREMENT_CSV = ROOT_DIR / "data" / "staging" / "announcement_table.csv"
FALLBACK_PROCUREMENT_CSV = ROOT_DIR / "data" / "announcement_table.csv"
DEFAULT_RESULT_CSV = ROOT_DIR / "data" / "staging" / "result" / "result_table.csv"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "data" / "staging" / "matching"
DEFAULT_MAX_CANDIDATES = 5

PROJECT_LINK_FIELDS = [
    "result_notice_id",
    "procurement_notice_id",
    "match_status",
    "match_method",
    "rule_score",
    "score_margin",
    "title_similarity",
    "project_number_match",
    "purchaser_match",
    "package_match",
    "date_score",
    "match_reason",
    "result_source_file",
    "procurement_source_file",
]

CANDIDATE_SCORE_FIELDS = [
    "result_notice_id",
    "procurement_notice_id",
    "rank",
    "rule_score",
    "title_similarity",
    "project_number_match",
    "purchaser_match",
    "package_match",
    "date_score",
    "score_reason",
    "result_project_name",
    "procurement_project_name",
    "result_purchaser",
    "procurement_purchaser",
    "result_package_number",
    "procurement_package_number",
    "result_publish_date",
    "procurement_publish_date",
    "result_source_file",
    "procurement_source_file",
]

UNMATCHED_RESULT_FIELDS = [
    "result_notice_id",
    "title",
    "project_name",
    "publish_date",
    "purchaser",
    "package_number",
    "reason",
    "best_rule_score",
    "result_source_file",
]

NOTICE_SUFFIXES = [
    "中标候选人公示",
    "成交候选人公示",
    "中标结果公告",
    "成交结果公告",
    "采购结果公告",
    "结果公告",
    "招标公告",
    "采购公告",
    "询价公告",
    "竞争性磋商公告",
    "竞争性谈判公告",
    "磋商公告",
    "谈判公告",
    "比选公告",
    "中标公告",
    "成交公告",
    "流标公告",
    "废标公告",
    "终止公告",
    "取消公告",
]

COMMON_PUNCTUATION_RE = re.compile(r"[\s,，.。;；:：!！?？、/\\|·`'\"“”‘’\[\]【】{}<>《》\-＿_+＝=~～]+")
LEADING_USELESS_RE = re.compile(r"^(?:关于|有关)")
SAFE_COMPANY_SUFFIXES = [
    "股份有限公司",
    "有限责任公司",
    "有限公司",
    "证券股份有限公司",
    "证券有限责任公司",
]

CN_NUMERAL_MAP = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}


@dataclass(frozen=True)
class NormalizedRecord:
    row: dict[str, str]
    notice_id: str
    source_file: str
    project_name: str
    normalized_title: str
    project_number: str
    purchaser: str
    package_number: str
    publish_date: datetime | None


@dataclass(frozen=True)
class CandidateScore:
    procurement: NormalizedRecord
    rule_score: float
    title_similarity: float
    project_number_match: float
    purchaser_match: float
    package_match: float
    date_score: float
    reasons: tuple[str, ...]


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return unicodedata.normalize("NFKC", str(value)).strip()


def strip_notice_suffix(value: str) -> str:
    text = normalize_text(value)
    changed = True
    while changed:
        changed = False
        for suffix in NOTICE_SUFFIXES:
            if text.endswith(suffix):
                text = text[: -len(suffix)].strip(" -_（）()[]【】")
                changed = True
    return text


def normalize_project_name(value: Any) -> str:
    text = strip_notice_suffix(normalize_text(value)).lower()
    text = text.replace("（", "(").replace("）", ")")
    text = LEADING_USELESS_RE.sub("", text)
    if text.endswith("的"):
        text = text[:-1]
    text = COMMON_PUNCTUATION_RE.sub("", text)
    return text


def normalize_project_number(value: Any) -> str:
    text = normalize_text(value).upper()
    text = text.replace("—", "-").replace("－", "-").replace("–", "-")
    return re.sub(r"[\s_\-./\\()（）\[\]【】:：]+", "", text)


def normalize_purchaser(value: Any) -> str:
    text = normalize_text(value)
    text = COMMON_PUNCTUATION_RE.sub("", text)
    return text


def short_company_name(value: str) -> str:
    text = normalize_purchaser(value)
    for suffix in sorted(SAFE_COMPANY_SUFFIXES, key=len, reverse=True):
        if text.endswith(suffix):
            return text[: -len(suffix)]
    return text


def purchaser_similarity(left: Any, right: Any) -> float:
    left_norm = normalize_purchaser(left)
    right_norm = normalize_purchaser(right)
    if not left_norm or not right_norm:
        return 0.0
    if left_norm == right_norm:
        return 1.0
    left_short = short_company_name(left_norm)
    right_short = short_company_name(right_norm)
    if left_short and right_short and left_short == right_short:
        return 0.9
    if min(len(left_short), len(right_short)) >= 4:
        if left_short.startswith(right_short) or right_short.startswith(left_short):
            return 0.82
    return 0.0


def chinese_numeral_to_int(value: str) -> int | None:
    if not value:
        return None
    if value.isdigit():
        return int(value)
    if value in CN_NUMERAL_MAP:
        return CN_NUMERAL_MAP[value]
    if len(value) == 2 and value[0] == "十" and value[1] in CN_NUMERAL_MAP:
        return 10 + CN_NUMERAL_MAP[value[1]]
    if len(value) == 2 and value[1] == "十" and value[0] in CN_NUMERAL_MAP:
        return CN_NUMERAL_MAP[value[0]] * 10
    if len(value) == 3 and value[1] == "十" and value[0] in CN_NUMERAL_MAP and value[2] in CN_NUMERAL_MAP:
        return CN_NUMERAL_MAP[value[0]] * 10 + CN_NUMERAL_MAP[value[2]]
    return None


def normalize_package_number(value: Any) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    match = re.search(r"(?:第)?([0-9]{1,3}|[零〇一二两三四五六七八九十]{1,3})(?:包|包件|标段)", text)
    if not match:
        match = re.search(r"(?:包|包件|标段)\s*([0-9]{1,3}|[零〇一二两三四五六七八九十]{1,3})", text)
    if not match:
        return ""
    number = chinese_numeral_to_int(match.group(1).lstrip("0") or "0")
    if number is None:
        return ""
    return str(number)


def parse_date(value: Any) -> datetime | None:
    text = normalize_text(value)
    if not text:
        return None
    match = re.search(r"(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})", text)
    if not match:
        return None
    year, month, day = (int(part) for part in match.groups())
    try:
        return datetime(year, month, day)
    except ValueError:
        return None


def date_score(procurement_date: datetime | None, result_date: datetime | None) -> float:
    if procurement_date is None or result_date is None:
        return 0.5
    days = (result_date - procurement_date).days
    if days < 0:
        return 0.0
    if days <= 45:
        return 1.0
    if days <= 120:
        return 0.75
    if days <= 240:
        return 0.45
    return 0.15


def title_similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    if left in right or right in left:
        return 0.92
    return SequenceMatcher(None, left, right).ratio()


def package_similarity(result_package: str, procurement_package: str) -> float:
    if not result_package and not procurement_package:
        return 1.0
    if result_package and procurement_package and result_package == procurement_package:
        return 1.0
    if not result_package or not procurement_package:
        return 0.6
    return 0.0


def resolve_default_procurement_csv() -> Path:
    if DEFAULT_PROCUREMENT_CSV.exists():
        return DEFAULT_PROCUREMENT_CSV
    return FALLBACK_PROCUREMENT_CSV


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames is None:
            return []
        return [{key: normalize_text(value) for key, value in row.items()} for row in reader]


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
            json.dump(payload, file, ensure_ascii=False, indent=2)
            file.write("\n")
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def source_file(row: dict[str, str]) -> str:
    return row.get("source_file") or row.get("markdown_file") or row.get("raw_json_path") or ""


def normalize_procurement(row: dict[str, str]) -> NormalizedRecord:
    project_name = row.get("project_name") or row.get("title") or ""
    package_number = normalize_package_number(row.get("package_number") or project_name)
    return NormalizedRecord(
        row=row,
        notice_id=row.get("notice_id") or row.get("document_sha1") or source_file(row),
        source_file=source_file(row),
        project_name=project_name,
        normalized_title=normalize_project_name(project_name),
        project_number=normalize_project_number(row.get("project_number")),
        purchaser=normalize_purchaser(row.get("purchaser") or row.get("broker_name")),
        package_number=package_number,
        publish_date=parse_date(row.get("publish_date")),
    )


def normalize_result(row: dict[str, str]) -> NormalizedRecord:
    project_name = row.get("project_name") or row.get("title") or ""
    package_number = normalize_package_number(row.get("package_number") or project_name)
    return NormalizedRecord(
        row=row,
        notice_id=row.get("notice_id") or row.get("document_sha1") or source_file(row),
        source_file=source_file(row),
        project_name=project_name,
        normalized_title=normalize_project_name(project_name),
        project_number=normalize_project_number(row.get("project_number")),
        purchaser=normalize_purchaser(row.get("purchaser")),
        package_number=package_number,
        publish_date=parse_date(row.get("publish_date")),
    )


def score_candidate(result: NormalizedRecord, procurement: NormalizedRecord) -> CandidateScore:
    title_score = title_similarity(result.normalized_title, procurement.normalized_title)
    number_score = 0.0
    if result.project_number and procurement.project_number:
        number_score = 1.0 if result.project_number == procurement.project_number else 0.0
    purchaser_score = purchaser_similarity(result.purchaser, procurement.purchaser)
    package_score = package_similarity(result.package_number, procurement.package_number)
    date_component = date_score(procurement.publish_date, result.publish_date)

    score = (
        title_score * 0.55
        + purchaser_score * 0.18
        + package_score * 0.10
        + number_score * 0.10
        + date_component * 0.07
    )
    if result.project_number and procurement.project_number and result.project_number == procurement.project_number:
        score = min(1.0, score + 0.08)

    reasons: list[str] = []
    if title_score >= 0.9:
        reasons.append("项目名称高度相似")
    elif title_score >= 0.72:
        reasons.append("项目名称较相似")
    if number_score == 1.0:
        reasons.append("项目编号一致")
    if purchaser_score >= 0.82:
        reasons.append("采购人一致或简称一致")
    if package_score == 1.0 and (result.package_number or procurement.package_number):
        reasons.append("包号/标段一致")
    if date_component >= 0.75:
        reasons.append("发布日期顺序合理")

    return CandidateScore(
        procurement=procurement,
        rule_score=round(score, 4),
        title_similarity=round(title_score, 4),
        project_number_match=number_score,
        purchaser_match=round(purchaser_score, 4),
        package_match=round(package_score, 4),
        date_score=round(date_component, 4),
        reasons=tuple(reasons),
    )


def should_recall(result: NormalizedRecord, procurement: NormalizedRecord) -> bool:
    if result.project_number and procurement.project_number and result.project_number == procurement.project_number:
        return True
    if result.source_file and result.source_file == procurement.source_file:
        return True
    title_score = title_similarity(result.normalized_title, procurement.normalized_title)
    purchaser_score = purchaser_similarity(result.purchaser, procurement.purchaser)
    if title_score >= 0.45:
        return True
    if title_score >= 0.32 and purchaser_score >= 0.82:
        return True
    if result.package_number and result.package_number == procurement.package_number and title_score >= 0.30:
        return True
    return False


def recall_candidates(
    result: NormalizedRecord,
    procurements: list[NormalizedRecord],
    max_candidates: int,
) -> list[CandidateScore]:
    candidates = [
        score_candidate(result, procurement)
        for procurement in procurements
        if should_recall(result, procurement)
    ]
    candidates.sort(
        key=lambda candidate: (
            candidate.rule_score,
            candidate.title_similarity,
            candidate.purchaser_match,
            candidate.date_score,
        ),
        reverse=True,
    )
    return candidates[:max_candidates]


def classify_match(candidates: list[CandidateScore]) -> tuple[str, float, str]:
    if not candidates:
        return "unmatched", 0.0, "未召回到候选采购公告"
    best = candidates[0]
    second_score = candidates[1].rule_score if len(candidates) > 1 else 0.0
    margin = round(best.rule_score - second_score, 4)
    if best.rule_score >= 0.82 and margin >= 0.08:
        return "matched", margin, "规则分达到匹配阈值且领先候选明显"
    if best.rule_score >= 0.82:
        return "conflict", margin, "多个候选分数接近，需人工确认"
    if best.rule_score >= 0.62:
        return "review", margin, "存在相似候选但未达到自动匹配阈值"
    return "unmatched", margin, "最佳候选分数低于复核阈值"


def format_score(value: float) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".")


def build_candidate_row(result: NormalizedRecord, candidate: CandidateScore, rank: int) -> dict[str, Any]:
    procurement = candidate.procurement
    return {
        "result_notice_id": result.notice_id,
        "procurement_notice_id": procurement.notice_id,
        "rank": rank,
        "rule_score": format_score(candidate.rule_score),
        "title_similarity": format_score(candidate.title_similarity),
        "project_number_match": format_score(candidate.project_number_match),
        "purchaser_match": format_score(candidate.purchaser_match),
        "package_match": format_score(candidate.package_match),
        "date_score": format_score(candidate.date_score),
        "score_reason": "；".join(candidate.reasons),
        "result_project_name": result.project_name,
        "procurement_project_name": procurement.project_name,
        "result_purchaser": result.row.get("purchaser", ""),
        "procurement_purchaser": procurement.row.get("purchaser") or procurement.row.get("broker_name", ""),
        "result_package_number": result.row.get("package_number", ""),
        "procurement_package_number": procurement.package_number,
        "result_publish_date": result.row.get("publish_date", ""),
        "procurement_publish_date": procurement.row.get("publish_date", ""),
        "result_source_file": result.source_file,
        "procurement_source_file": procurement.source_file,
    }


def build_project_link_row(
    result: NormalizedRecord,
    candidates: list[CandidateScore],
    status: str,
    margin: float,
    reason: str,
) -> dict[str, Any]:
    best = candidates[0] if candidates else None
    procurement = best.procurement if best else None
    return {
        "result_notice_id": result.notice_id,
        "procurement_notice_id": procurement.notice_id if procurement else "",
        "match_status": status,
        "match_method": "rule_v1",
        "rule_score": format_score(best.rule_score if best else 0.0),
        "score_margin": format_score(margin),
        "title_similarity": format_score(best.title_similarity if best else 0.0),
        "project_number_match": format_score(best.project_number_match if best else 0.0),
        "purchaser_match": format_score(best.purchaser_match if best else 0.0),
        "package_match": format_score(best.package_match if best else 0.0),
        "date_score": format_score(best.date_score if best else 0.0),
        "match_reason": "；".join([reason, *best.reasons]) if best else reason,
        "result_source_file": result.source_file,
        "procurement_source_file": procurement.source_file if procurement else "",
    }


def build_unmatched_row(result: NormalizedRecord, reason: str, best_score: float) -> dict[str, Any]:
    return {
        "result_notice_id": result.notice_id,
        "title": result.row.get("title", ""),
        "project_name": result.project_name,
        "publish_date": result.row.get("publish_date", ""),
        "purchaser": result.row.get("purchaser", ""),
        "package_number": result.row.get("package_number", ""),
        "reason": reason,
        "best_rule_score": format_score(best_score),
        "result_source_file": result.source_file,
    }


def match_projects(
    procurement_rows: list[dict[str, str]],
    result_rows: list[dict[str, str]],
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    procurements = [normalize_procurement(row) for row in procurement_rows]
    results = [normalize_result(row) for row in result_rows]

    project_links: list[dict[str, Any]] = []
    candidate_scores: list[dict[str, Any]] = []
    unmatched_results: list[dict[str, Any]] = []
    counts = {"matched": 0, "review": 0, "unmatched": 0, "conflict": 0}

    for result in results:
        candidates = recall_candidates(result, procurements, max_candidates)
        status, margin, reason = classify_match(candidates)
        counts[status] += 1
        project_links.append(build_project_link_row(result, candidates, status, margin, reason))
        for rank, candidate in enumerate(candidates, start=1):
            candidate_scores.append(build_candidate_row(result, candidate, rank))
        if status == "unmatched":
            best_score = candidates[0].rule_score if candidates else 0.0
            unmatched_results.append(build_unmatched_row(result, reason, best_score))

    summary = {
        "procurement_count": len(procurements),
        "result_count": len(results),
        "matched_count": counts["matched"],
        "review_count": counts["review"],
        "unmatched_count": counts["unmatched"],
        "conflict_count": counts["conflict"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    return project_links, candidate_scores, unmatched_results, summary


def run_matcher(procurement_csv: Path, result_csv: Path, output_dir: Path, max_candidates: int) -> dict[str, Any]:
    procurement_rows = read_csv_rows(procurement_csv)
    result_rows = read_csv_rows(result_csv)
    project_links, candidate_scores, unmatched_results, summary = match_projects(
        procurement_rows,
        result_rows,
        max_candidates=max_candidates,
    )

    write_csv_atomic(output_dir / "project_links.csv", PROJECT_LINK_FIELDS, project_links)
    write_csv_atomic(output_dir / "candidate_scores.csv", CANDIDATE_SCORE_FIELDS, candidate_scores)
    write_csv_atomic(output_dir / "unmatched_results.csv", UNMATCHED_RESULT_FIELDS, unmatched_results)
    write_json_atomic(output_dir / "run_summary.json", summary)
    return summary


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="规则匹配采购公告与结果公告，输出候选分数、最终链接和未匹配结果。",
    )
    parser.add_argument("--procurement-csv", type=Path, default=resolve_default_procurement_csv())
    parser.add_argument("--result-csv", type=Path, default=DEFAULT_RESULT_CSV)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--max-candidates", type=int, default=DEFAULT_MAX_CANDIDATES)
    return parser


def main() -> int:
    parser = build_argument_parser()
    args = parser.parse_args()

    procurement_csv = args.procurement_csv.resolve()
    result_csv = args.result_csv.resolve()
    output_dir = args.output_dir.resolve()
    max_candidates = max(1, args.max_candidates)

    if not procurement_csv.exists():
        parser.error(f"采购公告 CSV 不存在: {procurement_csv}")
    if not result_csv.exists():
        parser.error(f"结果公告 CSV 不存在: {result_csv}")

    summary = run_matcher(procurement_csv, result_csv, output_dir, max_candidates)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
