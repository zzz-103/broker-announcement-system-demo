"""Parser for Ping An Securities (平安证券) image-only activity pages via OCR."""

import json
from collections.abc import Callable

from backend.broker_app_watch.collectors.base import CollectedContent
from backend.broker_app_watch.collectors.http_collector import fetch_binary
from backend.broker_app_watch.core.config import BrokerSource
from backend.broker_app_watch.parsers.base import ParsedDocument, ParsedSection, Parser, clean_text

ImageFetcher = Callable[[str], bytes]
OcrReader = Callable[[bytes], list[tuple[str, float]]]

_DEFAULT_LIST_PATH = ("results", "list")
_OCR_ENGINE = None


def _default_ocr_reader() -> OcrReader:
    """Build a RapidOCR-backed reader, importing the heavy engine lazily."""

    global _OCR_ENGINE
    if _OCR_ENGINE is None:
        from rapidocr_onnxruntime import RapidOCR

        _OCR_ENGINE = RapidOCR()
    engine = _OCR_ENGINE

    def _read(image_bytes: bytes) -> list[tuple[str, float]]:
        result, _elapse = engine(image_bytes)
        if not result:
            return []
        return [(str(text), float(score)) for _box, text, score in result]

    return _read


class PinganImageOcrParser(Parser):
    """平安证券活动页正文以图片呈现，下载图片后 OCR 提取原始文字，不做改写或摘要。"""

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
        del response
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{source.broker_code} 平安证券接口返回的内容不是有效 JSON") from exc

        list_path = source.parser_options.get("list_path") or list(_DEFAULT_LIST_PATH)
        if not isinstance(list_path, list) or not all(isinstance(k, str) for k in list_path):
            raise ValueError(f"{source.broker_code} 的 list_path 配置必须是字符串列表")

        image_urls = self._navigate(payload, list_path)
        if not isinstance(image_urls, list) or not image_urls:
            raise ValueError(
                f"{source.broker_code} 平安证券接口未返回图片列表，来源：{source.source_url}"
            )

        min_score = float(source.parser_options.get("min_score", 0.0))
        sections: list[ParsedSection] = []
        for index, image_url in enumerate(image_urls, start=1):
            if not isinstance(image_url, str) or not image_url.strip():
                raise ValueError(f"{source.broker_code} 图片列表第 {index} 项不是有效 URL")
            lines = self._read_image(self._fetch_image(image_url.strip()), min_score)
            content = clean_text("\n".join(lines)) or "（图片未识别到文字）"
            sections.append(ParsedSection(heading=f"图片 {index}", content=content))

        metadata = {
            "image_count": str(len(image_urls)),
            "image_urls": ", ".join(str(url) for url in image_urls),
            "ocr_engine": "rapidocr-onnxruntime",
        }
        return ParsedDocument(
            title=source.app_name,
            sections=sections,
            source_metadata=metadata,
        )

    def _read_image(self, image_bytes: bytes, min_score: float) -> list[str]:
        if self._ocr_reader is None:
            self._ocr_reader = _default_ocr_reader()
        return [
            text.strip()
            for text, score in self._ocr_reader(image_bytes)
            if text.strip() and score >= min_score
        ]

    @staticmethod
    def _navigate(payload: object, path: list[str]) -> object:
        node = payload
        for key in path:
            if not isinstance(node, dict) or key not in node:
                return None
            node = node[key]
        return node
