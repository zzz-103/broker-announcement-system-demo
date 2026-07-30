"""Parser for East Asia Qianhai Securities software API."""

import json

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.core.config import BrokerSource
from broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text


def _repair_utf8_mojibake(value: object) -> str:
    text = str(value or "")
    try:
        return text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


class EasecSoftwareApiParser(Parser):
    """Extract the configured mobile App from the public software API."""

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        del response
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{source.broker_code} 软件接口返回的内容不是有效 JSON") from exc
        item_id = str(source.parser_options.get("item_id") or "")
        records = payload.get("results") if isinstance(payload, dict) else None
        if not item_id or not isinstance(records, list):
            raise ValueError(f"{source.broker_code} 缺少 item_id 或 results 列表")
        item = next(
            (
                record
                for record in records
                if isinstance(record, dict) and str(record.get("id")) == item_id
            ),
            None,
        )
        if item is None:
            raise ValueError(f"{source.broker_code} 软件接口未找到 App（{item_id}）")

        app_title = _repair_utf8_mojibake(item.get("file_name"))
        description = _repair_utf8_mojibake(item.get("description"))
        developer = _repair_utf8_mojibake(item.get("developer"))
        lines = [
            f"- 客户端：{app_title or source.app_name}",
            f"- 版本号：{item.get('android_version') or item.get('iso_version') or '（页面未提供）'}",
            f"- 更新日期：{str(item.get('software_time') or '（页面未提供）')[:10]}",
            f"- 大小：{item.get('file_size') or item.get('iso_size') or '（页面未提供）'}M",
        ]
        if developer:
            lines.append(f"- 开发者：{developer}")
        if description:
            lines.extend(("", description))
        return ParsedDocument(
            title=source.app_name,
            sections=[
                ParsedSection(
                    heading=source.app_name, content=clean_text("\n".join(lines))
                )
            ],
            source_metadata={"software_id": item_id},
        )
