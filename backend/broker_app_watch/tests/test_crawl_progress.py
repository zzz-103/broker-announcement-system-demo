from __future__ import annotations

from pathlib import Path

from backend.broker_app_watch.core.config import BrokerCatalog, load_broker_catalog
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
