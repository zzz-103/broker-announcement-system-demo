from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

from backend.llm_table.llm_client import LLMApiConfig, OpenAICompatibleClient
from backend.matching import project_matcher
from backend.matching.prompts import (
    FIRST_PASS_SYSTEM_PROMPT,
    PROMPT_VERSION,
    SECOND_PASS_SYSTEM_PROMPT,
)


ROOT_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ROOT_DIR.parent
DEFAULT_RESULT_CSV = ROOT_DIR / "data" / "staging" / "result" / "result_table.csv"
DEFAULT_PROCUREMENT_CSV = ROOT_DIR / "data" / "staging" / "announcement_table.csv"
DEFAULT_LINKS_CSV = ROOT_DIR / "data" / "staging" / "matching" / "project_links.csv"
DEFAULT_CANDIDATE_SCORES_CSV = ROOT_DIR / "data" / "staging" / "matching" / "candidate_scores.csv"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "data" / "staging" / "llm_matching"
DEFAULT_LLM_CONFIG = ROOT_DIR / "config" / "llm_api_config.json"
DEFAULT_SELECTED_ROOT = (
    ROOT_DIR / "python-http-www-cfcpn-com-jcw" / "output" / "selected"
)
DEFAULT_PROCUREMENT_MARKDOWN_DIR = DEFAULT_SELECTED_ROOT / "procurement" / "notices"
DEFAULT_RESULT_MARKDOWN_DIR = DEFAULT_SELECTED_ROOT / "result" / "notices"
DEFAULT_MAX_CANDIDATES = 5
DEFAULT_WORKERS = 2
DEFAULT_MATCHING_MAX_TOKENS = 2048
DEFAULT_PROGRESS_INTERVAL_SECONDS = 15
MATCHER_VERSION = "p13d_llm_matcher_v1"

_MARKDOWN_CACHE: dict[Path, str] = {}
_MARKDOWN_FILE_INDEX: dict[Path, dict[str, Path]] = {}
_MARKDOWN_FILES: dict[Path, tuple[Path, ...]] = {}
_MARKDOWN_CACHE_LOCK = threading.Lock()

GENERATED_OUTPUT_NAMES = {
    "llm_verified_links.csv",
    "llm_decisions.jsonl",
    "needs_review.csv",
    "unlinked_results.csv",
    "run_summary.json",
}

VERIFIED_LINK_FIELDS = [
    "result_notice_id",
    "procurement_notice_id",
    "final_status",
    "first_decision",
    "first_procurement_notice_id",
    "first_confidence",
    "second_decision",
    "second_procurement_notice_id",
    "second_confidence",
    "rule_status",
    "rule_score",
    "score_margin",
    "hard_conflict",
    "evidence",
    "conflicts",
    "review_required",
    "matcher_version",
    "matched_at",
]

NEEDS_REVIEW_FIELDS = [
    "result_notice_id",
    "result_title",
    "candidate_1_id",
    "candidate_1_title",
    "candidate_1_rule_score",
    "candidate_2_id",
    "candidate_2_title",
    "candidate_2_rule_score",
    "first_decision",
    "first_confidence",
    "second_decision",
    "second_confidence",
    "review_reason",
]

UNLINKED_RESULT_FIELDS = [
    "result_notice_id",
    "title",
    "project_name",
    "purchaser",
    "publish_date",
    "result_type",
    "final_status",
    "reason",
    "retry_count",
    "last_match_attempt_at",
    "matcher_version",
]


@dataclass(frozen=True)
class LLMDecision:
    decision: str
    procurement_notice_id: str
    confidence: float
    evidence: tuple[str, ...]
    conflicts: tuple[str, ...]


@dataclass(frozen=True)
class PassResult:
    name: str
    ok: bool
    decision: LLMDecision | None
    raw_payload: Any | None
    error: str
    cached: bool = False


@dataclass(frozen=True)
class MatchResult:
    result_notice_id: str
    final_status: str
    procurement_notice_id: str
    first: PassResult
    second: PassResult
    hard_conflicts: tuple[str, ...]
    review_reason: str
    cached: bool
    failed: bool
    skipped: bool = False


class JsonClient(Protocol):
    config: LLMApiConfig

    def request_json(self, messages: list[dict[str, str]]) -> Any:
        ...


class MatchingLLMClient:
    def __init__(self, config: LLMApiConfig) -> None:
        self.config = config
        self.client = OpenAICompatibleClient(config)
        self.max_tokens = matching_max_tokens(config)

    def request_json(self, messages: list[dict[str, str]]) -> Any:
        request_kwargs: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "temperature": self.config.temperature,
            "top_p": self.config.top_p,
            "max_tokens": self.max_tokens,
            "frequency_penalty": self.config.frequency_penalty,
            "presence_penalty": self.config.presence_penalty,
        }
        if self.config.use_json_object:
            request_kwargs["response_format"] = {"type": "json_object"}
        return self.client._request_json(request_kwargs)


