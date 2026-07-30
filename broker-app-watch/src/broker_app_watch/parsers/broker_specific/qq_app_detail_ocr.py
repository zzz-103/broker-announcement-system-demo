"""Tencent MyApp detail parser with OCR for configured preview screenshots."""

from collections.abc import Callable

from bs4 import BeautifulSoup

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.collectors.http_collector import fetch_binary
from broker_app_watch.core.config import BrokerSource
from broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser
from broker_app_watch.parsers.broker_specific.pingan_image_ocr import (
    OcrReader,
    _default_ocr_reader,
)
from broker_app_watch.parsers.generic_html import GenericHtmlParser

ImageFetcher = Callable[[str], bytes]


class QqAppDetailOcrParser(Parser):
    """Keep 简介/详细信息 and append original text recognized from preview images."""

    def __init__(
        self,
        image_fetcher: ImageFetcher | None = None,
        ocr_reader: OcrReader | None = None,
    ) -> None:
        self._fetch_image = image_fetcher or fetch_binary
        self._ocr_reader = ocr_reader

    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        document = GenericHtmlParser().parse(body, source, response)
        alt_text = source.parser_options.get("screenshot_alt")
        limit = source.parser_options.get("screenshot_limit", 1)
        min_score = float(source.parser_options.get("min_score", 0.0))
        if not isinstance(alt_text, str) or not alt_text.strip():
            raise ValueError(f"{source.broker_code} 的 screenshot_alt 配置必须是字符串")
        if not isinstance(limit, int) or limit < 1:
            raise ValueError(f"{source.broker_code} 的 screenshot_limit 配置必须是正整数")

        soup = BeautifulSoup(body, "html.parser")
        image_urls: list[str] = []
        for image in soup.find_all("img"):
            if image.get("alt", "").strip() != alt_text.strip():
                continue
            src = image.get("src")
            if isinstance(src, str) and src.strip() and src.strip() not in image_urls:
                image_urls.append(src.strip())
            if len(image_urls) >= limit:
                break
        if not image_urls:
            raise ValueError(
                f"{source.broker_code} 缺失预览截图“{alt_text}”，来源：{source.source_url}"
            )

        if self._ocr_reader is None:
            self._ocr_reader = _default_ocr_reader()
        for index, image_url in enumerate(image_urls, start=1):
            recognized = [
                text.strip()
                for text, score in self._ocr_reader(self._fetch_image(image_url))
                if text.strip() and score >= min_score
            ]
            document.sections.append(
                ParsedSection(
                    heading=f"截图文字 {index}",
                    content="\n".join(recognized) or "（图片未识别到文字）",
                )
            )
        document.source_metadata.update(
            {
                "screenshot_count": str(len(image_urls)),
                "screenshot_urls": ", ".join(image_urls),
                "ocr_engine": "rapidocr-onnxruntime",
            }
        )
        return document
