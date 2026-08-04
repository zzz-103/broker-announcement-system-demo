"""Write parsed broker content as UTF-8 Markdown with YAML front matter."""

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from backend.broker_app_watch.collectors.base import CollectedContent
from backend.broker_app_watch.core.config import BrokerSource
from backend.broker_app_watch.core.paths import DATA_DIR, RAW_DATA_DIR
from backend.broker_app_watch.parsers.base import ParsedDocument


def _safe_filename_part(value: str) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")
    return value or "unnamed"


@dataclass(frozen=True, slots=True)
class CachedMarkdown:
    path: Path
    metadata: dict[str, str]


class MarkdownWriter:
    """Persist one document below the shared backend App Watch data directory."""

    def __init__(self, output_dir: Path | None = None) -> None:
        self.output_dir = output_dir or RAW_DATA_DIR / "markdown"

    def find_cached(self, source: BrokerSource) -> CachedMarkdown | None:
        """Return the newest saved document for a source, if one exists."""

        candidates: list[CachedMarkdown] = []
        source_dir = self.output_dir / _safe_filename_part(source.broker_code)
        for path in source_dir.glob("*.md"):
            try:
                raw = path.read_text(encoding="utf-8-sig")
                if not raw.startswith("---"):
                    continue
                parts = raw.split("---", 2)
                if len(parts) != 3:
                    continue
                values = yaml.safe_load(parts[1]) or {}
                if not isinstance(values, dict):
                    continue
                metadata = {str(key): str(value or "") for key, value in values.items()}
                if metadata.get("broker_code") != source.broker_code:
                    continue
                if metadata.get("source_url") != str(source.source_url):
                    continue
                candidates.append(CachedMarkdown(path=path, metadata=metadata))
            except (OSError, UnicodeError, yaml.YAMLError):
                continue
        if not candidates:
            return None
        return max(candidates, key=lambda item: item.path.stat().st_mtime)

    def write(
        self, source: BrokerSource, document: ParsedDocument, response: CollectedContent
    ) -> Path:
        body = self._render_body(document)
        if not body.strip():
            raise ValueError(f"{source.broker_code} 解析结果为空，拒绝写入 Markdown")
        content_sha256 = hashlib.sha256(body.encode("utf-8")).hexdigest()

        cached = self.find_cached(source)
        if cached and cached.metadata.get("content_sha256") == content_sha256:
            # The remote page was fetched, but its parsed content is unchanged.
            # Reuse the existing file so repeated refreshes do not create a new
            # Markdown download for a low-frequency App source.
            return cached.path

        metadata: dict[str, object] = {
            "crawl_time": response.crawl_time or "",
            "crawl_target": "券商手机端 App 信息",
            "broker_code": source.broker_code,
            "broker_name": source.broker_name,
            "app_name": source.app_name,
            "source_url": str(source.source_url),
            "fetch_url": str(source.fetch_url or source.source_url),
            "final_url": response.final_url or str(source.fetch_url or source.source_url),
            "source_type": source.source_type,
            "parser": source.parser,
            "http_status": response.status_code,
            "content_sha256": content_sha256,
        }
        metadata.update(response.metadata)
        metadata.update(document.source_metadata)
        front_matter = yaml.safe_dump(
            metadata,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
        ).strip()
        markdown = f"---\n{front_matter}\n---\n\n{body}\n"

        crawl_time = response.crawl_time or "1970-01-01T00:00:00+08:00"
        timestamp = crawl_time.replace("+", "_")
        timestamp = re.sub(r"[^0-9]", "", timestamp)[:14]
        if len(timestamp) != 14:
            timestamp = "19700101_000000"
        else:
            timestamp = f"{timestamp[:8]}_{timestamp[8:]}"
        filename = (
            f"{timestamp}_{_safe_filename_part(source.broker_code)}_"
            f"{_safe_filename_part(source.app_name)}.md"
        )
        path = self.output_dir / _safe_filename_part(source.broker_code) / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(markdown, encoding="utf-8")
        return self._relative_path(path, source, filename)

    @staticmethod
    def _render_body(document: ParsedDocument) -> str:
        parts = [f"# {document.title.strip()}"]
        for section in document.sections:
            parts.extend((f"## {section.heading.strip()}", section.content.strip()))
        return "\n\n".join(parts).strip()

    def _relative_path(self, path: Path, source: BrokerSource, filename: str) -> Path:
        try:
            return Path("data") / path.resolve().relative_to(DATA_DIR.resolve())
        except ValueError:
            return Path("data/raw/markdown") / _safe_filename_part(source.broker_code) / filename
