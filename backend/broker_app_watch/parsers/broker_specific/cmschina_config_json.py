"""Parser for the China Merchants Securities (招商证券) download config.json."""

import json

from backend.broker_app_watch.collectors.base import CollectedContent
from backend.broker_app_watch.core.config import BrokerSource
from backend.broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text


class CmschinaConfigJsonParser(Parser):
    """Preserve each platform's version, date and update notes from config.json."""

    _DEFAULT_PLATFORMS = ("iOS", "Android", "HarmonyOS")

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        del response
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{source.broker_code} 招商证券接口返回的内容不是有效 JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError(f"{source.broker_code} 招商证券接口缺少顶层对象")

        platforms = source.parser_options.get("platforms") or list(self._DEFAULT_PLATFORMS)
        if not isinstance(platforms, list) or not all(
            isinstance(item, str) for item in platforms
        ):
            raise ValueError(f"{source.broker_code} 的 platforms 配置必须是字符串列表")

        sections: list[ParsedSection] = []
        metadata: dict[str, str] = {}
        for platform in platforms:
            entry = payload.get(platform)
            if not isinstance(entry, dict):
                raise ValueError(
                    f"{source.broker_code} 招商证券接口缺少平台“{platform}”，来源：{source.source_url}"
                )
            heading = str(entry.get("name") or platform)
            sections.append(
                ParsedSection(heading=heading, content=self._platform_content(entry))
            )
            version = entry.get("version")
            date = entry.get("date")
            if version is not None:
                metadata[f"{platform.lower()}_version"] = str(version)
            if date is not None:
                metadata[f"{platform.lower()}_date"] = str(date)

        return ParsedDocument(
            title=source.app_name,
            sections=sections,
            source_metadata=metadata,
        )

    @staticmethod
    def _platform_content(entry: dict[str, object]) -> str:
        lines: list[str] = []
        version = entry.get("version")
        if version is not None and str(version).strip():
            lines.append(f"- 版本：{str(version).strip()}")
        date = entry.get("date")
        if date is not None and str(date).strip():
            lines.append(f"- 更新日期：{str(date).strip()}")

        notes = entry.get("content")
        note_lines: list[str] = []
        if isinstance(notes, list):
            note_lines = [str(item) for item in notes if str(item).strip()]
        elif notes is not None and str(notes).strip():
            note_lines = [str(notes)]

        parts: list[str] = []
        if lines:
            parts.append("\n".join(lines))
        if note_lines:
            parts.append("\n".join(note_lines))
        return clean_text("\n\n".join(parts)) or "（页面未提供内容）"
