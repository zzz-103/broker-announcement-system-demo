from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from bs4 import BeautifulSoup

from ..http_client import DEFAULT_TIMEOUT
from ..models import StandardNotice
from .base import (
    CollectorError,
    OfficialCollector,
    classify_notice_type,
    normalize_text,
    portable_path,
    utc_now,
)


class CenturyCollector(OfficialCollector):
    """Collect Century Securities notices from the XHR endpoint used by its page."""

    def list_payload(self, page_number: int) -> dict[str, str]:
        return {
            "action": "GetColumnInfo",
            "Column": str(self.config.settings["column_id"]),
            "Page": str(page_number),
        }

    @staticmethod
    def _publish_date(item: dict[str, Any]) -> str:
        timestamp = item.get("Timesamp")
        if isinstance(timestamp, (int, float)):
            return datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).date().isoformat()
        match = re.search(r"/Date\((\d+)", normalize_text(item.get("CreateDate")))
        if match:
            return datetime.fromtimestamp(
                int(match.group(1)) / 1000,
                tz=timezone.utc,
            ).date().isoformat()
        return ""

    @staticmethod
    def _content_text(content_html: str) -> str:
        soup = BeautifulSoup(content_html, "html.parser")
        for node in soup.select("script,style"):
            node.decompose()
        return normalize_text(soup.get_text("\n", strip=True))

    @classmethod
    def parse_list(
        cls,
        payload: dict[str, Any],
        list_page_url: str,
    ) -> tuple[list[dict[str, str]], int]:
        if payload.get("status") is not True:
            raise CollectorError(f"Century API error: {payload.get('msg')}")
        data = payload.get("data")
        if not isinstance(data, dict):
            raise CollectorError("Century API data is not an object")
        items = data.get("Items")
        if not isinstance(items, list):
            raise CollectorError("Century API Items is not a list")

        records: list[dict[str, str]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            notice_id = normalize_text(item.get("Whir_U_ContentNew_PID"))
            title = normalize_text(item.get("Title"))
            content_html = str(item.get("Content") or "")
            content_text = cls._content_text(content_html)
            publish_date = cls._publish_date(item)
            if not notice_id or not title or not publish_date or not content_text:
                continue
            records.append(
                {
                    "notice_id": notice_id,
                    "title": title,
                    "publish_date": publish_date,
                    "content_html": content_html,
                    "content_text": content_text,
                    "notice_type": classify_notice_type(f"{title} {content_text[:300]}"),
                    "detail_url": f"{list_page_url}#notice-{notice_id}",
                }
            )
        return records, max(0, int(data.get("TotalPages") or 0))

    def collect_notices(self) -> list[StandardNotice]:
        api_url = str(self.config.settings["api_url"])
        list_page_url = str(self.config.settings["list_page_url"])
        self.current_notices = []
        seen_urls: set[str] = set()

        for page_number in range(self.start_page, self.max_pages + 1):
            print(
                f"[official:{self.config.key}] 请求 XHR 列表第 {page_number} 页",
                flush=True,
            )
            response = self.session.post(
                api_url,
                data=self.list_payload(page_number),
                headers={
                    "Referer": list_page_url,
                    "X-Requested-With": "XMLHttpRequest",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                },
                timeout=DEFAULT_TIMEOUT,
            )
            self.scanned_pages += 1
            raw_path = self.save_raw(f"lists/page_{page_number}.json", response.content)
            if response.status_code != 200:
                self.errors.append(f"list page {page_number}: HTTP {response.status_code}")
                self.stop_reason = f"列表接口 HTTP {response.status_code}"
                continue
            try:
                payload = response.json()
                if not isinstance(payload, dict):
                    raise CollectorError("Century API response is not an object")
                page_records, total_pages = self.parse_list(payload, list_page_url)
            except (ValueError, CollectorError, json.JSONDecodeError) as exc:
                self.errors.append(f"list page {page_number}: {exc}")
                continue
            if not page_records:
                self.stop_reason = "列表接口无公告"
                break

            self.successful_pages += 1
            before_since_date = False
            page_has_new_notice = False
            raw_portable_path = portable_path(raw_path, self.project_root)
            for record in page_records:
                if self.since_date and record["publish_date"] < self.since_date.isoformat():
                    before_since_date = True
                    continue
                if record["detail_url"] in seen_urls:
                    self.skipped_count += 1
                    continue
                seen_urls.add(record["detail_url"])
                page_has_new_notice = (
                    page_has_new_notice
                    or record["detail_url"] not in self.previous_checkpoint_entries
                )
                reused = self._reuse_notice(record["detail_url"])
                if reused is not None:
                    self.current_notices.append(reused)
                    self.skipped_count += 1
                    continue
                notice = StandardNotice(
                    broker_key=self.config.key,
                    broker_name=self.config.broker_name,
                    source_kind=self.source_kind,
                    source_name=self.source_name,
                    notice_id=record["notice_id"],
                    notice_type=record["notice_type"],
                    title=record["title"],
                    publish_date=record["publish_date"],
                    source_url=record["detail_url"],
                    collected_at=utc_now(),
                    collection_status="success",
                    content_text=record["content_text"],
                    content_html=record["content_html"],
                    raw_list_path=raw_portable_path,
                    raw_detail_path=raw_portable_path,
                )
                self.current_notices.append(notice)
                self.new_count += 1
                self._save_notice(notice)

            print(
                f"[official:{self.config.key}] XHR 列表第 {page_number} 页："
                f"发现 {len(page_records)} 条，日期范围内 "
                f"{len(self.current_notices)} 条累计",
                flush=True,
            )
            self._write_checkpoint()
            if before_since_date:
                self.stop_reason = "达到日期下限"
                break
            if self._should_stop_after_list_page(page_has_new_notice):
                break
            if total_pages and page_number >= total_pages:
                self.stop_reason = "达到接口总页数"
                break

        if not self.stop_reason:
            self.stop_reason = "达到最大页数"
        self.listed_count = len(self.current_notices)
        return self.current_notices
