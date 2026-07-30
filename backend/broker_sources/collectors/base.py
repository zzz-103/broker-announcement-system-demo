from __future__ import annotations

import hashlib
import json
import os
import re
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from ..config import BrokerSourceConfig
from ..http_client import create_session
from ..models import CollectionManifest, StandardNotice


class CollectorError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def classify_notice_type(title: str) -> str:
    result_markers = ("结果", "中标", "成交", "中选", "流标", "废标", "终止", "取消")
    return "result" if any(marker in title for marker in result_markers) else "procurement"


def portable_path(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def write_bytes_atomic(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with temp_path.open("wb") as file:
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)


def write_json_atomic(path: Path, payload: Any) -> None:
    write_bytes_atomic(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"),
    )


def safe_filename(notice: StandardNotice) -> str:
    title = re.sub(r'[\\/:*?"<>|]', "", notice.title)
    title = normalize_text(title).rstrip(". ")[:72] or "untitled"
    notice_id = re.sub(r"[^A-Za-z0-9_-]", "", notice.notice_id)[:20]
    if not notice_id:
        notice_id = hashlib.sha1(notice.source_url.encode("utf-8")).hexdigest()[:12]
    return f"{notice.publish_date or 'unknown-date'}_{notice_id}_{title}.md"


class OfficialCollector(ABC):
    source_kind = "official"
    source_name = "券商官网"

    def __init__(
        self,
        config: BrokerSourceConfig,
        project_root: Path,
        output_root: Path,
        session: requests.Session | None = None,
    ) -> None:
        self.config = config
        self.project_root = project_root
        self.output_root = output_root
        self.session = session or create_session()
        self.started_at = utc_now()
        self.run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        self.run_root = output_root / "runs" / config.key / self.run_id
        self.raw_dir = self.run_root / "raw"
        self.notices_dir = self.run_root / "notices"
        self.errors: list[str] = []
        self.successful_pages = 0
        self.listed_count = 0
        self.detail_failure_count = 0

    @abstractmethod
    def collect_notices(self) -> list[StandardNotice]:
        raise NotImplementedError

    def save_raw(self, relative_path: str, content: bytes) -> Path:
        path = self.raw_dir / relative_path
        write_bytes_atomic(path, content)
        return path

    def run(self) -> CollectionManifest:
        notices: list[StandardNotice] = []
        try:
            notices = self.collect_notices()
        except Exception as exc:  # noqa: BLE001 - failure must create a fallback manifest.
            self.errors.append(f"{exc.__class__.__name__}: {exc}")

        valid = [
            notice
            for notice in notices
            if notice.title
            and notice.publish_date
            and len(normalize_text(notice.content_text)) >= self.config.min_content_chars
        ]
        for notice in valid:
            from ..markdown import render_notice_markdown

            write_bytes_atomic(
                self.notices_dir / safe_filename(notice),
                render_notice_markdown(notice).encode("utf-8"),
            )
        write_json_atomic(self.run_root / "notices.json", [notice.to_dict() for notice in notices])

        detail_success_count = len(notices)
        attempted_details = detail_success_count + self.detail_failure_count
        ratio = len(valid) / attempted_details if attempted_details else 0.0
        quality_passed = (
            self.successful_pages == self.config.pages
            and bool(valid)
            and ratio >= self.config.min_detail_success_ratio
        )
        status = "success" if quality_passed else "partial" if notices else "failed"
        manifest = CollectionManifest(
            broker_key=self.config.key,
            broker_name=self.config.broker_name,
            source_kind=self.source_kind,
            source_name=self.source_name,
            started_at=self.started_at,
            finished_at=utc_now(),
            status=status,
            quality_passed=quality_passed,
            requested_pages=self.config.pages,
            successful_pages=self.successful_pages,
            listed_count=self.listed_count,
            detail_success_count=detail_success_count,
            detail_failure_count=self.detail_failure_count,
            valid_count=len(valid),
            completeness_ratio=round(ratio, 4),
            output_dir=portable_path(self.notices_dir, self.project_root),
            raw_dir=portable_path(self.raw_dir, self.project_root),
            errors=self.errors,
        )
        write_json_atomic(self.run_root / "manifest.json", manifest.to_dict())
        write_json_atomic(self.output_root / "manifests" / f"{self.config.key}.json", manifest.to_dict())
        return manifest
