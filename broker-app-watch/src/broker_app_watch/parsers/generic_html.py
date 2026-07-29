"""Generic section-based parser for static HTML pages."""

from bs4 import BeautifulSoup, NavigableString, Tag
from markdownify import markdownify

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.core.config import BrokerSource
from broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text


class GenericHtmlParser(Parser):
    """Extract configured heading sections and exclude the rest of the page."""

    _REMOVED_TAGS = ("script", "style", "noscript", "svg")
    _EXCLUDED_SECTION_HEADINGS = {
        "用户评论",
        "如何在电脑上下载并使用",
        "你可能还喜欢",
        "厂商其他应用",
        "热门分类",
        "网友热搜",
    }

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        del response
        headings = source.parser_options.get("section_headings", [])
        if not isinstance(headings, list) or not all(
            isinstance(item, str) for item in headings
        ):
            raise ValueError(f"{source.broker_code} 的 section_headings 配置必须是字符串列表")

        soup = BeautifulSoup(body, "html.parser")
        for tag in soup.find_all(self._REMOVED_TAGS):
            tag.decompose()

        all_headings = soup.find_all([f"h{level}" for level in range(1, 7)])
        sections: list[ParsedSection] = []
        for requested_heading in headings:
            heading_node = next(
                (
                    node
                    for node in all_headings
                    if node.get_text(" ", strip=True) == requested_heading.strip()
                ),
                None,
            )
            if heading_node is None:
                raise ValueError(
                    f"{source.broker_code} 缺失标题“{requested_heading}”，来源：{source.source_url}"
                )

            content = self._section_content(heading_node)
            sections.append(ParsedSection(heading=requested_heading.strip(), content=content))

        return ParsedDocument(
            title=source.app_name,
            sections=sections,
            source_metadata={},
        )

    def _section_content(self, heading_node: Tag) -> str:
        level = int(heading_node.name[1:])
        chunks: list[str] = []
        for node in heading_node.next_siblings:
            if isinstance(node, Tag) and node.name in {f"h{i}" for i in range(1, 7)}:
                heading_text = node.get_text(" ", strip=True)
                if int(node.name[1:]) <= level or heading_text in self._EXCLUDED_SECTION_HEADINGS:
                    break
            if isinstance(node, NavigableString):
                if node.strip():
                    chunks.append(str(node))
            elif isinstance(node, Tag):
                converted = markdownify(str(node), heading_style="ATX", bullets="-")
                if converted.strip():
                    chunks.append(converted)
        return clean_text("\n\n".join(chunks)) or "（页面未提供内容）"
