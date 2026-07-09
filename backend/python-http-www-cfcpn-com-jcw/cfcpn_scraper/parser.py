"""Field parsing for CFCPN notice detail JSON."""

from __future__ import annotations

import html
import json
import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import quote, urljoin

from .client import build_detail_url
from .models import BASE_URL


def parse_notice_detail(
    response_data: dict[str, Any],
    list_item: dict[str, Any],
    notice_type: str | None = None,
    column: str | None = None,
) -> dict[str, Any]:
    """Normalize one detail response and its originating list item."""
    rows = response_data.get("rows") if isinstance(response_data, dict) else None
    detail = rows[0] if isinstance(rows, list) and rows else {}
    if not isinstance(detail, dict):
        detail = {}

    notice_id = _first(detail, list_item, "id")
    raw_notice_type = _first(detail, list_item, "noticeType")
    content_html = _unescape_html(
        _first(detail, list_item, "noticeContent")
        or _first(detail, list_item, "briefContent")
    )

    return {
        "notice_id": notice_id,
        "title": _first(detail, list_item, "noticeTitle"),
        "publish_time": _first(detail, list_item, "publishTime"),
        "purchaser": _first(detail, list_item, "userName"),
        "procurement_method": _first(detail, list_item, "purchaseTypeName"),
        "region": _first(detail, list_item, "area"),
        "tag": _first(detail, list_item, "yxCategoryNames"),
        "category": _first(detail, list_item, "labelAllId"),
        "notice_source": _first(detail, list_item, "noticeSource"),
        "notice_type": str(notice_type or raw_notice_type),
        "column": str(column or raw_notice_type),
        "raw_notice_type": str(raw_notice_type),
        "detail_url": response_data.get("_detail_url")
        or build_detail_url(notice_id, column or raw_notice_type),
        "content_html": content_html,
        "content_text": html_to_text(content_html),
        "attachments": parse_attachments(detail.get("file")),
        "raw_list_data": list_item if isinstance(list_item, dict) else {},
        "raw_detail_data": detail,
    }


def parse_attachments(raw_file: Any) -> list[dict[str, str]]:
    if not raw_file or not isinstance(raw_file, str):
        return []
    try:
        files = json.loads(raw_file)
    except json.JSONDecodeError:
        return []
    if not isinstance(files, list):
        return []

    attachments: list[dict[str, str]] = []
    for item in files:
        if not isinstance(item, dict):
            continue
        name = str(item.get("fileName") or "").strip()
        file_url = str(item.get("fileUrl") or "").strip()
        if not name and not file_url:
            continue
        absolute_file_url = urljoin(BASE_URL, file_url)
        download_url = (
            f"{BASE_URL}/jcw/systemnotice/systemNotice/download.do"
            f"?downloadUrl={quote(absolute_file_url, safe='')}"
            f"&realFileName={quote(name, safe='')}"
        )
        attachments.append({"name": name, "url": download_url})
    return attachments


def html_to_text(raw_html: str) -> str:
    parser = _TextExtractor()
    parser.feed(raw_html or "")
    parser.close()
    text = parser.get_text()
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _first(primary: dict[str, Any], fallback: dict[str, Any], key: str) -> str:
    for source in (primary, fallback):
        if isinstance(source, dict):
            value = source.get(key)
            if value is not None and value != "":
                return str(value)
    return ""


def _unescape_html(value: str) -> str:
    return html.unescape(value or "")


class _TextExtractor(HTMLParser):
    block_tags = {
        "address",
        "article",
        "aside",
        "blockquote",
        "dd",
        "div",
        "dl",
        "dt",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hr",
        "li",
        "main",
        "nav",
        "ol",
        "p",
        "pre",
        "section",
        "table",
        "tbody",
        "td",
        "tfoot",
        "th",
        "thead",
        "tr",
        "ul",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag == "br" or tag in self.block_tags:
            self._newline()
        if tag == "li":
            self._append("- ")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self._skip_depth:
            self._skip_depth -= 1
            return
        if self._skip_depth:
            return
        if tag in self.block_tags:
            self._newline()

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        self._append(data)

    def get_text(self) -> str:
        return "".join(self._parts)

    def _append(self, value: str) -> None:
        if value:
            self._parts.append(value)

    def _newline(self) -> None:
        if not self._parts or self._parts[-1].endswith("\n"):
            return
        self._parts.append("\n")
