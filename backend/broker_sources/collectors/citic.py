from __future__ import annotations

import re
from datetime import date
from typing import Any
from urllib.parse import urljoin

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


class CiticCollector(OfficialCollector):
    def page_url(self, page_number: int) -> str:
        list_url = str(self.config.settings["list_url"])
        if page_number == 1:
            return list_url
        return urljoin(list_url, f"index_{page_number - 1}.html")

    @staticmethod
    def parse_list(html: bytes, page_url: str) -> list[dict[str, str]]:
        soup = BeautifulSoup(html, "html.parser")
        records: list[dict[str, str]] = []
        for link in soup.select('a[href*="/t20"], a[href^="./20"]'):
            title = normalize_text(link.get_text(" ", strip=True))
            href = str(link.get("href") or "").strip()
            if not title or not href:
                continue
            container = link.find_parent("li")
            text = normalize_text(container.get_text(" ", strip=True) if container else "")
            match = re.search(r"20\d{2}-\d{2}-\d{2}", text)
            if not match:
                continue
            records.append(
                {
                    "title": title,
                    "publish_date": match.group(0),
                    "detail_url": urljoin(page_url, href),
                }
            )
        return records

    @staticmethod
    def parse_detail(html: bytes) -> str:
        soup = BeautifulSoup(html, "html.parser")
        content = soup.select_one(".docHtmlB")
        if content is None:
            raise CollectorError("Citic detail page does not contain .docHtmlB")
        for node in content.select("script,style"):
            node.decompose()
        return normalize_text(content.get_text("\n", strip=True))

    def collect_notices(self) -> list[StandardNotice]:
        records: list[dict[str, str]] = []
        seen_urls: set[str] = set()
        for page_number in range(self.start_page, self.max_pages + 1):
            url = self.page_url(page_number)
            print(
                f"[official:{self.config.key}] 请求列表第 {page_number} 页",
                flush=True,
            )
            response = self.session.get(url, timeout=DEFAULT_TIMEOUT)
            self.scanned_pages += 1
            raw_path = self.save_raw(f"lists/page_{page_number}.html", response.content)
            if response.status_code != 200:
                self.errors.append(f"list page {page_number}: HTTP {response.status_code}")
                self.stop_reason = f"列表页 HTTP {response.status_code}"
                continue
            page_records = self.parse_list(response.content, url)
            if not page_records:
                self.errors.append(f"list page {page_number}: no notices parsed")
                self.stop_reason = "列表页无公告"
                continue
            self.successful_pages += 1
            before_since_date = False
            page_has_new_notice = False
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
                record["raw_list_path"] = portable_path(raw_path, self.project_root)
                records.append(record)
            print(
                f"[official:{self.config.key}] 列表第 {page_number} 页："
                f"发现 {len(page_records)} 条，日期范围内 {len(records)} 条累计，"
                f"已跳过 {self.skipped_count} 条",
                flush=True,
            )
            self._write_checkpoint()
            if before_since_date:
                self.stop_reason = "达到日期下限"
                break
            if self._should_stop_after_list_page(page_has_new_notice):
                break
        if not self.stop_reason:
            self.stop_reason = "达到最大页数"

        self.listed_count = len(records)
        def fetch_detail(record: dict[str, str]) -> StandardNotice:
            detail_url = record["detail_url"]
            notice_id_match = re.search(r"t(\d+)_([0-9]+)\.html", detail_url)
            notice_id = (
                "-".join(notice_id_match.groups())
                if notice_id_match
                else detail_url.rsplit("/", 1)[-1].removesuffix(".html")
            )
            response = self.session.get(detail_url, timeout=DEFAULT_TIMEOUT)
            raw_path = self.save_raw(f"details/{notice_id}.html", response.content)
            if response.status_code != 200:
                raise CollectorError(f"HTTP {response.status_code}")
            content = self.parse_detail(response.content)
            return StandardNotice(
                broker_key=self.config.key,
                broker_name=self.config.broker_name,
                source_kind=self.source_kind,
                source_name=self.source_name,
                notice_id=notice_id,
                notice_type=classify_notice_type(record["title"]),
                title=record["title"],
                publish_date=record["publish_date"],
                source_url=detail_url,
                collected_at=utc_now(),
                collection_status="success",
                content_text=content,
                raw_list_path=record["raw_list_path"],
                raw_detail_path=portable_path(raw_path, self.project_root),
            )
        return self.collect_details(records, fetch_detail)
