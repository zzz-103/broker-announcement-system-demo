"""Small HTTP-to-Markdown crawl pipeline."""

import logging
from dataclasses import dataclass
from collections.abc import Callable
from pathlib import Path

from broker_app_watch.collectors.http_collector import HttpCollector
from broker_app_watch.core.config import BrokerCatalog, BrokerSource, load_settings
from broker_app_watch.parsers.base import ParsedDocument, Parser
from broker_app_watch.parsers.broker_specific.cgws_download_html import CgwsDownloadHtmlParser
from broker_app_watch.parsers.broker_specific.ciccwm_appdown_api import CiccwmAppDownApiParser
from broker_app_watch.parsers.broker_specific.cmschina_config_json import (
    CmschinaConfigJsonParser,
)
from broker_app_watch.parsers.broker_specific.dgzq_soft_api import DgzqSoftApiParser
from broker_app_watch.parsers.broker_specific.essence_softwares_api import (
    EssenceSoftwaresApiParser,
)
from broker_app_watch.parsers.broker_specific.easec_software_api import (
    EasecSoftwareApiParser,
)
from broker_app_watch.parsers.broker_specific.guosen_software_api import GuosenSoftwareApiParser
from broker_app_watch.parsers.broker_specific.pingan_image_ocr import PinganImageOcrParser
from broker_app_watch.parsers.broker_specific.qq_app_detail_ocr import QqAppDetailOcrParser
from broker_app_watch.parsers.broker_specific.selected_apps_html import (
    SelectedAppsHtmlParser,
)
from broker_app_watch.parsers.broker_specific.ytzq_software_api import (
    YtzqSoftwareApiParser,
)
from broker_app_watch.parsers.broker_specific.ykzq_cms_article import YkzqCmsArticleParser
from broker_app_watch.parsers.generic_html import GenericHtmlParser
from broker_app_watch.storage.markdown_writer import MarkdownWriter


LOGGER = logging.getLogger(__name__)
PARSERS: dict[str, type[Parser]] = {
    "generic_html": GenericHtmlParser,
    "guosen_software_api": GuosenSoftwareApiParser,
    "cmschina_config_json": CmschinaConfigJsonParser,
    "pingan_image_ocr": PinganImageOcrParser,
    "essence_softwares_api": EssenceSoftwaresApiParser,
    "dgzq_soft_api": DgzqSoftApiParser,
    "ciccwm_appdown_api": CiccwmAppDownApiParser,
    "cgws_download_html": CgwsDownloadHtmlParser,
    "ykzq_cms_article": YkzqCmsArticleParser,
    "selected_apps_html": SelectedAppsHtmlParser,
    "ytzq_software_api": YtzqSoftwareApiParser,
    "qq_app_detail_ocr": QqAppDetailOcrParser,
    "easec_software_api": EasecSoftwareApiParser,
}


@dataclass(frozen=True, slots=True)
class CrawlPlanItem:
    broker_code: str
    app_name: str
    source_type: str
    parser: str


@dataclass(frozen=True, slots=True)
class CrawlSummary:
    success: dict[str, Path]
    failures: dict[str, str]


def build_crawl_plan(catalog: BrokerCatalog) -> list[CrawlPlanItem]:
    """Build a side-effect-free plan from enabled configuration entries."""

    return [
        CrawlPlanItem(
            broker_code=source.broker_code,
            app_name=source.app_name,
            source_type=source.source_type,
            parser=source.parser,
        )
        for source in catalog.enabled_sources
    ]


def crawl_source(
    source: BrokerSource,
    *,
    timeout_seconds: float | None = None,
    writer: MarkdownWriter | None = None,
) -> Path:
    parser_type = PARSERS.get(source.parser)
    if parser_type is None:
        raise ValueError(f"不支持的解析器：{source.parser}")
    settings = load_settings()
    output_writer = writer or MarkdownWriter()
    cached = output_writer.find_cached(source)
    collector = HttpCollector(
        timeout_seconds or settings.request_timeout_seconds,
        cached=cached,
    )
    response = collector.collect(source)
    if response.metadata.get("not_modified") == "true" and cached is not None:
        return cached.path
    document: ParsedDocument = parser_type().parse(response.body, source, response)
    return output_writer.write(source, document, response)


def crawl_broker(catalog: BrokerCatalog, broker_code: str) -> Path:
    """Crawl one enabled broker source."""

    source = next(
        (item for item in catalog.brokers if item.broker_code == broker_code),
        None,
    )
    if source is None:
        raise ValueError(f"配置中没有券商代码：{broker_code}")
    if not source.enabled:
        raise ValueError(f"券商来源未启用：{broker_code}")
    return crawl_source(source)


def crawl_all(
    catalog: BrokerCatalog,
    *,
    progress: Callable[[str], None] | None = None,
) -> CrawlSummary:
    """Crawl all enabled sources and continue after an individual failure."""

    success: dict[str, Path] = {}
    failures: dict[str, str] = {}
    sources = catalog.enabled_sources
    total = len(sources)
    for index, source in enumerate(sources, start=1):
        if progress:
            progress(
                f"[App Watch] 采集进度 {index}/{total}：{source.broker_code} 开始"
            )
        try:
            success[source.broker_code] = crawl_source(source)
            if progress:
                progress(
                    f"[App Watch] 采集进度 {index}/{total}：{source.broker_code} 完成"
                )
        except Exception as exc:  # noqa: BLE001 - one source must not stop --all
            failures[source.broker_code] = str(exc)
            LOGGER.error("处理 %s 失败：%s", source.broker_code, type(exc).__name__)
            if progress:
                progress(
                    f"[App Watch] 采集进度 {index}/{total}：{source.broker_code} 失败："
                    f"{type(exc).__name__}"
                )
    return CrawlSummary(success=success, failures=failures)
