"""Parser for the CICC Wealth (中金财富) webAppDown/getMenuList endpoint (mobile only)."""

import json

from markdownify import markdownify

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.core.config import BrokerSource
from broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text


class CiccwmAppDownApiParser(Parser):
    """仅保留下载类型包含配置关键词（安卓/IOS 等）的手机端 App，原样收录接口文字。"""

    _DEFAULT_MOBILE_KEYWORDS = ("安卓", "苹果", "IOS", "ios", "iOS", "Android", "android")

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        del response
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{source.broker_code} 中金财富接口返回的内容不是有效 JSON") from exc

        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list):
            raise ValueError(f"{source.broker_code} 中金财富接口缺少顶层 data 数组")

        keywords = source.parser_options.get("mobile_download_keywords") or list(
            self._DEFAULT_MOBILE_KEYWORDS
        )
        if not isinstance(keywords, list) or not keywords or not all(
            isinstance(item, str) for item in keywords
        ):
            raise ValueError(
                f"{source.broker_code} 的 mobile_download_keywords 配置必须是字符串列表"
            )

        sections: list[ParsedSection] = []
        for category in data:
            if not isinstance(category, dict):
                continue
            for app in category.get("appList") or []:
                if not isinstance(app, dict) or not self._is_mobile(app, keywords):
                    continue
                name = str(app.get("chName") or source.app_name).strip()
                sections.append(ParsedSection(heading=name, content=self._app_content(app)))

        if not sections:
            raise ValueError(
                f"{source.broker_code} 中金财富接口未解析出手机端 App，来源：{source.source_url}"
            )

        return ParsedDocument(
            title=source.app_name,
            sections=sections,
            source_metadata={"手机端数量": str(len(sections))},
        )

    @staticmethod
    def _is_mobile(app: dict[str, object], keywords: list[str]) -> bool:
        for entry in app.get("downInfo") or []:
            if not isinstance(entry, dict):
                continue
            entry_type = str(entry.get("type") or "")
            if any(keyword in entry_type for keyword in keywords):
                return True
        return False

    def _app_content(self, app: dict[str, object]) -> str:
        lines: list[str] = []
        version = app.get("versionName")
        if version is not None and str(version).strip():
            lines.append(f"- 版本：{str(version).strip()}")
        published = app.get("showPublish") or app.get("createTime")
        if published is not None and str(published).strip():
            lines.append(f"- 更新时间：{str(published).strip()}")

        for entry in app.get("downInfo") or []:
            if not isinstance(entry, dict):
                continue
            url = entry.get("url")
            if url is not None and str(url).strip():
                entry_type = str(entry.get("type") or "下载").strip()
                lines.append(f"- 下载（{entry_type}）：{str(url).strip()}")

        parts: list[str] = []
        if lines:
            parts.append("\n".join(lines))

        description = app.get("description")
        if description is not None and str(description).strip():
            introduction = markdownify(str(description), heading_style="ATX", bullets="-").strip()
            if introduction:
                parts.append(f"应用介绍：\n\n{introduction}")

        return clean_text("\n\n".join(parts)) or "（页面未提供内容）"
