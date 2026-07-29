"""End-to-end App Watch refresh and CSV export pipeline."""

import csv
import json
import logging
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable
from zoneinfo import ZoneInfo

import yaml

from broker_app_watch.core.config import BrokerCatalog, BrokerSource
from broker_app_watch.core.paths import EXPORTS_DATA_DIR, PROJECT_ROOT, RAW_DATA_DIR
from broker_app_watch.llm.client import AppReleaseLlmClient
from broker_app_watch.pipeline.crawl import CrawlSummary, crawl_all
from broker_app_watch.storage.models import APP_RELEASE_CSV_COLUMNS, AppReleaseRow


LOGGER = logging.getLogger(__name__)
SHANGHAI = ZoneInfo("Asia/Shanghai")
KNOWN_UPDATE_TYPES = {"新功能", "体验优化", "问题修复", "合规安全", "其他"}
KNOWN_FEATURE_TAGS = {"行情", "交易", "开户", "理财", "资讯", "AI智能", "安全", "其他"}


class RefreshError(RuntimeError):
    """Raised when a refresh cannot produce a safe export."""


@dataclass(frozen=True, slots=True)
class RefreshResult:
    exported_rows: int
    updated_brokers: tuple[str, ...]
    preserved_brokers: tuple[str, ...]
    failures: dict[str, str]


def _parse_front_matter(path: Path) -> tuple[dict[str, str], str]:
    raw = path.read_text(encoding="utf-8")
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


def _relative_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(PROJECT_ROOT.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _normalise_date(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    candidates = [text, text[:10]]
    formats = ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y-%m-%d %H:%M:%S")
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
    except json.JSONDecodeError:
        return [value.strip()]
    return [str(item).strip() for item in parsed] if isinstance(parsed, list) else []


def _read_existing_export(path: Path) -> list[AppReleaseRow]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise RefreshError("现有 App 更新 CSV 缺少表头")
        rows: list[AppReleaseRow] = []
        for raw in reader:
            values = {column: raw.get(column, "") or "" for column in APP_RELEASE_CSV_COLUMNS}
            values["feature_tags"] = _json_array(values["feature_tags"])
            values["highlights"] = _json_array(values["highlights"])
            rows.append(AppReleaseRow.model_validate(values))
        return rows


def _row_key(row: AppReleaseRow) -> tuple[str, str, str, str, str, str]:
    return (
        row.broker_code,
        row.app_name,
        row.app_version,
        row.platform,
        row.publish_date,
        row.update_summary,
    )


def _deduplicate(rows: list[AppReleaseRow]) -> list[AppReleaseRow]:
    unique: dict[tuple[str, str, str, str, str, str], AppReleaseRow] = {}
    for row in rows:
        unique[_row_key(row)] = row
    return list(unique.values())


def _write_export(path: Path, rows: list[AppReleaseRow]) -> None:
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
            try:
                Path(temp_name).unlink(missing_ok=True)
            except OSError:
                LOGGER.warning("清理临时 App 更新 CSV 失败")


def _source_metadata(source: BrokerSource, metadata: dict[str, str]) -> dict[str, str]:
    return {
        "broker_code": metadata.get("broker_code") or source.broker_code,
        "broker_name": metadata.get("broker_name") or source.broker_name,
        "app_name": metadata.get("app_name") or source.app_name,
        "source_url": metadata.get("source_url") or str(source.source_url),
    }


def _process_document(
    path: Path,
    source: BrokerSource,
    client: AppReleaseLlmClient,
    processed_at: str,
) -> list[AppReleaseRow]:
    metadata, content = _parse_front_matter(path)
    source_values = _source_metadata(source, metadata)
    analyses = client.extract(metadata=source_values, content=content)
    result: list[AppReleaseRow] = []
    for analysis in analyses:
        update_type = analysis.update_type.strip()
        if update_type not in KNOWN_UPDATE_TYPES:
            update_type = "其他"
        result.append(
            AppReleaseRow(
                **source_values,
                content_sha256=metadata.get("content_sha256", ""),
                crawl_time=metadata.get("crawl_time", ""),
                markdown_file=_relative_path(path),
                processed_at=processed_at,
                app_version=analysis.app_version.strip(),
                platform=analysis.platform.strip() or "未知",
                publish_date=_normalise_date(analysis.publish_date),
                update_type=update_type,
                update_summary=analysis.update_summary.strip(),
                feature_tags=_normalise_tags(analysis.feature_tags),
                highlights=[item.strip() for item in analysis.highlights if item.strip()],
            )
        )
    return result


def refresh_all(
    catalog: BrokerCatalog,
    *,
    client: AppReleaseLlmClient,
    export_path: Path | None = None,
    raw_dir: Path | None = None,
    crawl_runner: Callable[[BrokerCatalog], CrawlSummary] = crawl_all,
) -> RefreshResult:
    """Crawl, structure and atomically export App updates.

    A broker is replaced only after all of its Markdown documents succeed. If
    a broker fails, its previous CSV rows are retained.
    """

    target = export_path or EXPORTS_DATA_DIR / "app_releases.csv"
    source_dir = raw_dir or RAW_DATA_DIR / "markdown"
    previous = _read_existing_export(target)
    previous_by_broker: dict[str, list[AppReleaseRow]] = {}
    for row in previous:
        previous_by_broker.setdefault(row.broker_code, []).append(row)

    crawl_summary = crawl_runner(catalog)
    failures = dict(crawl_summary.failures)
    processed_at = datetime.now(SHANGHAI).isoformat(timespec="seconds")
    updated: dict[str, list[AppReleaseRow]] = {}
    updated_brokers: list[str] = []

    for source in catalog.enabled_sources:
        code = source.broker_code
        if code not in crawl_summary.success:
            continue
        files = sorted((source_dir / code).glob("*.md"))
        if not files:
            failures[code] = "没有可处理的 Markdown 输出"
            continue
        try:
            rows: list[AppReleaseRow] = []
            for path in files:
                rows.extend(_process_document(path, source, client, processed_at))
            updated[code] = _deduplicate(rows)
            updated_brokers.append(code)
        except Exception as exc:  # noqa: BLE001 - isolate one broker
            failures[code] = f"结构化失败：{type(exc).__name__}"
            LOGGER.error("处理 %s 失败：%s", code, type(exc).__name__)

    if not updated_brokers:
        raise RefreshError("没有任何券商成功完成 App 更新刷新")

    final_rows: list[AppReleaseRow] = []
    preserved_brokers: list[str] = []
    all_brokers = set(previous_by_broker) | {source.broker_code for source in catalog.brokers}
    for broker_code in sorted(all_brokers):
        if broker_code in updated:
            final_rows.extend(updated[broker_code])
        else:
            retained = previous_by_broker.get(broker_code, [])
            final_rows.extend(retained)
            if retained and broker_code in failures:
                preserved_brokers.append(broker_code)

    final_rows = _deduplicate(final_rows)
    if not final_rows and not previous:
        raise RefreshError("LLM 没有生成任何可导出的 App 更新记录")
    _write_export(target, final_rows)
    return RefreshResult(
        exported_rows=len(final_rows),
        updated_brokers=tuple(updated_brokers),
        preserved_brokers=tuple(sorted(preserved_brokers)),
        failures=failures,
    )
