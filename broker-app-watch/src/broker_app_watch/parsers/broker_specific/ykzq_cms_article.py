"""Parser for the Yuekai Securities (粤开证券) cms-article download endpoint (mobile only)."""

import json

from bs4 import BeautifulSoup, Tag

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.core.config import BrokerSource
from broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text


class YkzqCmsArticleParser(Parser):
    """从 cms-article 接口内嵌的下载页 HTML 中提取带 .apk 的手机端 App，原样保留正文。"""

    # 手机端判定：软件块内含 .apk 下载，且标题包含以下任一关键词（排除仅提供 apk 的 PC 模拟版）。
    _DEFAULT_NAME_KEYWORDS = ("APP", "app", "安卓", "手机", "苹果", "iOS", "IOS", "Android")
    _MOBILE_LINK_SUFFIX = ".apk"
    _BLOCK_SELECTOR = "div.so-download-cont"
    # 下载按钮文字不含更新信息，收录正文时剔除，改为附上真实下载链接。
    _BUTTON_LABELS = ("点击立即下载", "立即下载", "点击下载")

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        del response
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{source.broker_code} 粤开证券接口返回的内容不是有效 JSON") from exc

        records = self._records(payload)
        if not records:
            raise ValueError(f"{source.broker_code} 粤开证券接口缺少 data.records 列表")

        keywords = source.parser_options.get("mobile_name_keywords") or list(
            self._DEFAULT_NAME_KEYWORDS
        )
        if not isinstance(keywords, list) or not keywords or not all(
            isinstance(item, str) for item in keywords
        ):
            raise ValueError(
                f"{source.broker_code} 的 mobile_name_keywords 配置必须是字符串列表"
            )

        sections: list[ParsedSection] = []
        for record in records:
            content_html = record.get("content") if isinstance(record, dict) else None
            if not isinstance(content_html, str) or not content_html.strip():
                continue
            soup = BeautifulSoup(content_html, "html.parser")
            for block in soup.select(self._BLOCK_SELECTOR):
                heading = block.find("h2")
                if heading is None:
                    continue
                name = heading.get_text(" ", strip=True)
                apk_urls = self._apk_urls(block)
                if not apk_urls or not any(word in name for word in keywords):
                    continue
                heading.extract()
                sections.append(
                    ParsedSection(heading=name, content=self._block_content(block, apk_urls))
                )

        if not sections:
            raise ValueError(
                f"{source.broker_code} 粤开证券接口未解析出手机端 App，来源：{source.source_url}"
            )

        return ParsedDocument(
            title=source.app_name,
            sections=sections,
            source_metadata={"手机端数量": str(len(sections))},
        )

    @staticmethod
    def _records(payload: object) -> list[object]:
        data = payload.get("data") if isinstance(payload, dict) else None
        records = data.get("records") if isinstance(data, dict) else None
        return records if isinstance(records, list) else []

    def _apk_urls(self, block: Tag) -> list[str]:
        urls: list[str] = []
        for anchor in block.find_all("a"):
            href = (anchor.get("href") or "").strip()
            if href.lower().endswith(self._MOBILE_LINK_SUFFIX) and href not in urls:
                urls.append(href)
        return urls

    def _block_content(self, block: Tag, apk_urls: list[str]) -> str:
        lines = [
            line.strip()
            for line in block.get_text("\n", strip=True).splitlines()
            if line.strip() and line.strip() not in self._BUTTON_LABELS
        ]
        parts: list[str] = []
        if lines:
            parts.append("\n".join(lines))
        if apk_urls:
            parts.append("\n".join(f"- 下载：{url}" for url in apk_urls))
        return clean_text("\n\n".join(parts)) or "（页面未提供内容）"
