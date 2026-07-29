"""Parser for the Guosen software JSON endpoint."""

import json

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.core.config import BrokerSource
from broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text


class GuosenSoftwareApiParser(Parser):
    """Select one configured software item and preserve its three text fields."""

    _FIELD_MAPPING = (
        ("基本介绍", "swSummary"),
        ("内容提要", "newFeatureFull"),
        ("更新", "newFeature"),
    )

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        del response
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{source.broker_code} 国信接口返回的内容不是有效 JSON") from exc

        items = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            raise ValueError(f"{source.broker_code} 国信接口缺少顶层 data 数组")

        item_id = source.parser_options.get("item_id")
        if item_id is None:
            raise ValueError(f"{source.broker_code} 缺少 parser_options.item_id 配置")
        target = next((item for item in items if str(item.get("id")) == str(item_id)), None)
        if target is None:
            raise ValueError(
                f"{source.broker_code} 国信接口未找到指定软件 id={item_id}，来源：{source.source_url}"
            )

        sections = [
            ParsedSection(
                heading=heading,
                content=self._field_content(target.get(field)),
            )
            for heading, field in self._FIELD_MAPPING
        ]
        metadata = {}
        for metadata_key, field in (
            ("software_id", "id"),
            ("page_update_time", "softUpdateDate"),
            ("labels", "swLable"),
        ):
            if field in target and target[field] is not None:
                metadata[metadata_key] = self._metadata_value(target[field])

        title = target.get("swName") or source.app_name
        return ParsedDocument(
            title=str(title),
            sections=sections,
            source_metadata=metadata,
        )

    @staticmethod
    def _field_content(value: object) -> str:
        if value is None or not str(value).strip():
            return "（页面未提供内容）"
        return clean_text(str(value))

    @staticmethod
    def _metadata_value(value: object) -> str:
        if isinstance(value, str):
            return value
        return json.dumps(value, ensure_ascii=False)
