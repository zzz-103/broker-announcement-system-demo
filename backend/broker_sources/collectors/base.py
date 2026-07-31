from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from abc import ABC, abstractmethod
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable

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
        *,
        since_date: date | None = None,
        max_pages: int | None = None,
        workers: int = 8,
        resume: bool = False,
        overwrite: bool = False,
    ) -> None:
        self.config = config
        self.project_root = project_root
        self.output_root = output_root
        self.session = session or create_session()
        self.since_date = since_date
        self.max_pages = max_pages or config.pages
        self.workers = max(1, workers)
        self.overwrite = overwrite
        self.started_at = utc_now()
        self.checkpoint_path = output_root / "checkpoints" / f"{config.key}.json"
        self.previous_checkpoint = self._load_checkpoint()
        self.previous_checkpoint_entries: dict[str, dict[str, Any]] = {
            str(item.get("source_url")): item
            for item in self.previous_checkpoint.get("notices", [])
            if isinstance(item, dict) and item.get("source_url")
        }
        self.resumed = bool(
            resume
            and self.previous_checkpoint
            and not self.previous_checkpoint.get("completed", False)
        )
        if self.resumed and self.previous_checkpoint.get("run_root"):
            run_root_value = str(self.previous_checkpoint["run_root"])
            self.run_root = Path(run_root_value)
            if not self.run_root.is_absolute():
                self.run_root = project_root / self.run_root
            self.run_id = self.run_root.name
        else:
            self.run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            self.run_root = output_root / "runs" / config.key / self.run_id
        self.raw_dir = self.run_root / "raw"
        self.notices_dir = self.run_root / "notices"
        self.errors: list[str] = []
        self.successful_pages = 0
        self.scanned_pages = 0
        self.listed_count = 0
        self.detail_failure_count = 0
        self.skipped_count = 0
        self.new_count = 0
        self.stop_reason = ""
        self.current_notices: list[StandardNotice] = []
        self.checkpoint_entries: dict[str, dict[str, Any]] = dict(
            self.previous_checkpoint_entries
        )
        self._page_new_flags: list[bool] = []
        self._incremental_probe_enabled = not overwrite and not self.resumed
        self.start_page = 1
        if self.resumed:
            self.start_page = max(
                1,
                int(self.previous_checkpoint.get("last_completed_page") or 1),
            )

    def _load_checkpoint(self) -> dict[str, Any]:
        if not self.checkpoint_path.exists():
            return {}
        try:
            payload = json.loads(self.checkpoint_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return payload if isinstance(payload, dict) else {}

    def _write_checkpoint(self, *, completed: bool = False) -> None:
        write_json_atomic(
            self.checkpoint_path,
            {
                "broker_key": self.config.key,
                "since_date": self.since_date.isoformat() if self.since_date else None,
                "run_root": portable_path(self.run_root, self.project_root),
                "last_completed_page": self.scanned_pages,
                "saved_count": len(self.current_notices),
                "skipped_count": self.skipped_count,
                "updated_at": utc_now(),
                "completed": completed,
                "notices": list(self.checkpoint_entries.values()),
            },
        )

    def _reuse_notice(self, source_url: str) -> StandardNotice | None:
        if self.overwrite:
            return None
        entry = self.checkpoint_entries.get(source_url)
        if not entry:
            return None
        payload = entry.get("notice")
        previous_markdown = entry.get("markdown_path")
        if not isinstance(payload, dict) or not previous_markdown:
            return None
        try:
            notice = StandardNotice(**payload)
            source_path = Path(str(previous_markdown))
            if not source_path.is_absolute():
                source_path = self.project_root / source_path
            target = self.notices_dir / safe_filename(notice)
            target.parent.mkdir(parents=True, exist_ok=True)
            if source_path.resolve() != target.resolve():
                shutil.copy2(source_path, target)
            entry["markdown_path"] = portable_path(target, self.project_root)
            return notice
        except (OSError, TypeError, ValueError):
            return None

    def _save_notice(self, notice: StandardNotice) -> None:
        from ..markdown import render_notice_markdown

        target = self.notices_dir / safe_filename(notice)
        write_bytes_atomic(target, render_notice_markdown(notice).encode("utf-8"))
        self.checkpoint_entries[notice.source_url] = {
            "source_url": notice.source_url,
            "notice": notice.to_dict(),
            "markdown_path": portable_path(target, self.project_root),
        }

    def _should_stop_after_list_page(self, page_has_new_notice: bool) -> bool:
        """Limit list-page requests while retaining the downloaded history.

        The first two pages are the duplicate probe.  If both pages contain
        only notices that were already downloaded, the collector stops there.
        If both pages contain new notices, it probes two additional pages and
        then stops; this avoids walking a long archive on every incremental
        run while still covering a burst of new notices.
        """

        if not self._incremental_probe_enabled:
            return False

        self._page_new_flags.append(page_has_new_notice)
        page_count = len(self._page_new_flags)
        if page_count < 2:
            return False
        first_two = self._page_new_flags[:2]
        if page_count == 2:
            if not any(first_two):
                self.stop_reason = "前两页均为已下载数据"
                return True
            if not all(first_two):
                self.stop_reason = "前两页重复检查完成"
                return True
            return False
        if all(first_two) and page_count >= 4:
            self.stop_reason = "前两页均为新数据，追加比对两页后停止"
            return True
        return False

    def _preserve_previous_notices(
        self, notices: list[StandardNotice]
    ) -> list[StandardNotice]:
        """Copy previously downloaded notices omitted by the bounded probe."""

        if self.overwrite or not self.previous_checkpoint_entries:
            return notices

        result = list(notices)
        current_urls = {notice.source_url for notice in result}
        for source_url in self.previous_checkpoint_entries:
            if source_url in current_urls:
                continue
            entry = self.previous_checkpoint_entries[source_url]
            payload = entry.get("notice")
            if not isinstance(payload, dict):
                continue
            publish_date = str(payload.get("publish_date") or "")
            if self.since_date and publish_date and publish_date < self.since_date.isoformat():
                continue
            reused = self._reuse_notice(source_url)
            if reused is None:
                continue
            result.append(reused)
            current_urls.add(source_url)
            self.skipped_count += 1
        return result

    def collect_details(
        self,
        records: list[dict[str, str]],
        fetch_detail: Callable[[dict[str, str]], StandardNotice],
    ) -> list[StandardNotice]:
        self.current_notices = []
        if not records:
            return self.current_notices
        futures: dict[Future[StandardNotice], dict[str, str]] = {}
        with ThreadPoolExecutor(max_workers=self.workers) as executor:
            for record in records:
                reused = self._reuse_notice(record["detail_url"])
                if reused is not None:
                    self.current_notices.append(reused)
                    self.skipped_count += 1
                    print(
                        f"[official:{self.config.key}] 跳过已存在公告 {record['detail_url']}",
                        flush=True,
                    )
                    continue
                futures[executor.submit(fetch_detail, record)] = record
            total = len(records)
            for index, future in enumerate(as_completed(futures), start=1):
                record = futures[future]
                try:
                    notice = future.result()
                    self.current_notices.append(notice)
                    self.new_count += 1
                    self._save_notice(notice)
                    print(
                        f"[official:{self.config.key}] 详情进度 {index}/{len(futures)} "
                        f"成功：{record['title']}",
                        flush=True,
                    )
                except Exception as exc:  # noqa: BLE001 - keep other details running.
                    self.detail_failure_count += 1
                    self.errors.append(f"detail {record['detail_url']}: {exc}")
                    print(
                        f"[official:{self.config.key}] 详情进度 {index}/{len(futures)} "
                        f"失败：{record['title']} ({exc})",
                        flush=True,
                    )
                self._write_checkpoint()
        return self.current_notices

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

        notices = self._preserve_previous_notices(notices)
        self.current_notices = notices

        valid = [
            notice
            for notice in notices
            if notice.title
            and notice.publish_date
            and len(normalize_text(notice.content_text)) >= self.config.min_content_chars
        ]
        for notice in valid:
            self._save_notice(notice)
        write_json_atomic(self.run_root / "notices.json", [notice.to_dict() for notice in notices])

        detail_success_count = len(notices)
        attempted_details = detail_success_count + self.detail_failure_count
        ratio = len(valid) / attempted_details if attempted_details else 0.0
        quality_passed = (
            self.scanned_pages > 0
            and self.successful_pages == self.scanned_pages
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
            since_date=self.since_date.isoformat() if self.since_date else None,
            scanned_pages=self.scanned_pages,
            skipped_count=self.skipped_count,
            new_count=self.new_count,
            stop_reason=self.stop_reason,
            checkpoint_path=portable_path(self.checkpoint_path, self.project_root),
            resumed=self.resumed,
        )
        write_json_atomic(self.run_root / "manifest.json", manifest.to_dict())
        write_json_atomic(self.output_root / "manifests" / f"{self.config.key}.json", manifest.to_dict())
        self._write_checkpoint(completed=quality_passed)
        return manifest
