from __future__ import annotations

from pathlib import Path

from backend.broker_app_watch.collectors.base import CollectedContent
from backend.broker_app_watch.core.config import BrokerCatalog, load_broker_catalog
from backend.broker_app_watch.parsers.base import ParsedDocument
from backend.broker_app_watch.pipeline import crawl as crawl_pipeline


def test_disabled_brokers_are_removed_from_enabled_sources(monkeypatch) -> None:
    monkeypatch.setenv("BAW_DISABLED_BROKERS", "pazq, missing")
    catalog = load_broker_catalog()

    enabled_codes = {source.broker_code for source in catalog.enabled_sources}

    assert "pazq" not in enabled_codes
    assert len(enabled_codes) == len(catalog.enabled_sources)


def test_crawl_all_reports_per_source_progress(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv("BAW_DISABLED_BROKERS", raising=False)
    source = load_broker_catalog().brokers[0]
    catalog = BrokerCatalog(brokers=[source])
    progress: list[str] = []

    monkeypatch.setattr(
        crawl_pipeline,
        "crawl_source",
        lambda current: tmp_path / f"{current.broker_code}.md",
    )

    summary = crawl_pipeline.crawl_all(catalog, progress=progress.append)

    assert summary.failures == {}
    assert set(summary.success) == {source.broker_code}
    assert progress == [
        f"[App Watch] 采集进度 1/1：{source.broker_code} 开始",
        f"[App Watch] 采集进度 1/1：{source.broker_code} 完成",
    ]


def test_crawl_plan_forces_ocr_for_every_qq_app_store_source() -> None:
    catalog = load_broker_catalog()
    qq_sources = [
        source for source in catalog.brokers if "sj.qq.com" in str(source.source_url)
    ]
    assert qq_sources

    plan = crawl_pipeline.build_crawl_plan(BrokerCatalog(brokers=qq_sources))

    assert all(item.parser == "qq_app_detail_ocr" for item in plan)


def test_crawl_source_dispatches_qq_app_store_to_ocr_parser(monkeypatch, tmp_path: Path) -> None:
    source = next(
        source
        for source in load_broker_catalog().brokers
        if "sj.qq.com" in str(source.source_url) and source.parser != "qq_app_detail_ocr"
    )
    used: list[str] = []

    class FakeCollector:
        def __init__(self, _timeout_seconds: float, *, cached: object = None) -> None:
            del cached

        def collect(self, current_source):
            used.append(current_source.parser)
            return CollectedContent(
                source=current_source,
                body="<html></html>",
                status_code=200,
                final_url=str(current_source.source_url),
            )

    class FakeWriter:
        def find_cached(self, _source):
            return None

        def write(self, _source, _document, _response):
            return tmp_path / "result.md"

    class FakeOcrParser:
        def parse(self, _body, current_source, _response):
            used.append(current_source.parser)
            return ParsedDocument(title=current_source.app_name, sections=[], source_metadata={})

    monkeypatch.setattr(crawl_pipeline, "HttpCollector", FakeCollector)
    monkeypatch.setitem(crawl_pipeline.PARSERS, "qq_app_detail_ocr", FakeOcrParser)

    result = crawl_pipeline.crawl_source(source, writer=FakeWriter())

    assert result == tmp_path / "result.md"
    assert used == ["qq_app_detail_ocr", "qq_app_detail_ocr"]
