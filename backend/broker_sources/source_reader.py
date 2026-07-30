from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from .collectors.base import classify_notice_type, normalize_text
from .config import BrokerSourceConfig


@dataclass(frozen=True)
class SourceDocument:
    path: Path
    source_kind: str
    broker_key: str
    notice_type: str
    title: str
    publish_date: str
    source_url: str
    content_chars: int
    content_sha256: str

    @property
    def valid(self) -> bool:
        return bool(self.title and self.publish_date and self.content_chars > 0)


def parse_front_matter(markdown: str) -> dict[str, str]:
    if not markdown.startswith("---\n"):
        return {}
    end = markdown.find("\n---", 4)
    if end < 0:
        return {}
    result: dict[str, str] = {}
    for line in markdown[4:end].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        try:
            decoded = json.loads(value)
            result[key] = "" if decoded is None else str(decoded)
        except json.JSONDecodeError:
            result[key] = value.strip("'\"")
    return result


def markdown_title(markdown: str) -> str:
    match = re.search(r"^#\s+(.+?)\s*$", markdown, re.MULTILINE)
    return normalize_text(match.group(1)) if match else ""


def markdown_body(markdown: str) -> str:
    marker = "## 公告正文"
    if marker in markdown:
        return markdown.split(marker, 1)[1]
    if markdown.startswith("---\n"):
        end = markdown.find("\n---", 4)
        if end >= 0:
            return markdown[end + 4 :]
    return markdown


def identify_broker(
    markdown: str,
    front_matter: dict[str, str],
    configs: dict[str, BrokerSourceConfig],
) -> str:
    configured = front_matter.get("broker_key", "")
    if configured in configs:
        return configured
    searchable = normalize_text(
        " ".join(
            (
                front_matter.get("broker_name", ""),
                front_matter.get("purchaser", ""),
                front_matter.get("title", ""),
                markdown[:4000],
            )
        )
    )
    matches: list[tuple[int, str]] = []
    for key, config in configs.items():
        aliases = (config.broker_name, *config.aliases)
        longest = max((len(alias) for alias in aliases if alias and alias in searchable), default=0)
        if longest:
            matches.append((longest, key))
    if matches:
        return max(matches)[1]

    purchaser = normalize_text(
        front_matter.get("broker_name") or front_matter.get("purchaser")
    )
    if "证券" in purchaser:
        normalized_purchaser = re.sub(
            r"(股份有限公司|有限责任公司|有限公司)$", "", purchaser
        )
        digest = hashlib.sha1(normalized_purchaser.encode("utf-8")).hexdigest()[:12]
        return f"broker_{digest}"
    return ""


def read_documents(
    root: Path,
    source_kind: str,
    configs: dict[str, BrokerSourceConfig],
    *,
    min_content_chars: int = 1,
) -> list[SourceDocument]:
    if not root.exists():
        return []
    documents: list[SourceDocument] = []
    for path in sorted(root.rglob("*.md")):
        try:
            markdown = path.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeDecodeError):
            continue
        front_matter = parse_front_matter(markdown)
        title = normalize_text(front_matter.get("title") or markdown_title(markdown))
        body = normalize_text(markdown_body(markdown))
        publish_date_match = re.search(
            r"20\d{2}-\d{2}-\d{2}",
            front_matter.get("publish_date", "") or path.name,
        )
        publish_date = publish_date_match.group(0) if publish_date_match else ""
        notice_type = front_matter.get("notice_type", "")
        if notice_type not in {"procurement", "result"}:
            notice_type = classify_notice_type(title)
        content_chars = len(body)
        if content_chars < min_content_chars:
            content_chars = 0
        documents.append(
            SourceDocument(
                path=path,
                source_kind=source_kind,
                broker_key=identify_broker(markdown, front_matter, configs),
                notice_type=notice_type,
                title=title,
                publish_date=publish_date,
                source_url=front_matter.get("source_url", ""),
                content_chars=content_chars,
                content_sha256=hashlib.sha256(body.encode("utf-8")).hexdigest(),
            )
        )
    return documents
