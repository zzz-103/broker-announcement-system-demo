"""Config-driven parser for selected App cards on broker download pages."""

import re

from bs4 import BeautifulSoup, Tag
from markdownify import markdownify

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.core.config import BrokerSource
from broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text


class SelectedAppsHtmlParser(Parser):
    """Extract only configured App cards and keep one card per App."""

    _REMOVED_TAGS = ("script", "style", "noscript", "svg", "canvas")

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        del response
        options = source.parser_options
        app_names = options.get("app_names")
        card_selector = options.get("card_selector")
        name_selector = options.get("name_selector")
        content_selector = options.get("content_selector")
        excluded_prefixes = options.get("excluded_line_prefixes", [])
        if not isinstance(app_names, list) or not app_names or not all(
            isinstance(item, str) and item.strip() for item in app_names
        ):
            raise ValueError(f"{source.broker_code} 的 app_names 配置必须是非空字符串列表")
        if not all(
            isinstance(value, str) and value.strip()
            for value in (card_selector, name_selector, content_selector)
        ):
            raise ValueError(
                f"{source.broker_code} 的 card/name/content_selector 配置必须是字符串"
            )
        if not isinstance(excluded_prefixes, list) or not all(
            isinstance(item, str) for item in excluded_prefixes
        ):
            raise ValueError(
                f"{source.broker_code} 的 excluded_line_prefixes 配置必须是字符串列表"
            )

        soup = BeautifulSoup(body, "html.parser")
        for tag in soup.find_all(self._REMOVED_TAGS):
            tag.decompose()

        cards = soup.select(card_selector)
        sections: list[ParsedSection] = []
        for requested_name in app_names:
            card = self._find_card(cards, name_selector, requested_name)
            if card is None:
                raise ValueError(
                    f"{source.broker_code} 缺失手机端 App“{requested_name}”，"
                    f"来源：{source.source_url}"
                )
            content_node = card if content_selector == ":self" else card.select_one(
                content_selector
            )
            if content_node is None:
                raise ValueError(
                    f"{source.broker_code} 的 App“{requested_name}”缺失正文区域"
                )
            content = markdownify(
                str(content_node), heading_style="ATX", bullets="-"
            ).strip()
            content = self._remove_excluded_lines(content, excluded_prefixes)
            sections.append(
                ParsedSection(
                    heading=requested_name.strip(),
                    content=clean_text(content) or "（页面未提供内容）",
                )
            )

        return ParsedDocument(
            title=source.app_name,
            sections=sections,
            source_metadata={"手机端数量": str(len(sections))},
        )

    @staticmethod
    def _find_card(
        cards: list[Tag], name_selector: str, requested_name: str
    ) -> Tag | None:
        expected = "".join(requested_name.split())
        for card in cards:
            name_node = card.select_one(name_selector)
            if name_node is None:
                continue
            actual = "".join(name_node.get_text(" ", strip=True).split())
            if expected in actual:
                return card
        return None

    @staticmethod
    def _remove_excluded_lines(content: str, prefixes: list[str]) -> str:
        if not prefixes:
            return content
        for prefix in prefixes:
            content = re.sub(
                rf"{re.escape(prefix)}.*?(?=安卓版：|Android版：|HarmonyOS|$)",
                "",
                content,
                flags=re.MULTILINE,
            )
        return "\n".join(
            line
            for line in content.splitlines()
            if not any(line.strip().startswith(prefix) for prefix in prefixes)
        ).strip()