def matching_max_tokens(config: LLMApiConfig) -> int:
    """Keep the verification response budget small and configurable."""

    raw_limit = os.getenv("LLM_MATCHING_MAX_TOKENS")
    try:
        configured_limit = int(raw_limit) if raw_limit else DEFAULT_MATCHING_MAX_TOKENS
    except ValueError:
        configured_limit = DEFAULT_MATCHING_MAX_TOKENS
    configured_limit = max(1, min(configured_limit, 32768))
    return max(1, min(int(config.max_tokens), configured_limit))


def apply_matching_timeout_override(config: LLMApiConfig) -> None:
    raw_timeout = os.getenv("LLM_MATCHING_TIMEOUT_SECONDS")
    if not raw_timeout:
        return
    try:
        config.timeout_seconds = max(1, min(int(raw_timeout), 600))
    except ValueError:
        return


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames is None:
            return []
        return [
            {key: normalize_text(value) for key, value in row.items()}
            for row in reader
        ]


def write_csv_atomic(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = atomic_temp_path(path)
    try:
        with temp_path.open("w", encoding="utf-8-sig", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows([{field: row.get(field, "") for field in fieldnames} for row in rows])
        replace_or_overwrite(temp_path, path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = atomic_temp_path(path)
    try:
        with temp_path.open("w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)
            file.write("\n")
        replace_or_overwrite(temp_path, path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def write_jsonl_atomic(path: Path, rows: list[dict[str, Any]]) -> None:
    content = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = atomic_temp_path(path)
    try:
        with temp_path.open("w", encoding="utf-8") as file:
            file.write(content)
        replace_or_overwrite(temp_path, path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def atomic_temp_path(path: Path) -> Path:
    return path.with_name(f"tmp_{os.getpid()}_{threading.get_ident()}_{path.name}")


def replace_or_overwrite(temp_path: Path, target_path: Path) -> None:
    try:
        os.replace(temp_path, target_path)
    except PermissionError:
        target_path.write_bytes(temp_path.read_bytes())


def json_hash(payload: Any) -> str:
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def parse_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def parse_date(value: Any) -> datetime | None:
    return project_matcher.parse_date(value)


def result_id(row: dict[str, str]) -> str:
    return row.get("notice_id") or row.get("document_sha1") or row.get("source_file") or row.get("markdown_file") or ""


def procurement_id(row: dict[str, str]) -> str:
    return row.get("notice_id") or row.get("document_sha1") or row.get("source_file") or row.get("markdown_file") or ""


def source_file(row: dict[str, str]) -> str:
    return row.get("source_file") or row.get("markdown_file") or ""


def build_indexes(rows: list[dict[str, str]], id_func: Any) -> dict[str, dict[str, str]]:
    indexed: dict[str, dict[str, str]] = {}
    for row in rows:
        key = id_func(row)
        if key:
            indexed[key] = row
    return indexed


def group_rows(rows: list[dict[str, str]], key: str) -> dict[str, list[dict[str, str]]]:
    grouped: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        grouped.setdefault(row.get(key, ""), []).append(row)
    return grouped


def select_candidates(
    result_row: dict[str, str],
    candidate_rows: list[dict[str, str]],
    procurements_by_id: dict[str, dict[str, str]],
    max_candidates: int,
) -> list[dict[str, Any]]:
    result_number = project_matcher.normalize_project_number(result_row.get("project_number"))
    decorated: list[tuple[int, float, int, dict[str, str]]] = []
    for index, row in enumerate(candidate_rows):
        procurement = procurements_by_id.get(row.get("procurement_notice_id", ""), {})
        procurement_number = project_matcher.normalize_project_number(
            procurement.get("project_number") or row.get("procurement_project_name", "")
        )
        number_match = bool(result_number and procurement_number and result_number == procurement_number)
        decorated.append((1 if number_match else 0, parse_float(row.get("rule_score")), -index, row))

    decorated.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
    selected_rows = [item[3] for item in decorated[: max(1, max_candidates)]]

    selected: list[dict[str, Any]] = []
    for row in selected_rows:
        procurement = procurements_by_id.get(row.get("procurement_notice_id", ""), {})
        selected.append(build_candidate_payload(row, procurement))
    return selected


def build_result_payload(row: dict[str, str], markdown_excerpt: str = "") -> dict[str, Any]:
    return {
        "notice_id": result_id(row),
        "title": row.get("title", ""),
        "project_name": row.get("project_name", ""),
        "project_number": row.get("project_number", ""),
        "purchaser": row.get("purchaser", ""),
        "package_number": row.get("package_number", ""),
        "publish_date": row.get("publish_date", ""),
        "result_type": row.get("result_type", ""),
        "winner": row.get("winner", ""),
        "winner_candidates": row.get("winner_candidates", ""),
        "winning_amount": row.get("winning_amount", ""),
        "source_file": source_file(row),
        "text_excerpt": markdown_excerpt,
    }


def build_candidate_payload(score_row: dict[str, str], procurement_row: dict[str, str]) -> dict[str, Any]:
    notice_id = score_row.get("procurement_notice_id", "")
    hard_conflicts = detect_hard_conflicts_from_rows(score_row, procurement_row)
    return {
        "notice_id": notice_id,
        "title": procurement_row.get("title", "") or procurement_row.get("project_name", ""),
        "project_name": procurement_row.get("project_name") or score_row.get("procurement_project_name", ""),
        "project_number": procurement_row.get("project_number", ""),
        "purchaser": procurement_row.get("purchaser") or procurement_row.get("broker_name") or score_row.get("procurement_purchaser", ""),
        "package_number": procurement_row.get("package_number") or score_row.get("procurement_package_number", ""),
        "publish_date": procurement_row.get("publish_date") or score_row.get("procurement_publish_date", ""),
        "procurement_scope_summary": procurement_row.get("procurement_scope_summary", ""),
        "source_file": source_file(procurement_row) or score_row.get("procurement_source_file", ""),
        "rule_score": score_row.get("rule_score", ""),
        "title_similarity": score_row.get("title_similarity", ""),
        "project_number_match": score_row.get("project_number_match", ""),
        "purchaser_match": score_row.get("purchaser_match", ""),
        "package_match": score_row.get("package_match", ""),
        "date_score": score_row.get("date_score", ""),
        "match_reason": score_row.get("score_reason", ""),
        "hard_conflicts": hard_conflicts,
    }


def detect_hard_conflicts_from_rows(score_row: dict[str, str], procurement_row: dict[str, str]) -> list[str]:
    conflicts: list[str] = []
    result_package = project_matcher.normalize_package_number(score_row.get("result_package_number", ""))
    procurement_package = project_matcher.normalize_package_number(
        procurement_row.get("package_number") or score_row.get("procurement_package_number", "")
    )
    if result_package and procurement_package and result_package != procurement_package:
        conflicts.append("包号或标段明确冲突")
    result_date = parse_date(score_row.get("result_publish_date"))
    procurement_date = parse_date(procurement_row.get("publish_date") or score_row.get("procurement_publish_date"))
    if result_date and procurement_date and result_date < procurement_date:
        conflicts.append("结果日期早于采购公告")
    return conflicts


def detect_hard_conflicts(result_row: dict[str, str], candidate: dict[str, Any]) -> list[str]:
    conflicts: list[str] = []
    result_number = project_matcher.normalize_project_number(result_row.get("project_number"))
    procurement_number = project_matcher.normalize_project_number(candidate.get("project_number"))
    if result_number and procurement_number and result_number != procurement_number:
        conflicts.append("项目编号明确不同")

    result_package = project_matcher.normalize_package_number(
        result_row.get("package_number") or result_row.get("project_name", "")
    )
    procurement_package = project_matcher.normalize_package_number(
        candidate.get("package_number") or candidate.get("project_name", "")
    )
    if result_package and procurement_package and result_package != procurement_package:
        conflicts.append("包号或标段明确冲突")

    result_date = parse_date(result_row.get("publish_date"))
    procurement_date = parse_date(candidate.get("publish_date"))
    if result_date and procurement_date and result_date < procurement_date:
        conflicts.append("结果日期早于采购公告")

    result_title = f"{result_row.get('title', '')} {result_row.get('project_name', '')}"
    procurement_title = f"{candidate.get('title', '')} {candidate.get('project_name', '')}"
    if has_second_round_marker(result_title) and not has_second_round_marker(procurement_title):
        conflicts.append("采购轮次可能不一致")
    return conflicts


def has_second_round_marker(text: str) -> bool:
    return any(marker in text for marker in ("第二次", "二次", "重新招标", "重新采购", "再次"))


def sanitize_decision(payload: Any, candidate_ids: set[str]) -> LLMDecision:
    if not isinstance(payload, dict):
        raise ValueError("模型输出不是 JSON 对象")
    decision = normalize_text(payload.get("decision")).lower()
    if decision not in {"matched", "unmatched", "ambiguous"}:
        raise ValueError("模型输出 decision 无效")
    procurement_notice_id = normalize_text(payload.get("procurement_notice_id"))
    if decision == "matched" and procurement_notice_id not in candidate_ids:
        raise ValueError("模型选择了候选列表外的采购公告 ID")
    if decision != "matched":
        procurement_notice_id = ""
    confidence = parse_float(payload.get("confidence"), -1.0)
    if confidence < 0 or confidence > 1:
        raise ValueError("模型输出 confidence 无效")
    evidence = normalize_string_list(payload.get("evidence"))
    conflicts = normalize_string_list(payload.get("conflicts"))
    return LLMDecision(
        decision=decision,
        procurement_notice_id=procurement_notice_id,
        confidence=confidence,
        evidence=tuple(evidence),
        conflicts=tuple(conflicts),
    )


def normalize_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [normalize_text(item) for item in value if normalize_text(item)]
    text = normalize_text(value)
    return [text] if text else []


def build_user_prompt(result_payload: dict[str, Any], candidates: list[dict[str, Any]], expanded: bool) -> str:
    payload = {
        "result_announcement": result_payload,
        "procurement_candidates": candidates,
        "instructions": [
            "只能返回严格 JSON 对象。",
            "若候选不足以确认匹配，返回 unmatched 或 ambiguous。",
            "证据和冲突必须简短可审计，不要输出完整思维过程。",
        ],
    }
    if expanded:
        payload["review_focus"] = [
            "重新检查项目编号、包号、采购轮次和时间顺序。",
            "若候选没有正确答案，请返回 unmatched。",
        ]
    return json.dumps(payload, ensure_ascii=False, indent=2)


def call_pass(
    client: JsonClient,
    pass_name: str,
    system_prompt: str,
    result_payload: dict[str, Any],
    candidates: list[dict[str, Any]],
    expanded: bool,
) -> PassResult:
    candidate_ids = {normalize_text(candidate.get("notice_id")) for candidate in candidates if normalize_text(candidate.get("notice_id"))}
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": build_user_prompt(result_payload, candidates, expanded)},
    ]
    try:
        raw = client.request_json(messages)
        decision = sanitize_decision(raw, candidate_ids)
        return PassResult(pass_name, True, decision, raw, "")
    except Exception as exc:
        return PassResult(pass_name, False, None, None, f"{exc.__class__.__name__}: {exc}")


def choose_final_status(
    result_row: dict[str, str],
    candidates: list[dict[str, Any]],
    first: PassResult,
    second: PassResult,
) -> tuple[str, str, tuple[str, ...], str, bool]:
    if not first.ok or not second.ok or first.decision is None or second.decision is None:
        errors = [item.error for item in (first, second) if item.error]
        return "failed", "", (), "；".join(errors), True

    hard_conflicts = tuple(collect_hard_conflicts(result_row, candidates, first, second))
    first_decision = first.decision
    second_decision = second.decision
    if (
        first_decision.decision == "matched"
        and second_decision.decision == "matched"
        and first_decision.procurement_notice_id == second_decision.procurement_notice_id
        and first_decision.confidence >= 0.95
        and second_decision.confidence >= 0.95
        and not hard_conflicts
    ):
        return "auto_matched", first_decision.procurement_notice_id, hard_conflicts, "", False

    if (
        first_decision.decision == "unmatched"
        and second_decision.decision == "unmatched"
        and first_decision.confidence >= 0.90
        and second_decision.confidence >= 0.90
    ):
        return "auto_unmatched", "", hard_conflicts, "result_only", False

    reasons: list[str] = []
    if first_decision.decision == "ambiguous" or second_decision.decision == "ambiguous":
        reasons.append("任一次 LLM 判断为 ambiguous")
    if first_decision.decision != second_decision.decision:
        reasons.append("两次 LLM 判断类型不一致")
    if first_decision.procurement_notice_id != second_decision.procurement_notice_id:
        reasons.append("两次 LLM 选择候选不同")
    if first_decision.confidence < 0.95 or second_decision.confidence < 0.95:
        reasons.append("置信度低于自动匹配阈值")
    if hard_conflicts:
        reasons.extend(hard_conflicts)
    return "needs_review", first_decision.procurement_notice_id or second_decision.procurement_notice_id, hard_conflicts, "；".join(dict.fromkeys(reasons)), False


def collect_hard_conflicts(
    result_row: dict[str, str],
    candidates: list[dict[str, Any]],
    first: PassResult,
    second: PassResult,
) -> list[str]:
    selected_ids = {
        decision.procurement_notice_id
        for decision in (first.decision, second.decision)
        if decision and decision.procurement_notice_id
    }
    conflicts: list[str] = []
    for candidate in candidates:
        candidate_id = normalize_text(candidate.get("notice_id"))
        if candidate_id in selected_ids:
            conflicts.extend(detect_hard_conflicts(result_row, candidate))
            conflicts.extend(normalize_string_list(candidate.get("hard_conflicts")))
    for decision in (first.decision, second.decision):
        if decision:
            conflicts.extend(decision.conflicts)
    return list(dict.fromkeys(conflicts))


def load_markdown_excerpt(row: dict[str, str], search_dirs: list[Path], notice_id_value: str, expanded: bool = False) -> str:
    path = resolve_source_path(row, search_dirs, notice_id_value)
    if path is None:
        return ""
    try:
        resolved = path.resolve()
        with _MARKDOWN_CACHE_LOCK:
            text = _MARKDOWN_CACHE.get(resolved)
        if text is None:
            text = resolved.read_text(encoding="utf-8-sig")
            with _MARKDOWN_CACHE_LOCK:
                _MARKDOWN_CACHE[resolved] = text
    except OSError:
        return ""
    limit = 8000 if expanded else 2400
    return text[:limit]


def markdown_directory_index(directory: Path) -> tuple[dict[str, Path], tuple[Path, ...]]:
    resolved_directory = directory.resolve()
    with _MARKDOWN_CACHE_LOCK:
        cached_index = _MARKDOWN_FILE_INDEX.get(resolved_directory)
        cached_files = _MARKDOWN_FILES.get(resolved_directory)
        if cached_index is not None and cached_files is not None:
            return cached_index, cached_files

        if not resolved_directory.exists():
            index: dict[str, Path] = {}
            files: tuple[Path, ...] = ()
        else:
            files = tuple(resolved_directory.rglob("*.md"))
            index = {}
            for file_path in files:
                index.setdefault(file_path.name, file_path)
                index.setdefault(file_path.stem, file_path)
        _MARKDOWN_FILE_INDEX[resolved_directory] = index
        _MARKDOWN_FILES[resolved_directory] = files
        return index, files


def resolve_source_path(row: dict[str, str], search_dirs: list[Path], notice_id_value: str) -> Path | None:
    raw_candidates = [
        row.get("source_file", ""),
        row.get("markdown_file", ""),
    ]
    for raw in raw_candidates:
        text = normalize_text(raw)
        if not text:
            continue
        path = Path(text)
        if path.exists() and path.is_file():
            return path
        if not path.is_absolute():
            project_path = PROJECT_ROOT / path
            if project_path.exists() and project_path.is_file():
                return project_path

    names: set[str] = set()
    for raw in raw_candidates:
        text = normalize_text(raw)
        if not text:
            continue
        path = Path(text.replace("\\", "/"))
        names.add(path.name)
        names.add(path.stem)
    if notice_id_value:
        names.add(notice_id_value)

    for directory in search_dirs:
        index, files = markdown_directory_index(directory)
        for name in names:
            path = index.get(name)
            if path is not None:
                return path
        if notice_id_value:
            for file_path in files:
                if notice_id_value in file_path.name:
                    return file_path
    return None


def cache_key_payload(
    result_row: dict[str, str],
    result_payload: dict[str, Any],
    candidates: list[dict[str, Any]],
    model_name: str,
) -> dict[str, Any]:
    return {
        "result_notice_id": result_id(result_row),
        "candidate_notice_ids": [candidate.get("notice_id", "") for candidate in candidates],
        "candidate_content_hash": json_hash(candidates),
        "result_content_hash": json_hash(result_payload),
        "prompt_version": PROMPT_VERSION,
        "model_name": model_name,
    }


def cache_path_for(output_dir: Path, cache_key: str) -> Path:
    return output_dir / "raw_json" / f"{cache_key}.json"


def load_cached_match(path: Path) -> tuple[PassResult, PassResult] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        first_raw = payload["first_raw"]
        second_raw = payload["second_raw"]
        candidate_ids = set(payload.get("candidate_notice_ids", []))
        first = PassResult("first", True, sanitize_decision(first_raw, candidate_ids), first_raw, "", cached=True)
        second = PassResult("second", True, sanitize_decision(second_raw, candidate_ids), second_raw, "", cached=True)
        return first, second
    except Exception:
        return None


def save_cached_match(path: Path, cache_payload: dict[str, Any], first: PassResult, second: PassResult) -> None:
    if not first.ok or not second.ok:
        return
    payload = {
        **cache_payload,
        "first_raw": first.raw_payload,
        "second_raw": second.raw_payload,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    write_json_atomic(path, payload)


def build_rule_unmatched_result(result_row: dict[str, str]) -> MatchResult:
    raw_payload = {
        "decision": "unmatched",
        "procurement_notice_id": "",
        "confidence": 1.0,
        "evidence": ["规则阶段未召回采购公告候选"],
        "conflicts": [],
    }
    first = PassResult(
        "first",
        True,
        LLMDecision("unmatched", "", 1.0, ("规则阶段未召回采购公告候选",), ()),
        raw_payload,
        "",
    )
    second = PassResult(
        "second",
        True,
        first.decision,
        raw_payload,
        "",
    )
    return MatchResult(
        result_notice_id=result_id(result_row),
        final_status="auto_unmatched",
        procurement_notice_id="",
        first=first,
        second=second,
        hard_conflicts=(),
        review_reason="规则阶段未召回采购公告候选",
        cached=False,
        failed=False,
        skipped=True,
    )


def process_one(
    result_row: dict[str, str],
    candidate_rows: list[dict[str, str]],
    procurements_by_id: dict[str, dict[str, str]],
    links_by_result: dict[str, dict[str, str]],
    client: JsonClient,
    output_dir: Path,
    max_candidates: int,
    procurement_markdown_dir: Path,
    result_markdown_dir: Path,
) -> MatchResult:
    rid = result_id(result_row)
    candidates = select_candidates(result_row, candidate_rows, procurements_by_id, max_candidates)
    if not candidates:
        return build_rule_unmatched_result(result_row)

    result_excerpt = load_markdown_excerpt(
        result_row,
        [result_markdown_dir],
        rid,
        expanded=False,
    )
    result_payload = build_result_payload(result_row, result_excerpt)
    for candidate in candidates:
        procurement_row = procurements_by_id.get(normalize_text(candidate.get("notice_id")), {})
        candidate["text_excerpt"] = load_markdown_excerpt(
            procurement_row or {"source_file": candidate.get("source_file", "")},
            [procurement_markdown_dir],
            normalize_text(candidate.get("notice_id")),
            expanded=False,
        )

    cache_payload = cache_key_payload(result_row, result_payload, candidates, client.config.model)
    key = json_hash(cache_payload)
    path = cache_path_for(output_dir, key)
    cached = load_cached_match(path)
    if cached:
        first, second = cached
    else:
        first = call_pass(client, "first", FIRST_PASS_SYSTEM_PROMPT, result_payload, candidates, expanded=False)
        second_result_payload = result_payload
        second_candidates = candidates
        if first.ok and first.decision and first.decision.decision == "ambiguous":
            expanded_excerpt = load_markdown_excerpt(
                result_row,
                [result_markdown_dir],
                rid,
                expanded=True,
            )
            second_result_payload = build_result_payload(result_row, expanded_excerpt)
            second_candidates = []
            for candidate in candidates:
                updated = dict(candidate)
                procurement_row = procurements_by_id.get(normalize_text(candidate.get("notice_id")), {})
                updated["text_excerpt"] = load_markdown_excerpt(
                    procurement_row or {"source_file": candidate.get("source_file", "")},
                    [procurement_markdown_dir],
                    normalize_text(candidate.get("notice_id")),
                    expanded=True,
                )
                second_candidates.append(updated)
        second = call_pass(client, "second", SECOND_PASS_SYSTEM_PROMPT, second_result_payload, second_candidates, expanded=True)
        save_cached_match(path, {**cache_payload, "candidate_notice_ids": [c.get("notice_id", "") for c in candidates]}, first, second)

    status, procurement_notice_id, hard_conflicts, review_reason, failed = choose_final_status(
        result_row,
        candidates,
        first,
        second,
    )
    if not procurement_notice_id and status == "auto_matched":
        procurement_notice_id = links_by_result.get(rid, {}).get("procurement_notice_id", "")
    return MatchResult(
        result_notice_id=rid,
        final_status=status,
        procurement_notice_id=procurement_notice_id,
        first=first,
        second=second,
        hard_conflicts=hard_conflicts,
        review_reason=review_reason,
        cached=bool(cached),
        failed=failed,
    )


def build_verified_row(result: MatchResult, link_row: dict[str, str]) -> dict[str, Any]:
    first = result.first.decision
    second = result.second.decision
    evidence = []
    conflicts = list(result.hard_conflicts)
    if first:
        evidence.extend(first.evidence)
        conflicts.extend(first.conflicts)
    if second:
        evidence.extend(second.evidence)
        conflicts.extend(second.conflicts)
    return {
        "result_notice_id": result.result_notice_id,
        "procurement_notice_id": result.procurement_notice_id if result.final_status == "auto_matched" else "",
        "final_status": result.final_status,
        "first_decision": first.decision if first else "",
        "first_procurement_notice_id": first.procurement_notice_id if first else "",
        "first_confidence": format_score(first.confidence) if first else "",
        "second_decision": second.decision if second else "",
        "second_procurement_notice_id": second.procurement_notice_id if second else "",
        "second_confidence": format_score(second.confidence) if second else "",
        "rule_status": link_row.get("match_status", ""),
        "rule_score": link_row.get("rule_score", ""),
        "score_margin": link_row.get("score_margin", ""),
        "hard_conflict": "；".join(result.hard_conflicts),
        "evidence": "；".join(dict.fromkeys(evidence)),
        "conflicts": "；".join(dict.fromkeys(conflicts)),
        "review_required": "true" if result.final_status in {"needs_review", "failed"} else "false",
        "matcher_version": MATCHER_VERSION,
        "matched_at": datetime.now(timezone.utc).isoformat(),
    }


def build_needs_review_row(
    result: MatchResult,
    result_row: dict[str, str],
    candidate_rows: list[dict[str, str]],
) -> dict[str, Any]:
    first = result.first.decision
    second = result.second.decision
    first_candidate = candidate_rows[0] if candidate_rows else {}
    second_candidate = candidate_rows[1] if len(candidate_rows) > 1 else {}
    return {
        "result_notice_id": result.result_notice_id,
        "result_title": result_row.get("title", ""),
        "candidate_1_id": first_candidate.get("procurement_notice_id", ""),
        "candidate_1_title": first_candidate.get("procurement_project_name", ""),
        "candidate_1_rule_score": first_candidate.get("rule_score", ""),
        "candidate_2_id": second_candidate.get("procurement_notice_id", ""),
        "candidate_2_title": second_candidate.get("procurement_project_name", ""),
        "candidate_2_rule_score": second_candidate.get("rule_score", ""),
        "first_decision": first.decision if first else "",
        "first_confidence": format_score(first.confidence) if first else "",
        "second_decision": second.decision if second else "",
        "second_confidence": format_score(second.confidence) if second else "",
        "review_reason": result.review_reason,
    }


def build_unlinked_row(result: MatchResult, result_row: dict[str, str]) -> dict[str, Any]:
    return {
        "result_notice_id": result.result_notice_id,
        "title": result_row.get("title", ""),
        "project_name": result_row.get("project_name", ""),
        "purchaser": result_row.get("purchaser", ""),
        "publish_date": result_row.get("publish_date", ""),
        "result_type": result_row.get("result_type", ""),
        "final_status": "result_only",
        "reason": result.review_reason or "双重 LLM 判断为 unmatched",
        "retry_count": 0,
        "last_match_attempt_at": datetime.now(timezone.utc).isoformat(),
        "matcher_version": MATCHER_VERSION,
    }


def build_decision_record(result: MatchResult) -> dict[str, Any]:
    return {
        "result_notice_id": result.result_notice_id,
        "final_status": result.final_status,
        "procurement_notice_id": result.procurement_notice_id,
        "first": pass_to_dict(result.first),
        "second": pass_to_dict(result.second),
        "hard_conflicts": list(result.hard_conflicts),
        "review_reason": result.review_reason,
        "cached": result.cached,
        "skipped": result.skipped,
        "matcher_version": MATCHER_VERSION,
    }


def pass_to_dict(result: PassResult) -> dict[str, Any]:
    decision = result.decision
    return {
        "ok": result.ok,
        "decision": decision.decision if decision else "",
        "procurement_notice_id": decision.procurement_notice_id if decision else "",
        "confidence": decision.confidence if decision else None,
        "evidence": list(decision.evidence) if decision else [],
        "conflicts": list(decision.conflicts) if decision else [],
        "error": result.error,
        "cached": result.cached,
    }


def format_score(value: float) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".")


def safe_full_refresh(output_dir: Path) -> None:
    resolved_output = output_dir.resolve()
    resolved_default = DEFAULT_OUTPUT_DIR.resolve()
    staging_root = (ROOT_DIR / "data" / "staging").resolve()
    if resolved_output != resolved_default:
        try:
            relative = resolved_output.relative_to(staging_root)
        except ValueError as exc:
            raise ValueError("--full-refresh 只允许清理 backend/data/staging/llm_matching") from exc
        if relative.parts != ("llm_matching",):
            raise ValueError("--full-refresh 只允许清理名为 llm_matching 的 staging 输出目录")

    output_dir.mkdir(parents=True, exist_ok=True)
    for name in GENERATED_OUTPUT_NAMES:
        path = output_dir / name
        if path.exists() and path.is_file():
            path.unlink()
    raw_json_dir = output_dir / "raw_json"
    if raw_json_dir.exists() and raw_json_dir.is_dir():
        shutil.rmtree(raw_json_dir)


def run_llm_matching(
    result_csv: Path,
    procurement_csv: Path,
    links_csv: Path,
    candidate_scores_csv: Path,
    output_dir: Path,
    client: JsonClient,
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
    workers: int = DEFAULT_WORKERS,
    max_files: int | None = None,
    full_refresh: bool = False,
    procurement_markdown_dir: Path = DEFAULT_PROCUREMENT_MARKDOWN_DIR,
    result_markdown_dir: Path = DEFAULT_RESULT_MARKDOWN_DIR,
) -> dict[str, Any]:
    if full_refresh:
        safe_full_refresh(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "raw_json").mkdir(parents=True, exist_ok=True)

    result_rows = read_csv_rows(result_csv)
    procurement_rows = read_csv_rows(procurement_csv)
    link_rows = read_csv_rows(links_csv)
    candidate_score_rows = read_csv_rows(candidate_scores_csv)
    input_result_count = len(result_rows)
    if max_files is not None:
        result_rows = result_rows[: max(0, max_files)]

    unique_result_rows: list[dict[str, str]] = []
    duplicate_result_ids: set[str] = set()
    seen_result_rows: dict[str, dict[str, str]] = {}
    for row in result_rows:
        rid = result_id(row)
        previous = seen_result_rows.get(rid)
        if not rid:
            duplicate_result_ids.add(rid)
            continue
        if previous is None:
            seen_result_rows[rid] = row
            unique_result_rows.append(row)
        elif previous != row:
            duplicate_result_ids.add(rid)
    result_rows = [row for row in unique_result_rows if result_id(row) not in duplicate_result_ids]

    procurements_by_id = build_indexes(procurement_rows, procurement_id)
    links_by_result = {row.get("result_notice_id", ""): row for row in link_rows}
    candidates_by_result = group_rows(candidate_score_rows, "result_notice_id")
    results_by_id = build_indexes(result_rows, result_id)

    worker_count = max(1, workers)
    candidate_result_count = sum(
        bool(candidates_by_result.get(result_id(row))) for row in result_rows
    )
    print(
        "[llm-matching] "
        f"待处理 {len(result_rows)} 条；有候选 {candidate_result_count} 条；"
        f"无候选跳过 {len(result_rows) - candidate_result_count} 条；"
        f"工作线程 {worker_count}；预计 LLM 请求不超过 {candidate_result_count * 2} 次",
        flush=True,
    )

    results: list[MatchResult] = []
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        future_map = {
            executor.submit(
                process_one,
                row,
                candidates_by_result.get(result_id(row), []),
                procurements_by_id,
                links_by_result,
                client,
                output_dir,
                max_candidates,
                procurement_markdown_dir,
                result_markdown_dir,
            ): row
            for row in result_rows
        }
        pending = set(future_map)
        completed = 0
        started_at = time.monotonic()
        progress_interval = max(
            1,
            min(25, len(result_rows) // 20 or 1),
        )
        while pending:
            done, pending = wait(
                pending,
                timeout=DEFAULT_PROGRESS_INTERVAL_SECONDS,
                return_when=FIRST_COMPLETED,
            )
            if not done:
                elapsed = time.monotonic() - started_at
                print(
                    "[llm-matching] "
                    f"已完成 {completed}/{len(result_rows)} 条，剩余 {len(pending)} 条；"
                    f"已等待 {elapsed:.0f}s",
                    flush=True,
                )
                continue
            for future in done:
                results.append(future.result())
                completed += 1
                if (
                    completed == len(result_rows)
                    or completed % progress_interval == 0
                ):
                    elapsed = time.monotonic() - started_at
                    print(
                        "[llm-matching] "
                        f"已完成 {completed}/{len(result_rows)} 条；"
                        f"已用时 {elapsed:.0f}s",
                        flush=True,
                    )

    results.sort(key=lambda item: item.result_notice_id)
    verified_rows: list[dict[str, Any]] = []
    review_rows: list[dict[str, Any]] = []
    unlinked_rows: list[dict[str, Any]] = []
    decision_rows: list[dict[str, Any]] = []
    for result in results:
        result_row = results_by_id.get(result.result_notice_id, {})
        link_row = links_by_result.get(result.result_notice_id, {})
        candidate_rows = sorted(
            candidates_by_result.get(result.result_notice_id, []),
            key=lambda row: parse_float(row.get("rule_score")),
            reverse=True,
        )[: max(1, max_candidates)]
        verified_rows.append(build_verified_row(result, link_row))
        decision_rows.append(build_decision_record(result))
        if result.final_status in {"needs_review", "failed"}:
            review_rows.append(build_needs_review_row(result, result_row, candidate_rows))
        if result.final_status == "auto_unmatched":
            unlinked_rows.append(build_unlinked_row(result, result_row))

    write_csv_atomic(output_dir / "llm_verified_links.csv", VERIFIED_LINK_FIELDS, verified_rows)
    write_csv_atomic(output_dir / "needs_review.csv", NEEDS_REVIEW_FIELDS, review_rows)
    write_csv_atomic(output_dir / "unlinked_results.csv", UNLINKED_RESULT_FIELDS, unlinked_rows)
    write_jsonl_atomic(output_dir / "llm_decisions.jsonl", decision_rows)

    counts = {
        "auto_matched_count": sum(row["final_status"] == "auto_matched" for row in verified_rows),
        "auto_unmatched_count": sum(row["final_status"] == "auto_unmatched" for row in verified_rows),
        "needs_review_count": sum(row["final_status"] == "needs_review" for row in verified_rows),
        "failed_count": sum(row["final_status"] == "failed" for row in verified_rows),
        "cached_count": sum(bool(item.cached) for item in results),
        "skipped_count": sum(bool(item.skipped) for item in results),
    }
    summary = {
        "input_result_count": input_result_count,
        "processed_count": len(verified_rows),
        "duplicate_result_count": len(duplicate_result_ids),
        **counts,
        "llm_request_count": sum(
            0 if item.cached or item.skipped else 2
            for item in results
            if not item.failed or not item.cached
        ),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "matcher_version": MATCHER_VERSION,
    }
    write_json_atomic(output_dir / "run_summary.json", summary)
    return summary


def load_client(llm_config_path: Path) -> MatchingLLMClient:
    config = LLMApiConfig.load(llm_config_path)
    apply_matching_timeout_override(config)
    config.validate()
    return MatchingLLMClient(config)


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="LLM 双重复核采购公告与结果公告匹配。")
    parser.add_argument("--result-csv", type=Path, default=DEFAULT_RESULT_CSV)
    parser.add_argument("--procurement-csv", type=Path, default=DEFAULT_PROCUREMENT_CSV)
    parser.add_argument("--links-csv", type=Path, default=DEFAULT_LINKS_CSV)
    parser.add_argument("--candidate-scores-csv", type=Path, default=DEFAULT_CANDIDATE_SCORES_CSV)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--llm-config", type=Path, default=DEFAULT_LLM_CONFIG)
    parser.add_argument(
        "--procurement-markdown-dir",
        type=Path,
        default=DEFAULT_PROCUREMENT_MARKDOWN_DIR,
    )
    parser.add_argument(
        "--result-markdown-dir",
        type=Path,
        default=DEFAULT_RESULT_MARKDOWN_DIR,
    )
    parser.add_argument("--max-candidates", type=int, default=DEFAULT_MAX_CANDIDATES)
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    parser.add_argument("--max-files", type=int, default=None)
    parser.add_argument("--full-refresh", action="store_true")
    return parser


def main() -> int:
    parser = build_argument_parser()
    args = parser.parse_args()
    paths = [args.result_csv, args.procurement_csv, args.links_csv, args.candidate_scores_csv, args.llm_config]
    for path in paths:
        if not path.exists():
            parser.error(f"文件不存在: {path}")
    try:
        client = load_client(args.llm_config.resolve())
        summary = run_llm_matching(
            result_csv=args.result_csv.resolve(),
            procurement_csv=args.procurement_csv.resolve(),
            links_csv=args.links_csv.resolve(),
            candidate_scores_csv=args.candidate_scores_csv.resolve(),
            output_dir=args.output_dir.resolve(),
            client=client,
            max_candidates=max(1, args.max_candidates),
            workers=max(1, args.workers),
            max_files=args.max_files,
            full_refresh=args.full_refresh,
            procurement_markdown_dir=args.procurement_markdown_dir.resolve(),
            result_markdown_dir=args.result_markdown_dir.resolve(),
        )
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
