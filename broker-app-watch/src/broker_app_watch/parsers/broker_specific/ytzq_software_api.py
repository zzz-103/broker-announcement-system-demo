"""Parser for Yintai Securities software information API."""

import json

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.core.config import BrokerSource
from broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text


class YtzqSoftwareApiParser(Parser):
    """Select one configured client record for each Yintai mobile App."""

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        del response
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{source.broker_code} 软件接口返回的内容不是有效 JSON") from exc

        app_ids = source.parser_options.get("app_ids")
        if not isinstance(app_ids, dict) or not app_ids or not all(
            isinstance(name, str) and isinstance(soft_id, str)
            for name, soft_id in app_ids.items()
        ):
            raise ValueError(f"{source.broker_code} 的 app_ids 配置必须是字符串映射")
        records = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(records, list):
            raise ValueError(f"{source.broker_code} 软件接口缺失 results 列表")
        by_id = {
            str(item.get("softid")): item
            for item in records
            if isinstance(item, dict) and item.get("softid") is not None
        }

        sections: list[ParsedSection] = []
        for app_name, soft_id in app_ids.items():
            item = by_id.get(soft_id)
            if item is None:
                raise ValueError(
                    f"{source.broker_code} 软件接口缺失 App“{app_name}”（{soft_id}）"
                )
            content = clean_text(str(item.get("content") or ""))
            lines = [
                f"- 客户端：{item.get('title') or app_name}",
                f"- 版本号：{item.get('version') or '（页面未提供）'}",
                f"- 更新日期：{str(item.get('modify_date') or '（页面未提供）')[:10]}",
            ]
            if content:
                lines.extend(("", content))
            sections.append(
                ParsedSection(heading=app_name, content=clean_text("\n".join(lines)))
            )

        return ParsedDocument(
            title=source.app_name,
            sections=sections,
            source_metadata={"手机端数量": str(len(sections))},
        )
