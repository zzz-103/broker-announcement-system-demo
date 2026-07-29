import csv
import json
from pathlib import Path

import pytest

from broker_app_watch.core.config import BrokerCatalog, load_broker_catalog
from broker_app_watch.llm.client import parse_app_release_response
from broker_app_watch.pipeline.crawl import CrawlSummary
from broker_app_watch.pipeline.refresh import RefreshError, refresh_all
from broker_app_watch.storage.models import AppReleaseAnalysis


class FakeClient:
    def extract(self, *, metadata: dict[str, str], content: str) -> list[AppReleaseAnalysis]:
        assert content
        return [
            AppReleaseAnalysis(
                app_version="12.7.0",
                platform="iOS",
                publish_date="2026-06-26 18:23:23",
                update_type="新功能",
                update_summary="新增交易功能",
                feature_tags=["交易", "未知标签"],
                highlights=["支持新交易入口"],
            )
        ]


def _catalog() -> BrokerCatalog:
    catalog = load_broker_catalog()
    return BrokerCatalog(brokers=[catalog.brokers[0], catalog.brokers[1]])


def _markdown(path: Path, broker_code: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n"
        f"broker_code: {broker_code}\n"
        "broker_name: 国信证券\n"
        "app_name: 国信金太阳\n"
        "source_url: https://example.com/app\n"
        "content_sha256: abc123\n"
        "crawl_time: '2026-07-29T10:00:00+08:00'\n"
        "---\n\n# App 更新\n\n## 版本\n\n新增交易功能\n",
        encoding="utf-8",
    )


def test_parse_app_release_response_accepts_json_fence_and_direct_item() -> None:
    response = parse_app_release_response(
        "```json\n"
        + json.dumps(
            {
                "app_version": "1.0.0",
                "platform": "Android",
                "publish_date": "2026-01-02",
                "update_type": "体验优化",
                "update_summary": "优化体验",
                "feature_tags": ["行情"],
                "highlights": [],
            },
            ensure_ascii=False,
        )
        + "\n```"
    )
    assert response[0].app_version == "1.0.0"


def test_refresh_exports_contract_and_preserves_failed_broker(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw" / "markdown"
    _markdown(raw_dir / "gxzq" / "release.md", "gxzq")
    export_path = tmp_path / "exports" / "app_releases.csv"
    export_path.parent.mkdir()
    with export_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "broker_code",
                "broker_name",
                "app_name",
                "app_version",
                "platform",
                "publish_date",
                "update_type",
                "update_summary",
                "feature_tags",
                "highlights",
            ],
        )
        writer.writeheader()
        writer.writerow(
            {
                "broker_code": "gfzq",
                "broker_name": "广发证券",
                "app_name": "广发易淘金",
                "app_version": "old",
                "platform": "Android",
                "publish_date": "2025-01-01",
                "update_type": "其他",
                "update_summary": "旧记录",
                "feature_tags": "[]",
                "highlights": "[]",
            }
        )

    def fake_crawl(catalog: BrokerCatalog) -> CrawlSummary:
        return CrawlSummary(success={"gxzq": raw_dir / "gxzq" / "release.md"}, failures={"gfzq": "network"})

    result = refresh_all(
        _catalog(),
        client=FakeClient(),
        export_path=export_path,
        raw_dir=raw_dir,
        crawl_runner=fake_crawl,
    )
    assert result.updated_brokers == ("gxzq",)
    assert result.preserved_brokers == ("gfzq",)
    with export_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert {row["broker_code"] for row in rows} == {"gxzq", "gfzq"}
    gxzq = next(row for row in rows if row["broker_code"] == "gxzq")
    assert gxzq["publish_date"] == "2026-06-26"
    assert json.loads(gxzq["feature_tags"]) == ["交易", "其他"]
    assert set(rows[0]) == {
        "broker_code",
        "broker_name",
        "app_name",
        "source_url",
        "content_sha256",
        "crawl_time",
        "markdown_file",
        "processed_at",
        "app_version",
        "platform",
        "publish_date",
        "update_type",
        "update_summary",
        "feature_tags",
        "highlights",
    }


def test_refresh_does_not_replace_when_all_sources_fail(tmp_path: Path) -> None:
    export_path = tmp_path / "app_releases.csv"
    export_path.write_text("old export\n", encoding="utf-8")

    def failed_crawl(catalog: BrokerCatalog) -> CrawlSummary:
        return CrawlSummary(success={}, failures={"gxzq": "network"})

    with pytest.raises(RefreshError):
        refresh_all(
            _catalog(),
            client=FakeClient(),
            export_path=export_path,
            raw_dir=tmp_path / "raw",
            crawl_runner=failed_crawl,
        )
    assert export_path.read_text(encoding="utf-8") == "old export\n"
