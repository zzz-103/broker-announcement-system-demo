"""Safe App Watch processing, history-preserving merge and CSV publication."""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import os
import re
import tempfile
from dataclasses import asdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

import yaml

from broker_app_watch.core.config import BrokerCatalog, BrokerSource
from broker_app_watch.core.paths import EXPORTS_DATA_DIR, LLM_DATA_DIR, PROJECT_ROOT, RAW_DATA_DIR
from broker_app_watch.llm.client import AppReleaseExtraction, AppReleaseLlmClient
from broker_app_watch.pipeline.crawl import CrawlSummary, crawl_all
from broker_app_watch.storage.models import APP_RELEASE_CSV_COLUMNS, AppReleaseAnalysis, AppReleaseRow


LOGGER = logging.getLogger(__name__)
SHANGHAI = ZoneInfo("Asia/Shanghai")
KNOWN_UPDATE_TYPES = {"新功能", "体验优化", "问题修复", "合规安全", "其他"}
KNOWN_FEATURE_TAGS = {"行情", "交易", "开户", "理财", "资讯", "AI智能", "安全", "其他"}
KNOWN_PLATFORMS = {"iOS", "Android", "HarmonyOS", "全平台", "未知"}
PROCESSABLE_SECTION_PARSERS = {
    "essence_softwares_api",
    "ciccwm_appdown_api",
    "cgws_download_html",
    "dgzq_soft_api",
    "ykzq_cms_article",
}
FAILURE_RATE_LIMIT = 0.5


class RefreshError(RuntimeError):
    """Raised when a refresh cannot produce a safe export."""


@dataclass(frozen=True, slots=True)
class ProcessingFailure:
    path: str
    reason: str
    unit: str = ""


@dataclass(frozen=True, slots=True)
class RefreshResult:
    exported_rows: int
    updated_brokers: tuple[str, ...] = ()
    preserved_brokers: tuple[str, ...] = ()
    failures: dict[str, str] = field(default_factory=dict)
    blocked: bool = False
    failure_rate: float = 0.0


def _parse_front_matter(path: Path) -> tuple[dict[str, str], str]:
    raw = path.read_text(encoding="utf-8-sig")
    if not raw.startswith("---"):
        return {}, raw
    parts = raw.split("---", 2)
    if len(parts) != 3:
        raise ValueError(f"Markdown front matter 无法解析：{path.name}")
    values = yaml.safe_load(parts[1]) or {}
    if not isinstance(values, dict):
        raise ValueError(f"Markdown front matter 必须是对象：{path.name}")
    metadata = {str(key): str(value or "") for key, value in values.items()}
    return metadata, parts[2].strip()


def _clean_body(content: str) -> str:
    lines = []
    for raw_line in content.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.rstrip()
        if line.strip() in {"（页面未提供内容）", "(页面未提供内容)"}:
            continue
        lines.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def _content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _relative_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(PROJECT_ROOT.resolve()).as_posix()
    except ValueError:
        return (Path("data/raw/markdown") / path.parent.name / path.name).as_posix()


