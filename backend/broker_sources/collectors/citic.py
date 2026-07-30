from __future__ import annotations

import re
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
        for page_number in range(1, self.config.pages + 1):
            url = self.page_url(page_number)
            response = self.session.get(url, timeout=DEFAULT_TIMEOUT)
            raw_path = self.save_raw(f"lists/page_{page_number}.html", response.content)
            if response.status_code != 200:
                self.errors.append(f"list page {page_number}: HTTP {response.status_code}")
                continue
            page_records = self.parse_list(response.content, url)
            if not page_records:
                self.errors.append(f"list page {page_number}: no notices parsed")
                continue
            self.successful_pages += 1
            for record in page_records:
                record["raw_list_path"] = portable_path(raw_path, self.project_root)
            records.extend(page_records)

        self.listed_count = len(records)
        notices: list[StandardNotice] = []
        for record in records:
            detail_url = record["detail_url"]
            notice_id_match = re.search(r"t(\d+)_([0-9]+)\.html", detail_url)
            notice_id = (
                "-".join(notice_id_match.groups())
                if notice_id_match
                else detail_url.rsplit("/", 1)[-1].removesuffix(".html")
            )
            try:
                response = self.session.get(detail_url, timeout=DEFAULT_TIMEOUT)
                raw_path = self.save_raw(f"details/{notice_id}.html", response.content)
                if response.status_code != 200:
                    raise CollectorError(f"HTTP {response.status_code}")
                content = self.parse_detail(response.content)
                notices.append(
                    StandardNotice(
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
                )
            except Exception as exc:  # noqa: BLE001 - continue with other details.
                self.detail_failure_count += 1
                self.errors.append(f"detail {detail_url}: {exc}")
        return notices
