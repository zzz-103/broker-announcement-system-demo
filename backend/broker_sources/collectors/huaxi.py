from __future__ import annotations

import json
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


class HuaxiCollector(OfficialCollector):
    def list_payload(self, page_number: int) -> dict[str, str]:
        return {
            "funcNo": str(self.config.settings["func_no"]),
            "catalogId": str(self.config.settings["catalog_id"]),
            "branchNo": "",
            "curtPageNo": str(page_number),
            "numPerPage": str(self.config.page_size),
            "key_word": "",
            "start_date": "",
            "end_date": "",
        }

    @staticmethod
    def parse_list(payload: dict[str, Any], base_url: str) -> list[dict[str, str]]:
        if str(payload.get("error_no")) != "0":
            raise CollectorError(f"Huaxi API error: {payload.get('error_info')}")
        results = payload.get("results")
        if not isinstance(results, list) or not results:
            raise CollectorError("Huaxi API results is empty")
        data = results[0].get("data") if isinstance(results[0], dict) else None
        if not isinstance(data, list):
            raise CollectorError("Huaxi API data is not a list")
        records: list[dict[str, str]] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            title = normalize_text(item.get("title"))
            url = normalize_text(item.get("url") or item.get("link_url"))
            publish_date = normalize_text(item.get("create_date") or item.get("publish_date"))[:10]
            if title and url and publish_date:
                records.append(
                    {
                        "notice_id": normalize_text(item.get("article_id")),
                        "title": title,
                        "publish_date": publish_date,
                        "detail_url": urljoin(base_url, url),
                    }
                )
        return records

    @staticmethod
    def parse_detail(html: bytes) -> str:
        soup = BeautifulSoup(html, "html.parser")
        content = soup.select_one(".article_cont")
        if content is None:
            raise CollectorError("Huaxi detail page does not contain .article_cont")
        for node in content.select("script,style"):
            node.decompose()
        return normalize_text(content.get_text("\n", strip=True))

    def collect_notices(self) -> list[StandardNotice]:
        api_url = str(self.config.settings["api_url"])
        base_url = str(self.config.settings["base_url"])
        referer = str(self.config.settings["list_page_url"])
        records: list[dict[str, str]] = []
        for page_number in range(1, self.config.pages + 1):
            response = self.session.post(
                api_url,
                data=self.list_payload(page_number),
                headers={
                    "Referer": referer,
                    "X-Requested-With": "XMLHttpRequest",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                },
                timeout=DEFAULT_TIMEOUT,
            )
            raw_path = self.save_raw(f"lists/page_{page_number}.json", response.content)
            if response.status_code != 200:
                self.errors.append(f"list page {page_number}: HTTP {response.status_code}")
                continue
            try:
                payload = response.json()
                if not isinstance(payload, dict):
                    raise CollectorError("Huaxi API response is not an object")
                page_records = self.parse_list(payload, base_url)
            except (ValueError, CollectorError, json.JSONDecodeError) as exc:
                self.errors.append(f"list page {page_number}: {exc}")
                continue
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
            notice_id = record["notice_id"] or record["detail_url"].rsplit("/", 1)[-1].split(".", 1)[0]
            try:
                response = self.session.get(record["detail_url"], timeout=DEFAULT_TIMEOUT)
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
                        source_url=record["detail_url"],
                        collected_at=utc_now(),
                        collection_status="success",
                        content_text=content,
                        raw_list_path=record["raw_list_path"],
                        raw_detail_path=portable_path(raw_path, self.project_root),
                    )
                )
            except Exception as exc:  # noqa: BLE001 - continue with other details.
                self.detail_failure_count += 1
                self.errors.append(f"detail {record['detail_url']}: {exc}")
        return notices