def _normalise_date(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    candidates = [text, text[:10], text.replace("/", "-").replace(".", "-")]
    formats = ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y%m%d", "%Y-%m-%d %H:%M")
    for candidate in candidates:
        for fmt in formats:
            try:
                return datetime.strptime(candidate, fmt).date().isoformat()
            except ValueError:
                continue
    return ""


def _normalise_tags(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        tag = value.strip()
        if not tag:
            continue
        if tag not in KNOWN_FEATURE_TAGS:
            tag = "其他"
        if tag not in result:
            result.append(tag)
    return result


def _json_array(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if not isinstance(value, str) or not value.strip():
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise RefreshError("CSV 数组字段不是合法 JSON") from exc
    if not isinstance(parsed, list):
        raise RefreshError("CSV 数组字段必须是 JSON 数组")
    return [str(item).strip() for item in parsed if str(item).strip()]


def _read_existing_export(path: Path, *, strict_contract: bool = False) -> list[AppReleaseRow]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = tuple(reader.fieldnames or ())
        if not fieldnames or any(field not in APP_RELEASE_CSV_COLUMNS for field in fieldnames):
            raise RefreshError("现有 App 更新 CSV 字段契约错误")
        if strict_contract and fieldnames != APP_RELEASE_CSV_COLUMNS:
            raise RefreshError("候选 App 更新 CSV 字段名称或顺序错误")
        rows: list[AppReleaseRow] = []
        for raw in reader:
            values = {column: raw.get(column, "") or "" for column in APP_RELEASE_CSV_COLUMNS}
            values["feature_tags"] = _json_array(values["feature_tags"])
            values["highlights"] = _json_array(values["highlights"])
            try:
                rows.append(AppReleaseRow.model_validate(values))
            except Exception as exc:
                raise RefreshError("CSV 行字段类型校验失败") from exc
        return rows


def _row_key(row: AppReleaseRow) -> tuple[str, str, str, str, str, str, str, str]:
    """Identity of one output item; document duplicates are removed before LLM calls."""

    return (
        row.broker_code,
        row.source_url,
        row.content_sha256,
        row.app_name,
        row.app_version,
        row.platform,
        row.publish_date,
        row.update_summary,
    )


def _deduplicate_exact(rows: list[AppReleaseRow]) -> list[AppReleaseRow]:
    """Remove only duplicate outputs for the same source body hash."""

    unique: dict[tuple[str, str, str, str, str, str, str, str], AppReleaseRow] = {}
    for row in rows:
        key = _row_key(row)
        current = unique.get(key)
        if current is None or (row.crawl_time, row.processed_at, row.markdown_file) > (
            current.crawl_time,
            current.processed_at,
            current.markdown_file,
        ):
            unique[key] = row
    return list(unique.values())


def _write_csv(path: Path, rows: list[AppReleaseRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8-sig", newline="", dir=path.parent, delete=False
        ) as handle:
            temp_name = handle.name
            writer = csv.DictWriter(handle, fieldnames=APP_RELEASE_CSV_COLUMNS)
            writer.writeheader()
            for row in rows:
                values = row.model_dump()
                values["feature_tags"] = json.dumps(values["feature_tags"], ensure_ascii=False)
                values["highlights"] = json.dumps(values["highlights"], ensure_ascii=False)
                writer.writerow(values)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
        temp_name = None
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def _source_metadata(source: BrokerSource, metadata: dict[str, str]) -> dict[str, str]:
    return {
        "broker_code": metadata.get("broker_code") or source.broker_code,
        "broker_name": metadata.get("broker_name") or source.broker_name,
        "app_name": metadata.get("app_name") or source.app_name,
        "source_url": metadata.get("source_url") or str(source.source_url),
        "trusted_app_name": source.app_name,
    }


def _deterministic_hints(source: BrokerSource, metadata: dict[str, str], content: str) -> dict[str, str]:
    text = f"{metadata.get('page_update_time', '')}\n{content}"
    version_match = re.search(
        r"(?:版本(?:号)?|version|V)\s*[：:：]?\s*[vV]?([0-9]+(?:\.[0-9]+){1,3})",
        text,
        flags=re.IGNORECASE,
    )
    date_match = re.search(r"(?:更新(?:日期|时间)?|发布日期|发布时间)\s*[：:：]?\s*(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{8})", text)
    platform = ""
    platforms = {item for item in ("iOS", "Android", "HarmonyOS") if item.lower() in text.lower()}
    if len(platforms) > 1:
        platform = "全平台"
    elif platforms:
        platform = next(iter(platforms))
    return {
        "deterministic_app_name": source.app_name,
        "deterministic_version": (
            metadata.get("app_version")
            or metadata.get("version")
            or (version_match.group(1) if version_match else "")
        ).strip(),
        "deterministic_publish_date": (
            _normalise_date(metadata.get("publish_date", ""))
            or (_normalise_date(date_match.group(1)) if date_match else "")
            or _normalise_date(metadata.get("page_update_time", ""))
        ),
        "deterministic_platform": (
            metadata.get("platform", "").strip()
            if metadata.get("platform", "").strip() in KNOWN_PLATFORMS
            else platform
        ),
    }


def _split_units(parser: str, content: str, default_app_name: str) -> list[tuple[str, str]]:
    if parser not in PROCESSABLE_SECTION_PARSERS:
        return [(default_app_name, content)]
    matches = list(re.finditer(r"(?m)^##\s+(.+?)\s*$", content))
    if not matches:
        return [(default_app_name, content)]
    units: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(content)
        heading = match.group(1).strip()
        app_name = heading.split("·", 1)[1].strip() if "·" in heading else heading
        units.append((app_name or default_app_name, content[match.start():end].strip()))
    return units or [(default_app_name, content)]


def _deterministic_summary(content: str) -> str:
    for line in content.splitlines():
        text = re.sub(r"^\s*(?:[-*]\s*|\d+[.)]\s*)", "", line).strip()
        if not text or text.startswith("#") or text.startswith("版本") or text.startswith("更新时间"):
            continue
        return text[:240]
    return ""


def _deterministic_update_fields(content: str) -> tuple[str, list[str], list[str]]:
    text = content.lower()
    if any(word in text for word in ("修复", "解决", "已知问题")):
        update_type = "问题修复"
    elif any(word in text for word in ("新增", "增加", "上线", "支持")):
        update_type = "新功能"
    elif any(word in text for word in ("安全", "合规", "风控")):
        update_type = "合规安全"
    elif any(word in text for word in ("优化", "提升", "改进")):
        update_type = "体验优化"
    else:
        update_type = "其他"
    tag_keywords = {
        "行情": "行情",
        "交易": "交易",
        "开户": "开户",
        "理财": "理财",
        "资讯": "资讯",
        "ai": "AI智能",
        "智能": "AI智能",
        "安全": "安全",
    }
    tags = list(dict.fromkeys(tag for keyword, tag in tag_keywords.items() if keyword in text))
    highlights: list[str] = []
    for line in content.splitlines():
        item = re.sub(r"^\s*(?:[-*]\s*|\d+[.)]\s*)", "", line).strip()
        if item and not item.startswith("#") and not item.startswith(("版本", "更新日期", "更新时间")):
            highlights.append(item[:240])
    return update_type, tags or ["其他"], highlights[:8]


def _as_extraction(value: AppReleaseExtraction | list[AppReleaseAnalysis]) -> AppReleaseExtraction:
    return value if isinstance(value, AppReleaseExtraction) else AppReleaseExtraction(analyses=value)


def _process_document(
    path: Path,
    source: BrokerSource,
    client: AppReleaseLlmClient,
    processed_at: str,
) -> tuple[list[AppReleaseRow], list[ProcessingFailure], int, int]:
    metadata, raw_content = _parse_front_matter(path)
    content = _clean_body(raw_content)
    if not content:
        return [], [ProcessingFailure(_relative_path(path), "正文为空")], 0, 0
    body_hash = _content_hash(content)
    source_values = _source_metadata(source, metadata)
    rows: list[AppReleaseRow] = []
    failures: list[ProcessingFailure] = []
    units = _split_units(metadata.get("parser", ""), content, source_values["app_name"])
    for unit_app_name, unit_content in units:
        hints = _deterministic_hints(source, metadata, unit_content)
        request_metadata = {
            **source_values,
            **hints,
            "unit_app_name": unit_app_name,
        }
        try:
            extraction = _as_extraction(client.extract(metadata=request_metadata, content=unit_content))
        except Exception as exc:  # noqa: BLE001 - isolate one source unit
            failures.append(ProcessingFailure(_relative_path(path), f"LLM 请求失败：{type(exc).__name__}", unit_app_name))
            continue
        failures.extend(
            ProcessingFailure(_relative_path(path), f"LLM 输出项无效：{error}", unit_app_name)
            for error in extraction.errors
        )
        if not extraction.analyses:
            failures.append(ProcessingFailure(_relative_path(path), "LLM 未返回有效记录", unit_app_name))
            continue
        for analysis in extraction.analyses:
            trusted_app_name = unit_app_name or source_values["app_name"]
            app_name = trusted_app_name or analysis.app_name.strip()
            if not app_name:
                failures.append(
                    ProcessingFailure(_relative_path(path), "缺少可确定的 App 名称", unit_app_name)
                )
                continue
            version = hints["deterministic_version"] or analysis.app_version.strip()
            publish_date = hints["deterministic_publish_date"] or _normalise_date(analysis.publish_date)
            model_platform = analysis.platform.strip()
            platform = (
                hints["deterministic_platform"]
                or (model_platform if model_platform in KNOWN_PLATFORMS else "未知")
            )
            deterministic_type, deterministic_tags, deterministic_highlights = _deterministic_update_fields(unit_content)
            update_type = analysis.update_type.strip() if analysis.update_type.strip() in KNOWN_UPDATE_TYPES else "其他"
            if update_type == "其他" and deterministic_type != "其他":
                update_type = deterministic_type
            feature_tags = _normalise_tags(analysis.feature_tags)
            if feature_tags == ["其他"] and deterministic_tags != ["其他"]:
                feature_tags = deterministic_tags
            highlights = [item.strip() for item in analysis.highlights if item.strip()]
            if not highlights:
                highlights = deterministic_highlights
            rows.append(
                AppReleaseRow(
                    broker_code=source_values["broker_code"],
                    broker_name=source_values["broker_name"],
                    app_name=app_name,
                    source_url=source_values["source_url"],
                    content_sha256=body_hash,
                    crawl_time=metadata.get("crawl_time", ""),
                    markdown_file=_relative_path(path),
                    processed_at=processed_at,
                    app_version=version,
                    platform=platform,
                    publish_date=publish_date,
                    update_type=update_type,
                    update_summary=analysis.update_summary.strip() or _deterministic_summary(unit_content),
                    feature_tags=feature_tags,
                    highlights=highlights,
                )
            )
    failed_units = 0
    for unit_app_name in {failure.unit for failure in failures if failure.unit}:
        if not any(row.app_name == unit_app_name for row in rows):
            failed_units += 1
    return rows, failures, len(units), failed_units


def _validate_candidate(rows: list[AppReleaseRow], previous: list[AppReleaseRow]) -> None:
    if not rows:
        raise RefreshError("候选结果为空")
    for row in rows:
        if row.content_sha256 and (
            not row.broker_code or not row.broker_name or not row.app_name or not row.source_url
        ):
            raise RefreshError("候选结果缺少权威来源字段")
        if row.update_type not in KNOWN_UPDATE_TYPES:
            raise RefreshError("候选结果包含非法更新分类")
        if row.platform not in KNOWN_PLATFORMS:
            raise RefreshError("候选结果包含非法平台")
        if row.publish_date and _normalise_date(row.publish_date) != row.publish_date:
            raise RefreshError("候选结果包含非法发布日期")
        if any(tag not in KNOWN_FEATURE_TAGS for tag in row.feature_tags):
            raise RefreshError("候选结果包含非法功能标签")
    if previous and len(rows) < len(previous):
        raise RefreshError("候选结果导致历史记录减少")


def _write_processing_bundle(
    rows: list[AppReleaseRow], failures: list[ProcessingFailure], summary: dict[str, Any]
) -> None:
    _write_json(LLM_DATA_DIR / "candidate_rows.json", [row.model_dump() for row in rows])
    _write_csv(LLM_DATA_DIR / "candidate_app_releases.csv", rows)
    _write_json(LLM_DATA_DIR / "failed_records.json", [asdict(failure) for failure in failures])
    _write_json(LLM_DATA_DIR / "run_summary.json", summary)


def process_existing(
    catalog: BrokerCatalog,
    *,
    client: AppReleaseLlmClient,
    export_path: Path | None = None,
    raw_dir: Path | None = None,
    broker_codes: set[str] | None = None,
) -> RefreshResult:
    """Process existing Markdown without invoking the crawler."""

    target = export_path or EXPORTS_DATA_DIR / "app_releases.csv"
    source_dir = raw_dir or RAW_DATA_DIR / "markdown"
    previous = _read_existing_export(target)
    processed_at = datetime.now(SHANGHAI).isoformat(timespec="seconds")
    all_rows = list(previous)
    failures: list[ProcessingFailure] = []
    documents: dict[tuple[str, str, str], tuple[BrokerSource, Path]] = {}
    attempted = 0
    failed_units = 0
    updated_brokers: set[str] = set()

    for source in catalog.enabled_sources:
        if broker_codes is not None and source.broker_code not in broker_codes:
            continue
        files = sorted((source_dir / source.broker_code).glob("*.md"))
        for path in files:
            try:
                metadata, raw_content = _parse_front_matter(path)
                content = _clean_body(raw_content)
                if not content:
                    failures.append(ProcessingFailure(_relative_path(path), "正文为空"))
                    continue
                body_hash = _content_hash(content)
                source_url = metadata.get("source_url") or str(source.source_url)
                broker_code = metadata.get("broker_code") or source.broker_code
                identity = (broker_code, source_url, body_hash)
                current = documents.get(identity)
                current_time = metadata.get("crawl_time", "")
                if current is None or (current_time, path.name) >= (
                    _parse_front_matter(current[1])[0].get("crawl_time", ""),
                    current[1].name,
                ):
                    documents[identity] = (source, path)
            except Exception as exc:  # noqa: BLE001 - isolate one Markdown document
                failures.append(ProcessingFailure(_relative_path(path), f"处理失败：{type(exc).__name__}"))

    for source, path in documents.values():
        try:
            metadata, raw_content = _parse_front_matter(path)
            content = _clean_body(raw_content)
            body_hash = _content_hash(content)
            rows, unit_failures, unit_count, unit_failed = _process_document(path, source, client, processed_at)
            attempted += unit_count
            failed_units += unit_failed
            failures.extend(unit_failures)
            if rows:
                identity = (rows[0].broker_code, rows[0].source_url, body_hash)
                all_rows = [
                    row
                    for row in all_rows
                    if (row.broker_code, row.source_url, row.content_sha256) != identity
                ]
                all_rows.extend(rows)
                updated_brokers.add(source.broker_code)
        except Exception as exc:  # noqa: BLE001 - isolate one Markdown document
            failures.append(ProcessingFailure(_relative_path(path), f"处理失败：{type(exc).__name__}"))
            attempted += 1
            failed_units += 1

    all_rows = _deduplicate_exact(all_rows)
    failure_rate = failed_units / attempted if attempted else 1.0
    blocked = not all_rows or (attempted > 0 and failure_rate >= FAILURE_RATE_LIMIT)
    summary: dict[str, Any] = {
        "status": "publish_blocked" if blocked else "ready",
        "attempted_units": attempted,
        "failed_units": failed_units,
        "failure_rate": failure_rate,
        "candidate_rows": len(all_rows),
        "failure_count": len(failures),
        "finished_at": processed_at,
    }
    try:
        _validate_candidate(all_rows, previous)
    except RefreshError as exc:
        blocked = True
        summary["integrity_error"] = str(exc)
    summary["status"] = "publish_blocked" if blocked else "ready"
    _write_processing_bundle(all_rows, failures, summary)
    try:
        roundtrip_rows = _read_existing_export(
            LLM_DATA_DIR / "candidate_app_releases.csv", strict_contract=True
        )
        if len(roundtrip_rows) != len(all_rows):
            blocked = True
            summary["integrity_error"] = "候选 CSV 写入后重新读取行数不一致"
            summary["status"] = "publish_blocked"
            _write_json(LLM_DATA_DIR / "run_summary.json", summary)
    except RefreshError as exc:
        blocked = True
        summary["integrity_error"] = str(exc)
        summary["status"] = "publish_blocked"
        _write_json(LLM_DATA_DIR / "run_summary.json", summary)
    if blocked:
        if not previous:
            raise RefreshError("没有可用旧版 CSV，且本次处理未通过发布检查")
        return RefreshResult(
            exported_rows=len(previous),
            updated_brokers=tuple(sorted(updated_brokers)),
            preserved_brokers=tuple(sorted({row.broker_code for row in previous})),
            failures={failure.path: failure.reason for failure in failures},
            blocked=True,
            failure_rate=failure_rate,
        )
    _write_csv(target, all_rows)
    return RefreshResult(
        exported_rows=len(all_rows),
        updated_brokers=tuple(sorted(updated_brokers)),
        preserved_brokers=tuple(
            sorted({row.broker_code for row in previous} - updated_brokers)
        ),
        failures={failure.path: failure.reason for failure in failures},
        blocked=False,
        failure_rate=failure_rate,
    )


def refresh_all(
    catalog: BrokerCatalog,
    *,
    client: AppReleaseLlmClient,
    export_path: Path | None = None,
    raw_dir: Path | None = None,
    crawl_runner: Callable[[BrokerCatalog], CrawlSummary] = crawl_all,
) -> RefreshResult:
    """Crawl all enabled sources, then process and safely publish history."""

    crawl_summary = crawl_runner(catalog)
    result = process_existing(
        catalog,
        client=client,
        export_path=export_path,
        raw_dir=raw_dir,
        broker_codes=set(crawl_summary.success),
    )
    crawl_failures = dict(crawl_summary.failures)
    crawl_failures.update(result.failures)
    return RefreshResult(
        exported_rows=result.exported_rows,
        updated_brokers=result.updated_brokers,
        preserved_brokers=result.preserved_brokers,
        failures=crawl_failures,
        blocked=result.blocked,
        failure_rate=result.failure_rate,
    )
