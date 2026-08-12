"""Validation and persistence for imported dashboard-data ZIP packages.

The regular dashboard builder reads the live CSV/JSON sources.  Imported
packages are deliberately kept as one validated ZIP so a failed import cannot
leave a partially replaced directory on Windows.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import stat
import threading
import zipfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import settings
from .dashboard_package import (
    PACKAGE_FILES,
    REQUIRED_KEYS,
    READER_VERSION,
    SCHEMA_VERSION,
    DashboardPackage,
    PackageArtifact,
)
from .matching_baseline import BASELINE_FILENAME, csv_bytes, validate_matching_baseline


# The current tender payload is about 12 MB uncompressed.  Leave generous room
# for normal growth while still bounding memory and decompression-bomb risk.
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
MAX_MEMBER_UNCOMPRESSED_BYTES = 48 * 1024 * 1024
MAX_COMPRESSION_RATIO = 250.0
LEGACY_MEMBER_COUNT = 1 + len(REQUIRED_KEYS)
BASELINE_MEMBER_COUNT = LEGACY_MEMBER_COUNT + 1
PREFERENCE_VALUES = frozenset({"live", "imported"})


class DashboardPackageImportError(ValueError):
    """A ZIP package is not a safe, supported dashboard-data package."""


@dataclass(frozen=True, slots=True)
class ValidatedImport:
    package: DashboardPackage
    body: bytes
    warnings: tuple[str, ...] = ()
    matching_baseline: dict[str, Any] | None = None


def imported_package_path() -> Path:
    return settings.dashboard_data_imported_zip_path


def imported_backup_path() -> Path:
    path = imported_package_path()
    return path.with_name(f"{path.name}.bak")


def preference_path() -> Path:
    return settings.dashboard_data_source_preference_path


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def _json_object(body: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DashboardPackageImportError(f"{label} 不是有效 UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise DashboardPackageImportError(f"{label} 必须是 JSON 对象")
    return value


def _require_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DashboardPackageImportError(f"{label} 必须是非空字符串")
    return value.strip()


def _require_bool(value: object, label: str) -> bool:
    if not isinstance(value, bool):
        raise DashboardPackageImportError(f"{label} 必须是布尔值")
    return value


def _require_int(value: object, label: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise DashboardPackageImportError(f"{label} 必须是大于等于 {minimum} 的整数")
    return value


def _major_version(value: str, label: str) -> int:
    try:
        major = int(value.split(".", 1)[0])
    except (AttributeError, ValueError):
        raise DashboardPackageImportError(f"{label} 版本号无效") from None
    if major < 1:
        raise DashboardPackageImportError(f"{label} 版本号不受支持")
    return major


def _validate_period(value: object, label: str) -> dict[str, str | None] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"from", "to"}:
        raise DashboardPackageImportError(f"{label} period 结构无效")
    result: dict[str, str | None] = {}
    for key in ("from", "to"):
        item = value[key]
        if item is not None and not isinstance(item, str):
            raise DashboardPackageImportError(f"{label} period.{key} 必须是字符串或 null")
        result[key] = item
    return result


def _validate_row_list(value: object, label: str, required_keys: set[str]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise DashboardPackageImportError(f"{label} 必须是 JSON 数组")
    rows: list[dict[str, Any]] = []
    for index, row in enumerate(value):
        if not isinstance(row, dict) or not required_keys.issubset(row):
            raise DashboardPackageImportError(f"{label}[{index}] 字段结构无效")
        rows.append(row)
    return rows


def _validate_package_payload(
    manifest_body: bytes,
    bodies: dict[str, bytes],
) -> tuple[DashboardPackage, tuple[str, ...]]:
    manifest = _json_object(manifest_body, "manifest.json")
    legacy_manifest_keys = {
        "schema_version",
        "minimum_reader_version",
        "package_version",
        "generated_at",
        "source",
        "timezone",
        "datasets",
    }
    current_manifest_keys = {*legacy_manifest_keys, "matching_baseline"}
    if set(manifest) not in {frozenset(legacy_manifest_keys), frozenset(current_manifest_keys)}:
        raise DashboardPackageImportError("manifest.json 字段结构无效")
    schema_version = _require_text(manifest.get("schema_version"), "manifest.schema_version")
    reader_version = _require_text(manifest.get("minimum_reader_version"), "manifest.minimum_reader_version")
    if _major_version(schema_version, "manifest.schema_version") != _major_version(SCHEMA_VERSION, "schema"):
        raise DashboardPackageImportError("dashboard-data schema 版本不兼容")
    if _major_version(reader_version, "manifest.minimum_reader_version") > _major_version(READER_VERSION, "reader"):
        raise DashboardPackageImportError("dashboard-data 需要更新的阅读器版本")
    _require_text(manifest.get("package_version"), "manifest.package_version")
    _require_text(manifest.get("generated_at"), "manifest.generated_at")
    if _require_text(manifest.get("source"), "manifest.source") != "世纪证券业务信息平台标准化导出":
        raise DashboardPackageImportError("manifest.source 不受支持")
    _require_text(manifest.get("timezone"), "manifest.timezone")

    datasets = manifest.get("datasets")
    if not isinstance(datasets, dict) or set(datasets) != set(REQUIRED_KEYS):
        raise DashboardPackageImportError("manifest.datasets 必须精确包含五个标准数据集")

    artifacts: dict[str, PackageArtifact] = {}
    for key in REQUIRED_KEYS:
        metadata = datasets[key]
        if not isinstance(metadata, dict):
            raise DashboardPackageImportError(f"manifest.datasets.{key} 结构无效")
        expected_keys = {"file", "record_count", "bytes", "sha256", "available", "reason", "period"}
        if set(metadata) != expected_keys:
            raise DashboardPackageImportError(f"manifest.datasets.{key} 字段结构无效")
        filename = _require_text(metadata.get("file"), f"manifest.datasets.{key}.file")
        if filename != PACKAGE_FILES[key]:
            raise DashboardPackageImportError(f"manifest.datasets.{key}.file 不符合固定文件名")
        record_count = metadata.get("record_count")
        if record_count is not None:
            _require_int(record_count, f"manifest.datasets.{key}.record_count")
        byte_count = _require_int(metadata.get("bytes"), f"manifest.datasets.{key}.bytes")
        digest = _require_text(metadata.get("sha256"), f"manifest.datasets.{key}.sha256")
        if len(digest) != 64 or any(char not in "0123456789abcdefABCDEF" for char in digest):
            raise DashboardPackageImportError(f"manifest.datasets.{key}.sha256 无效")
        available = _require_bool(metadata.get("available"), f"manifest.datasets.{key}.available")
        reason = metadata.get("reason")
        if reason is not None and not isinstance(reason, str):
            raise DashboardPackageImportError(f"manifest.datasets.{key}.reason 必须是字符串或 null")
        period = _validate_period(metadata.get("period"), f"manifest.datasets.{key}")
        body = bodies[key]
        if len(body) != byte_count or hashlib.sha256(body).hexdigest().lower() != digest.lower():
            raise DashboardPackageImportError(f"{filename} 与 manifest 校验值不一致")
        if key in {"tender_projects", "app_updates"} and record_count is None:
            raise DashboardPackageImportError(f"manifest.datasets.{key}.record_count 不能为空")
        artifacts[key] = PackageArtifact(key, filename, body, record_count, period, available, reason)

    overview = _json_object(bodies["overview"], "overview.json")
    filters = _json_object(bodies["filters"], "filters.json")
    ai_analysis = _json_object(bodies["ai_analysis"], "ai_analysis.json")
    try:
        tender_payload = json.loads(bodies["tender_projects"].decode("utf-8"))
        app_payload = json.loads(bodies["app_updates"].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DashboardPackageImportError("招采或 App 数据 JSON 无法解析") from exc
    tenders = _validate_row_list(tender_payload, "tender_projects", {
            "id", "broker_name", "is_broker_project", "publish_date", "publish_timestamp",
            "announcement_stage", "project_name", "normalized_project_name", "procurement_method",
            "budget_amount_yuan", "winning_amount_yuan", "display_amount_yuan", "display_amount_kind",
            "supplier_name", "source_name", "processed_at", "project_key", "amount_sample_key",
            "primary_domain", "topic_tags", "is_fintech", "search_text", "priority_score", "priority_reason",
        })
    app_updates = _validate_row_list(app_payload, "app_updates", {
            "id", "broker_code", "broker_name", "app_name", "source_url", "content_sha256", "crawl_time",
            "app_version", "platform", "publish_date", "publish_timestamp", "update_type", "update_summary",
            "feature_tags", "highlights", "processed_at", "search_text",
        })
    if datasets["tender_projects"]["record_count"] != len(tenders):
        raise DashboardPackageImportError("manifest.datasets.tender_projects.record_count 不一致")
    if datasets["app_updates"]["record_count"] != len(app_updates):
        raise DashboardPackageImportError("manifest.datasets.app_updates.record_count 不一致")
    for key in ("tender_projects", "app_updates"):
        if datasets[key]["available"] is not True or datasets[key]["record_count"] <= 0:
            raise DashboardPackageImportError(f"manifest.datasets.{key} 必须包含可用且非空数据")
    if set(overview) != {"schema_version", "generated_at", "tender_projects", "app_updates"}:
        raise DashboardPackageImportError("overview.json 字段结构无效")
    if overview.get("schema_version") != schema_version or not isinstance(overview.get("generated_at"), str) or not overview.get("generated_at"):
        raise DashboardPackageImportError("overview.json 版本或生成时间无效")
    section_keys = {
        "tender_projects": {"record_count", "broker_count", "fintech_count", "period"},
        "app_updates": {"record_count", "broker_count", "app_count", "period"},
    }
    for section in ("tender_projects", "app_updates"):
        if not isinstance(overview[section], dict) or set(overview[section]) != section_keys[section]:
            raise DashboardPackageImportError(f"overview.json.{section} 结构无效")
        _require_int(overview[section]["record_count"], f"overview.json.{section}.record_count")
        _require_int(overview[section]["broker_count"], f"overview.json.{section}.broker_count")
        count_key = "fintech_count" if section == "tender_projects" else "app_count"
        _require_int(overview[section][count_key], f"overview.json.{section}.{count_key}")
        if overview[section]["record_count"] != len(tenders if section == "tender_projects" else app_updates):
            raise DashboardPackageImportError(f"overview.json.{section}.record_count 不一致")
        _validate_period(overview[section]["period"], f"overview.json.{section}")
    if set(filters) != {"schema_version", "procurement", "app_updates"} or filters.get("schema_version") != schema_version:
        raise DashboardPackageImportError("filters.json 字段结构无效")
    if not isinstance(filters["procurement"], dict) or not isinstance(filters["app_updates"], dict):
        raise DashboardPackageImportError("filters.json 分区结构无效")
    if set(filters["procurement"]) != {"brokers", "domains", "stages", "procurement_methods", "default_time_range", "default_fintech_only"}:
        raise DashboardPackageImportError("filters.json.procurement 结构无效")
    if set(filters["app_updates"]) != {"brokers", "apps", "update_types", "feature_tags"}:
        raise DashboardPackageImportError("filters.json.app_updates 结构无效")
    for section_name, section in (("procurement", filters["procurement"]), ("app_updates", filters["app_updates"])):
        for key in section:
            if key == "default_time_range":
                if section[key] not in {"30d", "90d", "year", "all"}:
                    raise DashboardPackageImportError("filters.json.default_time_range 无效")
            elif key == "default_fintech_only":
                _require_bool(section[key], "filters.json.default_fintech_only")
            elif not isinstance(section[key], list) or not all(isinstance(item, str) for item in section[key]):
                raise DashboardPackageImportError(f"filters.json.{section_name}.{key} 必须是字符串数组")
    if set(ai_analysis) != {"content", "updated_at", "meta"}:
        raise DashboardPackageImportError("ai_analysis.json 字段结构无效")
    if ai_analysis["content"] is not None and not isinstance(ai_analysis["content"], str):
        raise DashboardPackageImportError("ai_analysis.json.content 必须是字符串或 null")
    if ai_analysis["updated_at"] is not None and not isinstance(ai_analysis["updated_at"], str):
        raise DashboardPackageImportError("ai_analysis.json.updated_at 必须是字符串或 null")
    if ai_analysis["meta"] is not None and not isinstance(ai_analysis["meta"], dict):
        raise DashboardPackageImportError("ai_analysis.json.meta 必须是对象或 null")

    warnings: list[str] = []
    ids = [str(row.get("id") or "") for row in tenders]
    duplicate_ids = sorted(item for item, count in Counter(ids).items() if item and count > 1)
    if duplicate_ids:
        warnings.append("旧版 1.x dashboard-data 包含重复 tender id，已保留并标记警告")
    return DashboardPackage(manifest, artifacts, manifest_body=manifest_body), tuple(warnings)


def _package_timestamp(package: DashboardPackage) -> datetime | None:
    value = package.manifest.get("generated_at")
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def compare_import_warnings(candidate: DashboardPackage, active: DashboardPackage | None) -> tuple[str, ...]:
    """Return non-blocking warnings when an import is older or smaller."""
    if active is None:
        return ()
    warnings: list[str] = []
    candidate_time = _package_timestamp(candidate)
    active_time = _package_timestamp(active)
    if candidate_time is not None and active_time is not None and candidate_time < active_time:
        warnings.append("导入包 generated_at 早于当前活动包")
    candidate_datasets = candidate.manifest.get("datasets")
    active_datasets = active.manifest.get("datasets")
    if isinstance(candidate_datasets, dict) and isinstance(active_datasets, dict):
        for key, label in (("tender_projects", "tender_projects"), ("app_updates", "app_updates")):
            candidate_count = candidate_datasets.get(key, {}).get("record_count") if isinstance(candidate_datasets.get(key), dict) else None
            active_count = active_datasets.get(key, {}).get("record_count") if isinstance(active_datasets.get(key), dict) else None
            if isinstance(candidate_count, int) and isinstance(active_count, int) and candidate_count < active_count:
                warnings.append(f"导入包 {label} record_count 少于当前活动包")
    return tuple(warnings)


def validate_zip_bytes(body: bytes) -> ValidatedImport:
    if not isinstance(body, bytes) or not body:
        raise DashboardPackageImportError("导入 ZIP 不能为空")
    if len(body) > MAX_ARCHIVE_BYTES:
        raise DashboardPackageImportError("导入 ZIP 超过大小限制")
    try:
        archive = zipfile.ZipFile(io.BytesIO(body))
    except (OSError, zipfile.BadZipFile) as exc:
        raise DashboardPackageImportError("导入文件不是有效 ZIP") from exc
    with archive:
        infos = archive.infolist()
        if len(infos) not in {LEGACY_MEMBER_COUNT, BASELINE_MEMBER_COUNT}:
            raise DashboardPackageImportError("ZIP 成员数量不符合标准数据包结构")
        expected_names = {"dashboard-data/manifest.json", *(f"dashboard-data/{name}" for name in PACKAGE_FILES.values())}
        baseline_name = f"dashboard-data/{BASELINE_FILENAME}"
        if len(infos) == BASELINE_MEMBER_COUNT:
            expected_names.add(baseline_name)
        names = [info.filename for info in infos]
        if len(set(names)) != len(names) or set(names) != expected_names:
            raise DashboardPackageImportError("ZIP 成员必须精确匹配 dashboard-data 标准文件结构")
        total_size = 0
        bodies: dict[str, bytes] = {}
        for info in infos:
            name = info.filename
            if "\\" in name or name.startswith("/") or ".." in Path(name).parts or info.is_dir():
                raise DashboardPackageImportError("ZIP 包含不安全路径")
            mode = (info.external_attr >> 16) & 0xFFFF
            if stat.S_IFMT(mode) == stat.S_IFLNK:
                raise DashboardPackageImportError("ZIP 不允许包含符号链接")
            if info.flag_bits & 0x1:
                raise DashboardPackageImportError("ZIP 加密成员不受支持")
            if info.file_size > MAX_MEMBER_UNCOMPRESSED_BYTES:
                raise DashboardPackageImportError("ZIP 成员超过大小限制")
            if info.compress_size == 0 and info.file_size:
                raise DashboardPackageImportError("ZIP 成员压缩比异常")
            if info.compress_size and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                raise DashboardPackageImportError("ZIP 成员压缩比超过安全限制")
            total_size += info.file_size
            if total_size > MAX_TOTAL_UNCOMPRESSED_BYTES:
                raise DashboardPackageImportError("ZIP 解压总大小超过限制")
            try:
                data = archive.read(info)
            except (OSError, RuntimeError, zipfile.BadZipFile) as exc:
                raise DashboardPackageImportError("ZIP 成员读取失败") from exc
            if len(data) != info.file_size:
                raise DashboardPackageImportError("ZIP 成员大小校验失败")
            if name == "dashboard-data/manifest.json":
                bodies["manifest"] = data
            elif name == baseline_name:
                bodies["matching_baseline"] = data
            else:
                key = next((item for item, filename in PACKAGE_FILES.items() if filename == name.rsplit("/", 1)[-1]), None)
                if key is None:
                    raise DashboardPackageImportError("ZIP 成员名称无效")
                bodies[key] = data
    manifest_body = bodies.pop("manifest")
    baseline_body = bodies.pop("matching_baseline", None)
    package, warnings = _validate_package_payload(manifest_body, bodies)
    metadata = package.manifest.get("matching_baseline")
    baseline: dict[str, Any] | None = None
    warning_list = list(warnings)
    if baseline_body is None:
        if metadata is not None and metadata.get("available") is True:
            raise DashboardPackageImportError("数据包缺少 matching_baseline.json")
        if metadata is None:
            warning_list.append("旧版数据包不包含增量匹配基线，仅可用于看板展示")
    else:
        if not isinstance(metadata, dict) or set(metadata) != {"file", "bytes", "sha256", "available"}:
            raise DashboardPackageImportError("manifest.matching_baseline 结构无效")
        if metadata.get("file") != BASELINE_FILENAME or metadata.get("available") is not True:
            raise DashboardPackageImportError("manifest.matching_baseline 元数据无效")
        if metadata.get("bytes") != len(baseline_body) or metadata.get("sha256") != hashlib.sha256(baseline_body).hexdigest():
            raise DashboardPackageImportError("matching_baseline.json 与 manifest 校验值不一致")
        try:
            decoded = json.loads(baseline_body.decode("utf-8"))
            baseline = validate_matching_baseline(decoded)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            raise DashboardPackageImportError(str(exc)) from exc
        package = DashboardPackage(
            package.manifest,
            package.artifacts,
            manifest_body=package.manifest_body,
            matching_baseline_body=baseline_body,
        )
    return ValidatedImport(package, body, tuple(warning_list), baseline)


def _atomic_write(path: Path, body: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("wb") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _matching_baseline_targets(payload: dict[str, Any]) -> dict[Path, bytes]:
    return {
        settings.matching_procurement_csv_path: csv_bytes(payload["procurement_rows"]),
        settings.matching_result_csv_path: csv_bytes(payload["result_rows"]),
        settings.matching_verified_links_path: csv_bytes(payload["verified_links"]),
        settings.matching_state_path: _json_bytes(payload["matching_state"]),
        settings.imported_matching_baseline_path: _json_bytes(payload),
    }


def _rollback_files(previous: dict[Path, bytes | None]) -> None:
    for path, content in previous.items():
        if content is None:
            path.unlink(missing_ok=True)
        else:
            _atomic_write(path, content)


def _restore_matching_baseline(payload: dict[str, Any]) -> dict[Path, bytes | None]:
    targets = _matching_baseline_targets(payload)
    previous = {path: path.read_bytes() if path.is_file() else None for path in targets}
    try:
        for path, content in targets.items():
            _atomic_write(path, content)
    except Exception:
        _rollback_files(previous)
        raise
    return previous


def read_preference() -> tuple[str, str | None]:
    path = preference_path()
    if not path.exists():
        return "live", None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return "live", "偏好配置无法解析，已回退 live"
    value = payload.get("preferred_source") if isinstance(payload, dict) else None
    if value not in PREFERENCE_VALUES:
        return "live", "偏好配置无效，已回退 live"
    return str(value), None


def write_preference(preferred_source: str) -> None:
    if preferred_source not in PREFERENCE_VALUES:
        raise DashboardPackageImportError("preferred_source 只能是 live 或 imported")
    _atomic_write(preference_path(), _json_bytes({"preferred_source": preferred_source}))


def persist_imported(body: bytes) -> ValidatedImport:
    validated = validate_zip_bytes(body)
    target = imported_package_path()
    backup = imported_backup_path()
    old_body: bytes | None = None
    baseline_previous: dict[Path, bytes | None] | None = None
    if target.exists():
        old_body = target.read_bytes()
        _atomic_write(backup, old_body)
    try:
        if validated.matching_baseline is not None:
            baseline_previous = _restore_matching_baseline(validated.matching_baseline)
        _atomic_write(target, body)
        write_preference("imported")
    except Exception:
        if baseline_previous is not None:
            _rollback_files(baseline_previous)
        if old_body is not None:
            _atomic_write(target, old_body)
        else:
            target.unlink(missing_ok=True)
        raise
    return validated


class ImportedPackageStore:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._fingerprint: tuple[str, int, int] | None = None
        self._package: DashboardPackage | None = None
        self._error: str | None = None
        self._warnings: tuple[str, ...] = ()

    def inspect(self) -> tuple[DashboardPackage | None, str | None, tuple[str, ...]]:
        path = imported_package_path()
        with self._lock:
            try:
                stat_result = path.stat()
            except OSError:
                self._fingerprint = None
                self._package = None
                self._error = "暂无已导入数据包"
                self._warnings = ()
                return None, self._error, self._warnings
            fingerprint = (str(path.resolve()), stat_result.st_mtime_ns, stat_result.st_size)
            if self._fingerprint == fingerprint:
                return self._package, self._error, self._warnings
            try:
                validated = validate_zip_bytes(path.read_bytes())
            except (OSError, DashboardPackageImportError) as exc:
                self._package = None
                self._error = str(exc)
                self._warnings = ()
            else:
                self._package = validated.package
                self._error = None
                self._warnings = validated.warnings
            self._fingerprint = fingerprint
            return self._package, self._error, self._warnings

    def invalidate(self) -> None:
        with self._lock:
            self._fingerprint = None


imported_package_store = ImportedPackageStore()


def _is_complete(package: DashboardPackage | None) -> bool:
    if package is None:
        return False
    datasets = package.manifest.get("datasets")
    if not isinstance(datasets, dict):
        return False
    for key in ("tender_projects", "app_updates"):
        metadata = datasets.get(key)
        if not isinstance(metadata, dict) or metadata.get("available") is not True:
            return False
        count = metadata.get("record_count")
        if not isinstance(count, int) or isinstance(count, bool) or count <= 0:
            return False
    return True


def source_status(live_package: DashboardPackage | None) -> dict[str, Any]:
    preferred, preference_reason = read_preference()
    imported, imported_error, imported_warnings = imported_package_store.inspect()
    live_available = _is_complete(live_package)
    imported_available = _is_complete(imported)
    live_reason = None if live_available else "live 招采或 App 数据不可用"
    imported_reason = None if imported_available else (imported_error or "imported 招采或 App 数据不可用")
    active = preferred if (preferred == "live" and live_available) or (preferred == "imported" and imported_available) else (
        "imported" if imported_available else "live" if live_available else None
    )
    fallback_reason = preference_reason
    if preferred == "imported" and not imported_available and live_available:
        fallback_reason = f"{imported_reason or 'imported 数据不可用'}，已回退 live"
    elif preferred == "live" and not live_available and imported_available:
        fallback_reason = f"{live_reason or 'live 数据不可用'}，已回退 imported"
    return {
        "preferred_source": preferred,
        "active_source": active,
        "fallback_reason": fallback_reason,
        "sources": {
            "live": {"available": live_available, "reason": live_reason, "manifest": live_package.manifest if live_package else None},
            "imported": {
                "available": imported_available,
                "reason": imported_reason,
                "manifest": imported.manifest if imported is not None else None,
                "warnings": list(imported_warnings),
            },
        },
    }


def resolve_active_package(live_package: DashboardPackage | None) -> tuple[DashboardPackage | None, dict[str, Any]]:
    status = source_status(live_package)
    if status["active_source"] == "imported":
        imported, error, _ = imported_package_store.inspect()
        if imported is not None and error is None and _is_complete(imported):
            return imported, status
        return None, status
    if status["active_source"] == "live" and _is_complete(live_package):
        return live_package, status
    return None, status
