"""Markdown rendering and local file writing for parsed CFCPN notices."""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, NavigableString, Tag


ILLEGAL_FILENAME_CHARS = r'\/:*?"<>|'
MAX_TITLE_FILENAME_LENGTH = 72
FRONT_MATTER_FIELDS = [
    "source",
    "source_url",
    "notice_id",
    "title",
    "publish_time",
    "purchaser",
    "procurement_method",
    "region",
    "tag",
    "category",
    "notice_source",
    "keyword",
    "crawled_at",
]


def sanitize_filename(title: str, notice_id: str, publish_time: str) -> str:
    """Build a Windows/macOS-safe notice filename."""
    date_part = _publish_date(publish_time)
    id_part = (notice_id or "unknown")[:8] or "unknown"
    clean_title = re.sub(f"[{re.escape(ILLEGAL_FILENAME_CHARS)}]", "", title or "")
    clean_title = re.sub(r"[\r\n\t]+", " ", clean_title)
    clean_title = re.sub(r"\s+", " ", clean_title).strip()
    clean_title = clean_title.rstrip(". ")
    if len(clean_title) > MAX_TITLE_FILENAME_LENGTH:
        clean_title = clean_title[:MAX_TITLE_FILENAME_LENGTH].rstrip(". ")
    if not clean_title:
        clean_title = "untitled"
    return f"{date_part}_{id_part}_{clean_title}.md"


def html_to_markdown(content_html: str, content_text: str = "") -> tuple[str, list[str]]:
    """Convert notice HTML to readable Markdown, falling back to plain text."""
    warnings: list[str] = []
    if not content_html:
        return (content_text or "").strip(), ["content_html empty; used content_text"]

    try:
        soup = BeautifulSoup(content_html, "html.parser")
        for node in soup(["script", "style"]):
            node.decompose()
        _remove_empty_tags(soup)
        parts = [_convert_node(child).strip() for child in soup.contents]
        markdown = "\n\n".join(part for part in parts if part)
        markdown = _normalize_markdown(markdown)
        if not markdown and content_text:
            warnings.append("html conversion produced empty text; used content_text")
            return content_text.strip(), warnings
        return markdown, warnings
    except Exception as exc:  # pragma: no cover - defensive fallback.
        warnings.append(f"html conversion failed: {exc}; used content_text")
        return (content_text or "").strip(), warnings


def build_markdown(
    notice: dict[str, Any],
    keyword: str = "证券",
    crawled_at: str | None = None,
) -> str:
    """Build one complete Markdown document for a parsed notice."""
    crawled_at = crawled_at or datetime.now().astimezone().isoformat(timespec="seconds")
    notice_id = _string(notice.get("notice_id"))
    title = _string(notice.get("title"))
    attachments = _safe_attachments(notice.get("attachments"))
    body, warnings = html_to_markdown(
        _string(notice.get("content_html")), _string(notice.get("content_text"))
    )

    front_matter = _front_matter(
        {
            "source": "金采网",
            "source_url": _string(notice.get("detail_url")),
            "notice_id": notice_id,
            "title": title,
            "publish_time": _string(notice.get("publish_time")),
            "purchaser": _string(notice.get("purchaser")),
            "procurement_method": _string(notice.get("procurement_method")),
            "region": _string(notice.get("region")),
            "tag": _string(notice.get("tag")),
            "category": _string(notice.get("category")),
            "notice_source": _string(notice.get("notice_source")),
            "keyword": keyword,
            "crawled_at": crawled_at,
        }
    )

    attachments_markdown = _attachments_markdown(attachments)
    raw_list_json = json.dumps(
        notice.get("raw_list_data") or {}, ensure_ascii=False, indent=2, sort_keys=True
    )
    warning_text = ""
    if warnings:
        warning_text = "\n\n<!-- warnings: " + "; ".join(warnings) + " -->"

    return (
        f"---\n{front_matter}---\n\n"
        f"# {title}\n\n"
        "## 基本信息\n\n"
        "| 字段 | 内容 |\n"
        "|---|---|\n"
        f"| 公告 ID | {_table_cell(notice_id)} |\n"
        f"| 发布时间 | {_table_cell(notice.get('publish_time'))} |\n"
        f"| 采购人 | {_table_cell(notice.get('purchaser'))} |\n"
        f"| 采购方式 | {_table_cell(notice.get('procurement_method'))} |\n"
        f"| 地区 | {_table_cell(notice.get('region'))} |\n"
        f"| 标签 | {_table_cell(notice.get('tag'))} |\n"
        f"| 品类 | {_table_cell(notice.get('category'))} |\n"
        f"| 公告来源 | {_table_cell(notice.get('notice_source'))} |\n"
        f"| 详情链接 | {_table_cell(notice.get('detail_url'))} |\n\n"
        "## 公告正文\n\n"
        f"{body or _string(notice.get('content_text'))}\n\n"
        "## 附件\n\n"
        f"{attachments_markdown}\n\n"
        "## 原始列表数据\n\n"
        "```json\n"
        f"{raw_list_json}\n"
        "```\n"
        f"{warning_text}\n"
    )


