"""Parser for the Dongguan Securities (东莞证券) querySoftDownload endpoint (mobile only)."""

import json

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.core.config import BrokerSource
from broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text


class DgzqSoftApiParser(Parser):
    """仅保留配置指定客户端类型（adaptClient）的手机端 App，原样收录接口文字。"""

    # 标量字段的展示标题与接口字段，均直接取自接口原值不做改写。
    _SCALAR_FIELDS = (
        ("宣传语", "title"),
        ("简介", "brief"),
        ("更新时间", "softUpdateTime"),
        ("更新说明", "updateExplain"),
        ("MD5", "md5Code"),
    )

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        del response
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{source.broker_code} 东莞证券接口返回的内容不是有效 JSON") from exc

        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list):
            raise ValueError(f"{source.broker_code} 东莞证券接口缺少顶层 data 数组")

        mobile_clients = source.parser_options.get("mobile_clients")
        if not isinstance(mobile_clients, list) or not mobile_clients or not all(
            isinstance(item, str) for item in mobile_clients
        ):
            raise ValueError(
                f"{source.broker_code} 的 mobile_clients 配置必须是 adaptClient 值的字符串列表"
            )
        wanted = {item.strip() for item in mobile_clients}

        sections: list[ParsedSection] = []
        for app in data:
            if not isinstance(app, dict):
                continue
            if str(app.get("adaptClient")).strip() not in wanted:
                continue
            name = str(app.get("downloadName") or source.app_name).strip()
            sections.append(ParsedSection(heading=name, content=self._app_content(app)))

        if not sections:
            raise ValueError(
                f"{source.broker_code} 东莞证券接口未解析出手机端 App，来源：{source.source_url}"
            )

        return ParsedDocument(
            title=source.app_name,
            sections=sections,
            source_metadata={"手机端数量": str(len(sections))},
        )

    def _app_content(self, app: dict[str, object]) -> str:
        lines: list[str] = []
        for label, field in self._SCALAR_FIELDS:
            value = app.get(field)
            if value is not None and str(value).strip():
                lines.append(f"- {label}：{str(value).strip()}")

        for version in app.get("verionList") or []:
            if not isinstance(version, dict):
                continue
            url = version.get("softDownUrl")
            if url is not None and str(url).strip():
                version_type = str(version.get("versionType") or "下载").strip()
                lines.append(f"- 下载（{version_type}）：{str(url).strip()}")

        return clean_text("\n".join(lines)) or "（页面未提供内容）"
