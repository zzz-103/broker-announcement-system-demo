"""Parser for the Great Wall Securities (长城证券) software download page (mobile only)."""

import re

from bs4 import BeautifulSoup

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.core.config import BrokerSource
from broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text


class CgwsDownloadHtmlParser(Parser):
    """从软件下载页按配置的 App 名称提取手机端条目，原样保留更新日期与软件介绍。"""

    _REMOVED_TAGS = ("script", "style", "noscript", "svg")
    _INTRO_MARKER = "软件介绍："
    _DATE_PATTERN = re.compile(r"(\d{4}-\d{2}-\d{2})\s*更新")
    # 页面把下载按钮文字与正文混排，收录简介时去掉结尾的按钮标签。
    _TRAILING_LINK_LABELS = re.compile(
        r"(?:\s*(?:点击立即下载|立即下载|IOS下载|android下载|安卓下载))+\s*$"
    )

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        del response
        app_names = source.parser_options.get("app_names")
        if not isinstance(app_names, list) or not app_names or not all(
            isinstance(item, str) for item in app_names
        ):
            raise ValueError(f"{source.broker_code} 的 app_names 配置必须是非空字符串列表")

        soup = BeautifulSoup(body, "html.parser")
        for tag in soup.find_all(self._REMOVED_TAGS):
            tag.decompose()

        sections: list[ParsedSection] = []
        for name in app_names:
            name = name.strip()
            block_text = self._find_app_block(soup, name)
            if block_text is None:
                raise ValueError(
                    f"{source.broker_code} 缺失手机端 App“{name}”，来源：{source.source_url}"
                )
            sections.append(ParsedSection(heading=name, content=self._app_content(block_text)))

        return ParsedDocument(
            title=source.app_name,
            sections=sections,
            source_metadata={"手机端数量": str(len(sections))},
        )

    def _find_app_block(self, soup: BeautifulSoup, name: str) -> str | None:
        """返回标题区（软件介绍前）出现该 App 名且带更新日期的最小块文本。"""

        best: str | None = None
        for tag in soup.find_all(["div", "li", "dl"]):
            text = tag.get_text(" ", strip=True)
            if self._INTRO_MARKER not in text or not self._DATE_PATTERN.search(text):
                continue
            head = text.split(self._INTRO_MARKER, 1)[0]
            if name not in head:
                continue
            if best is None or len(text) < len(best):
                best = text
        return best

    def _app_content(self, text: str) -> str:
        lines: list[str] = []
        date_match = self._DATE_PATTERN.search(text)
        if date_match:
            lines.append(f"- 更新日期：{date_match.group(1)}")

        platforms = [
            label
            for label, needles in (("iOS", ("IOS", "iOS")), ("Android", ("android", "安卓")))
            if any(needle in text for needle in needles)
        ]
        if platforms:
            lines.append(f"- 支持平台：{'、'.join(platforms)}")

        intro = text.split(self._INTRO_MARKER, 1)[1] if self._INTRO_MARKER in text else ""
        intro = self._TRAILING_LINK_LABELS.sub("", intro).strip()

        parts: list[str] = []
        if lines:
            parts.append("\n".join(lines))
        if intro:
            parts.append(f"软件介绍：{intro}")
        return clean_text("\n\n".join(parts)) or "（页面未提供内容）"
