from __future__ import annotations

import json
import os
import shutil
import tempfile
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from .collectors.base import write_json_atomic
from .config import BrokerSourceConfig
from .source_reader import SourceDocument, read_documents


SOURCE_PRIORITY = ("official", "cfcpn", "external")


@dataclass
class SelectionResult:
    selected_count: int
    deduplicated_count: int
    invalid_count: int
    broker_sources: dict[str, str]
    source_counts: dict[str, int]
    output_root: str


def load_manifest(path: Path) -> dict[str, object] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _latest_official_documents(
    project_root: Path,
    official_root: Path,
    configs: dict[str, BrokerSourceConfig],
) -> tuple[list[SourceDocument], set[str]]:
    documents: list[SourceDocument] = []
    passed: set[str] = set()
    for key, config in configs.items():
        manifest = load_manifest(official_root / "manifests" / f"{key}.json")
        if not manifest or manifest.get("quality_passed") is not True:
            continue
        output_value = str(manifest.get("output_dir") or "")
        output_dir = Path(output_value)
        if not output_dir.is_absolute():
            output_dir = project_root / output_dir
        broker_documents = read_documents(
            output_dir,
            "official",
            {key: config},
            min_content_chars=config.min_content_chars,
        )
        if broker_documents:
            documents.extend(broker_documents)
            passed.add(key)
    return documents, passed


def select_documents(
    official: list[SourceDocument],
    cfcpn: list[SourceDocument],
    external: list[SourceDocument],
    configs: dict[str, BrokerSourceConfig],
    official_passed: set[str],
) -> tuple[list[SourceDocument], dict[str, str], int]:
    by_source = {"official": official, "cfcpn": cfcpn, "external": external}
    selected: list[SourceDocument] = []
    broker_sources: dict[str, str] = {}
    handled_paths: set[Path] = set()

    for broker_key in configs:
        config = configs[broker_key]

        def is_effective(document: SourceDocument) -> bool:
            return (
                document.valid
                and document.content_chars >= config.min_content_chars
            )

        chosen_kind = ""
        if broker_key in official_passed:
            chosen_kind = "official"
        else:
            for kind in ("cfcpn", "external"):
                if any(
                    doc.broker_key == broker_key and is_effective(doc)
                    for doc in by_source[kind]
                ):
                    chosen_kind = kind
                    break
        if chosen_kind:
            chosen = [
                doc
                for doc in by_source[chosen_kind]
                if doc.broker_key == broker_key and is_effective(doc)
            ]
            selected.extend(chosen)
            handled_paths.update(doc.path for kind in SOURCE_PRIORITY for doc in by_source[kind] if doc.broker_key == broker_key)
            broker_sources[broker_key] = chosen_kind

    # Sources for brokers without a configured direct collector remain available.
    # CFCPN wins over an external document only when both identify the same
    # broker; unknown documents are retained and deduplicated below.
    unconfigured: dict[str, dict[str, list[SourceDocument]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for kind in ("cfcpn", "external"):
        for document in by_source[kind]:
            if document.path in handled_paths or not document.valid:
                continue
            unconfigured[document.broker_key][kind].append(document)
    for broker_key, grouped in unconfigured.items():
        if broker_key and grouped["cfcpn"]:
            selected.extend(grouped["cfcpn"])
        else:
            selected.extend(grouped["cfcpn"])
            selected.extend(grouped["external"])

    deduplicated: list[SourceDocument] = []
    seen: set[tuple[str, str, str]] = set()
    duplicate_count = 0
    for document in selected:
        stable = document.source_url or document.content_sha256
        key = (document.broker_key, document.notice_type, stable)
        if key in seen:
            duplicate_count += 1
            continue
        seen.add(key)
        deduplicated.append(document)
    return deduplicated, broker_sources, duplicate_count


def _copy_selected(documents: list[SourceDocument], output_root: Path) -> None:
    output_root.parent.mkdir(parents=True, exist_ok=True)
    temp_root = Path(
        tempfile.mkdtemp(prefix=f".{output_root.name}.", dir=str(output_root.parent))
    )
    try:
        used_names: Counter[tuple[str, str, str]] = Counter()
        for document in documents:
            broker_folder = document.broker_key or "unmapped"
            directory = temp_root / document.notice_type / "notices" / broker_folder
            directory.mkdir(parents=True, exist_ok=True)
            key = (document.notice_type, broker_folder, document.path.name)
            used_names[key] += 1
            suffix = f"_{used_names[key]}" if used_names[key] > 1 else ""
            target = directory / f"{document.path.stem}{suffix}{document.path.suffix}"
            shutil.copy2(document.path, target)
        backup = output_root.with_name(f".{output_root.name}.previous")
        if backup.exists():
            shutil.rmtree(backup)
        if output_root.exists():
            os.replace(output_root, backup)
        os.replace(temp_root, output_root)
        if backup.exists():
            shutil.rmtree(backup)
    except Exception:
        if temp_root.exists():
            shutil.rmtree(temp_root)
        raise


def prepare_selected_sources(
    *,
    project_root: Path,
    configs: dict[str, BrokerSourceConfig],
    official_root: Path,
    cfcpn_procurement_dir: Path,
    cfcpn_result_dir: Path,
    external_dir: Path,
    output_root: Path,
) -> SelectionResult:
    official, official_passed = _latest_official_documents(
        project_root, official_root, configs
    )
    cfcpn = [
        *read_documents(cfcpn_procurement_dir, "cfcpn", configs),
        *read_documents(cfcpn_result_dir, "cfcpn", configs),
    ]
    external = read_documents(external_dir, "external", configs)
    selected, broker_sources, duplicate_count = select_documents(
        official, cfcpn, external, configs, official_passed
    )
    invalid_count = sum(
        not document.valid for document in [*official, *cfcpn, *external]
    )
    _copy_selected(selected, output_root)
    source_counts = dict(Counter(document.source_kind for document in selected))
    result = SelectionResult(
        selected_count=len(selected),
        deduplicated_count=duplicate_count,
        invalid_count=invalid_count,
        broker_sources=broker_sources,
        source_counts=source_counts,
        output_root=output_root.as_posix(),
    )
    write_json_atomic(
        output_root / "selection_manifest.json",
        {
            **asdict(result),
            "official_quality_passed": sorted(official_passed),
            "source_priority": list(SOURCE_PRIORITY),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return result