def write_notice_markdown(
    notice: dict[str, Any],
    output_dir: str | Path = "output/notices",
    keyword: str = "证券",
    crawled_at: str | None = None,
) -> Path:
    """Write one notice Markdown file and return its path."""
    target_dir = Path(output_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = sanitize_filename(
        _string(notice.get("title")),
        _string(notice.get("notice_id")),
        _string(notice.get("publish_time")),
    )
    path = target_dir / filename
    path.write_text(build_markdown(notice, keyword, crawled_at), encoding="utf-8")
    return path


def write_index_markdown(
    notices: list[dict[str, Any]],
    notice_paths: dict[str, Path],
    index_path: str | Path = "output/index.md",
    generated_at: str | None = None,
) -> Path:
    """Write an index for generated notice Markdown files."""
    generated_at = generated_at or datetime.now().astimezone().isoformat(timespec="seconds")
    path = Path(index_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    unique: dict[str, dict[str, Any]] = {}
    for notice in notices:
        notice_id = _string(notice.get("notice_id"))
        if notice_id and notice_id not in unique:
            unique[notice_id] = notice

    sorted_notices = sorted(
        unique.values(), key=lambda item: _string(item.get("publish_time")), reverse=True
    )

    lines = [
        "# 金采网公告抓取索引",
        "",
        f"- 生成时间：{generated_at}",
        f"- 公告数量：{len(sorted_notices)}",
        "",
        "| 发布时间 | 公告标题 | 采购人 | 地区 | 本地文件 |",
        "|---|---|---|---|---|",
    ]
    for notice in sorted_notices:
        notice_id = _string(notice.get("notice_id"))
        notice_path = notice_paths.get(notice_id)
        if not notice_path:
            continue
        relative = notice_path.relative_to(path.parent).as_posix()
        lines.append(
            "| "
            f"{_table_cell(_publish_date(_string(notice.get('publish_time'))))} | "
            f"{_table_cell(notice.get('title'))} | "
            f"{_table_cell(notice.get('purchaser'))} | "
            f"{_table_cell(notice.get('region'))} | "
            f"[查看]({relative}) |"
        )

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _convert_node(node: Any) -> str:
    if isinstance(node, NavigableString):
        return str(node)
    if not isinstance(node, Tag):
        return ""

    name = node.name.lower()
    if name in {"script", "style"}:
        return ""
    if name == "br":
        return "\n"
    if name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
        level = int(name[1])
        return f"{'#' * level} {_children_text(node).strip()}\n"
    if name == "p":
        return _children_text(node).strip() + "\n"
    if name in {"div", "section", "article", "blockquote"}:
        return _children_blocks(node)
    if name in {"strong", "b"}:
        text = _children_text(node).strip()
        return f"**{text}**" if text else ""
    if name in {"em", "i"}:
        text = _children_text(node).strip()
        return f"*{text}*" if text else ""
    if name == "a":
        text = _children_text(node).strip() or _string(node.get("href"))
        href = _string(node.get("href"))
        return f"[{text}]({href})" if href else text
    if name in {"ul", "ol"}:
        return _list_markdown(node, ordered=name == "ol")
    if name == "table":
        return _table_markdown(node)
    if name in {"tr", "td", "th", "tbody", "thead", "tfoot", "span", "font"}:
        return _children_text(node)
    return _children_text(node)


def _children_text(node: Tag) -> str:
    return "".join(_convert_node(child) for child in node.children)


def _children_blocks(node: Tag) -> str:
    parts = [_convert_node(child).strip() for child in node.children]
    return "\n\n".join(part for part in parts if part)


def _list_markdown(node: Tag, ordered: bool) -> str:
    lines: list[str] = []
    index = 1
    for child in node.find_all("li", recursive=False):
        text = _children_blocks(child).replace("\n", "\n  ").strip()
        prefix = f"{index}. " if ordered else "- "
        lines.append(prefix + text)
        index += 1
    return "\n".join(lines) + "\n"


def _table_markdown(node: Tag) -> str:
    rows: list[list[str]] = []
    for tr in node.find_all("tr"):
        cells = tr.find_all(["th", "td"], recursive=False)
        if not cells:
            continue
        rows.append([_table_cell(_children_text(cell).strip()) for cell in cells])
    if not rows:
        return ""

    column_count = max(len(row) for row in rows)
    rows = [row + [""] * (column_count - len(row)) for row in rows]
    header = rows[0]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in range(column_count)) + " |",
    ]
    for row in rows[1:]:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines) + "\n"


def _remove_empty_tags(soup: BeautifulSoup) -> None:
    preserved = {"br", "img", "hr", "td", "th"}
    for tag in list(soup.find_all()):
        if tag.name in preserved:
            continue
        if not tag.get_text(strip=True) and not tag.find(["br", "img", "table"]):
            tag.decompose()


def _normalize_markdown(markdown: str) -> str:
    markdown = markdown.replace("\xa0", " ")
    markdown = re.sub(r"\[if\s+!supportLists\]", "", markdown, flags=re.IGNORECASE)
    markdown = re.sub(r"\[endif\]", "", markdown, flags=re.IGNORECASE)
    markdown = re.sub(r"[ \t\r\f\v]+", " ", markdown)
    markdown = re.sub(r" *\n *", "\n", markdown)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)
    return markdown.strip()


def _front_matter(data: dict[str, str]) -> str:
    lines = []
    for key in FRONT_MATTER_FIELDS:
        # JSON strings are valid YAML double-quoted scalars and handle quotes/newlines.
        lines.append(f"{key}: {json.dumps(_string(data.get(key)), ensure_ascii=False)}")
    return "\n".join(lines) + "\n"


def _attachments_markdown(attachments: Any) -> str:
    safe_items = _safe_attachments(attachments)
    if not safe_items:
        return "无附件或页面未提供附件。"

    lines = []
    for index, item in enumerate(safe_items, start=1):
        name = _string(item.get("name")) or f"附件{index}"
        url = _string(item.get("url"))
        if url:
            lines.append(f"- [{name}]({url})")
        else:
            lines.append(f"- {name}")
    return "\n".join(lines)


def _safe_attachments(attachments: Any) -> list[dict[str, str]]:
    if not isinstance(attachments, list):
        return []
    safe_items: list[dict[str, str]] = []
    for item in attachments:
        if not isinstance(item, dict):
            continue
        name = _string(item.get("name"))
        url = _string(item.get("url"))
        if name or url:
            safe_items.append({"name": name, "url": url})
    return safe_items


def _table_cell(value: Any) -> str:
    text = _string(value)
    text = text.replace("\n", "<br>")
    return text.replace("|", r"\|")


def _publish_date(publish_time: str) -> str:
    match = re.search(r"\d{4}-\d{2}-\d{2}", publish_time or "")
    return match.group(0) if match else "unknown-date"


def _string(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()
