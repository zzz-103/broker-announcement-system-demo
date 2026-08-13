import csv
import json
from pathlib import Path

import pytest

from backend.broker_app_watch.pipeline import refresh as refresh_module
from backend.broker_app_watch.core.config import BrokerCatalog, load_broker_catalog
from backend.broker_app_watch.llm.client import parse_app_release_response
from backend.broker_app_watch.pipeline.crawl import CrawlSummary
from backend.broker_app_watch.pipeline.refresh import RefreshError, refresh_all
from backend.broker_app_watch.storage.markdown_writer import MarkdownWriter
from backend.broker_app_watch.collectors.base import CollectedContent
from backend.broker_app_watch.parsers.base import ParsedDocument, ParsedSection
from backend.broker_app_watch.storage.models import APP_RELEASE_CSV_COLUMNS, AppReleaseAnalysis


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


def test_refresh_keeps_history_and_only_removes_same_body_hash(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw" / "markdown"
    first = raw_dir / "gxzq" / "20260701_release.md"
    duplicate = raw_dir / "gxzq" / "20260702_duplicate.md"
    different = raw_dir / "gxzq" / "20260703_release.md"
    _markdown(first, "gxzq")
    duplicate.parent.mkdir(parents=True, exist_ok=True)
    duplicate.write_text(first.read_text(encoding="utf-8").replace("10:00:00", "11:00:00"), encoding="utf-8")
    different.parent.mkdir(parents=True, exist_ok=True)
    different.write_text(first.read_text(encoding="utf-8") + "\n## 另一版\n\n修复问题\n", encoding="utf-8")
    export_path = tmp_path / "exports" / "app_releases.csv"

    def fake_crawl(catalog: BrokerCatalog) -> CrawlSummary:
        return CrawlSummary(success={"gxzq": first}, failures={})

    result = refresh_all(
        _catalog(),
        client=FakeClient(),
        export_path=export_path,
        raw_dir=raw_dir,
        crawl_runner=fake_crawl,
    )
    assert result.blocked is False
    with export_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 2
    assert len({row["content_sha256"] for row in rows}) == 2
    representative = next(row for row in rows if row["content_sha256"] == rows[0]["content_sha256"])
    assert representative["crawl_time"].endswith("11:00:00+08:00")


def test_refresh_collapses_same_version_but_keeps_distinct_versions(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw" / "markdown"
    path = raw_dir / "gxzq" / "release.md"
    _markdown(path, "gxzq")
    export_path = tmp_path / "exports" / "app_releases.csv"

    class MultiUpdateClient:
        def extract(self, *, metadata: dict[str, str], content: str) -> list[AppReleaseAnalysis]:
            return [
                AppReleaseAnalysis(app_version="1.0.0", publish_date="2026-07-29", update_summary="行情升级"),
                AppReleaseAnalysis(app_version="1.0.0", publish_date="2026-07-29", update_summary="交易流程优化"),
                AppReleaseAnalysis(app_version="2.0.0", publish_date="2026-07-29", update_summary="新增两融入口"),
            ]

    def fake_crawl(catalog: BrokerCatalog) -> CrawlSummary:
        return CrawlSummary(success={"gxzq": path}, failures={})

    refresh_all(
        _catalog(),
        client=MultiUpdateClient(),
        export_path=export_path,
        raw_dir=raw_dir,
        crawl_runner=fake_crawl,
    )
    with export_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 2
    assert {row["app_version"] for row in rows} == {"1.0.0", "2.0.0"}
    assert {row["update_summary"] for row in rows} == {"交易流程优化", "新增两融入口"}


def test_refresh_failure_gate_keeps_previous_csv(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw" / "markdown"
    path = raw_dir / "gxzq" / "release.md"
    _markdown(path, "gxzq")
    export_path = tmp_path / "exports" / "app_releases.csv"
    export_path.parent.mkdir(parents=True)
    with export_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(APP_RELEASE_CSV_COLUMNS))
        writer.writeheader()
        writer.writerow(
            {
                "broker_code": "gxzq",
                "broker_name": "国信证券",
                "app_name": "国信金太阳",
                "source_url": "https://example.com/app",
                "content_sha256": "old",
                "crawl_time": "2026-06-01T10:00:00+08:00",
                "markdown_file": "old.md",
                "processed_at": "2026-06-01T10:00:00+08:00",
                "app_version": "1.0.0",
                "platform": "Android",
                "publish_date": "2026-06-01",
                "update_type": "其他",
                "update_summary": "旧记录",
                "feature_tags": "[]",
                "highlights": "[]",
            }
        )
    before = export_path.read_bytes()

    class FailingClient:
        def extract(self, *, metadata: dict[str, str], content: str) -> list[AppReleaseAnalysis]:
            raise RuntimeError("simulated failure")

    def fake_crawl(catalog: BrokerCatalog) -> CrawlSummary:
        return CrawlSummary(success={"gxzq": path}, failures={})

    result = refresh_all(
        _catalog(),
        client=FailingClient(),
        export_path=export_path,
        raw_dir=raw_dir,
        crawl_runner=fake_crawl,
    )
    assert result.blocked is True
    assert export_path.read_bytes() == before


def test_refresh_blocks_at_exactly_fifty_percent_failure_rate(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw" / "markdown"
    path = raw_dir / "gxzq" / "release.md"
    _markdown(path, "gxzq")
    path.write_text(
        path.read_text(encoding="utf-8").replace("source_url: https://example.com/app", "parser: essence_softwares_api\nsource_url: https://example.com/app")
        + "\n## 另一 App\n\n新增功能\n",
        encoding="utf-8",
    )

    class HalfFailClient:
        def extract(self, *, metadata: dict[str, str], content: str) -> list[AppReleaseAnalysis]:
            if metadata["unit_app_name"] == "另一 App":
                raise RuntimeError("simulated failure")
            return [AppReleaseAnalysis(app_version="1.0.0", update_summary="ok")]

    def fake_crawl(catalog: BrokerCatalog) -> CrawlSummary:
        return CrawlSummary(success={"gxzq": path}, failures={})

    with pytest.raises(RefreshError):
        refresh_all(
            _catalog(),
            client=HalfFailClient(),
            export_path=tmp_path / "exports" / "app_releases.csv",
            raw_dir=raw_dir,
            crawl_runner=fake_crawl,
        )


def test_refresh_skips_llm_for_a_body_already_structured(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw" / "markdown"
    path = raw_dir / "gxzq" / "release.md"
    _markdown(path, "gxzq")
    export_path = tmp_path / "exports" / "app_releases.csv"
    calls = 0

    class CountingClient:
        def extract(self, *, metadata: dict[str, str], content: str) -> list[AppReleaseAnalysis]:
            nonlocal calls
            calls += 1
            return [AppReleaseAnalysis(app_version="1.0.0", update_summary="ok")]

    def fake_crawl(catalog: BrokerCatalog) -> CrawlSummary:
        return CrawlSummary(success={"gxzq": path}, failures={})

    refresh_all(
        _catalog(),
        client=CountingClient(),
        export_path=export_path,
        raw_dir=raw_dir,
        crawl_runner=fake_crawl,
    )
    second = refresh_all(
        _catalog(),
        client=CountingClient(),
        export_path=export_path,
        raw_dir=raw_dir,
        crawl_runner=fake_crawl,
    )

    assert calls == 1
    assert second.blocked is False
    assert second.failure_rate == 0


def test_refresh_filters_low_value_snapshot_and_llm_summary(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw" / "markdown"
    path = raw_dir / "gxzq" / "snapshot.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n"
        "broker_code: gxzq\n"
        "broker_name: 国信证券\n"
        "app_name: 国信金太阳\n"
        "source_url: https://example.com/app\n"
        "app_version: 9.7.0\n"
        "---\n\n"
        "# App 信息\n\n"
        "版本：9.7.0\n"
        "运行环境：需要 iOS 12.0 或更高版本\n"
        "支持语言：中文\n"
        "文件大小：88 MB\n"
        "下载地址：https://example.com/app.ipa\n"
        "MD5：0123456789abcdef0123456789abcdef\n"
        "国信金太阳是一款提供行情和交易服务的软件。\n",
        encoding="utf-8",
    )
    export_path = tmp_path / "exports" / "app_releases.csv"
    captured: list[tuple[dict[str, str], str]] = []

    class LowValueClient:
        def extract(self, *, metadata: dict[str, str], content: str) -> list[AppReleaseAnalysis]:
            captured.append((metadata, content))
            return [
                AppReleaseAnalysis(
                    app_version="9.7.0",
                    update_summary="支持 iOS 12.0",
                    highlights=["MD5：0123456789abcdef0123456789abcdef"],
                )
            ]

    def fake_crawl(catalog: BrokerCatalog) -> CrawlSummary:
        return CrawlSummary(success={"gxzq": path}, failures={})

    refresh_all(
        _catalog(),
        client=LowValueClient(),
        export_path=export_path,
        raw_dir=raw_dir,
        crawl_runner=fake_crawl,
    )
    with export_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 1
    assert rows[0]["update_summary"] == ""
    assert json.loads(rows[0]["highlights"]) == []
    assert captured
    metadata, llm_content = captured[0]
    assert metadata["deterministic_version"] == "9.7.0"
    assert "版本证据：9.7.0" in llm_content
    assert "平台证据：iOS" in llm_content
    for forbidden in ("运行环境", "支持语言", "文件大小", "下载地址", "MD5", "是一款"):
        assert forbidden not in llm_content


def test_refresh_uses_only_meaningful_deterministic_fallback(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw" / "markdown"
    path = raw_dir / "gxzq" / "release.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n"
        "broker_code: gxzq\n"
        "broker_name: 国信证券\n"
        "app_name: 国信金太阳\n"
        "source_url: https://example.com/app\n"
        "---\n\n"
        "版本：9.7.1\n"
        "发布日期：2026-07-30\n"
        "优化登录流程，提升登录稳定性\n"
        "运行环境：需要 Android 10 及以上\n",
        encoding="utf-8",
    )
    export_path = tmp_path / "exports" / "app_releases.csv"

    class EmptySummaryClient:
        def extract(self, *, metadata: dict[str, str], content: str) -> list[AppReleaseAnalysis]:
            return [
                AppReleaseAnalysis(
                    app_version="9.7.1",
                    update_summary="",
                    highlights=["运行环境：需要 Android 10 及以上"],
                )
            ]

    def fake_crawl(catalog: BrokerCatalog) -> CrawlSummary:
        return CrawlSummary(success={"gxzq": path}, failures={})

    refresh_all(
        _catalog(),
        client=EmptySummaryClient(),
        export_path=export_path,
        raw_dir=raw_dir,
        crawl_runner=fake_crawl,
    )
    with export_path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert rows[0]["update_summary"] == "优化登录流程，提升登录稳定性"
    assert json.loads(rows[0]["highlights"]) == ["优化登录流程，提升登录稳定性"]


def test_llm_content_keeps_named_store_features_but_not_download_metadata() -> None:
    prompt = refresh_module._prepare_llm_content(
        "- 版本：9.30.20\n- 平台：iOS\n更新说明：\n"
        "手动下单慢？——丰富「智能订单」助你一键智投。\n"
        "- 文件大小：180 MB\n"
    )

    assert "官方更新说明候选：手动下单慢？——丰富「智能订单」助你一键智投。" in prompt
    assert "文件大小" not in prompt


def test_store_feature_candidate_can_be_rewritten_as_factual_change(tmp_path: Path) -> None:
    raw_dir = tmp_path / "raw" / "markdown"
    path = raw_dir / "gxzq" / "release.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\nbroker_code: gxzq\nbroker_name: 国信证券\napp_name: 国信金太阳\n"
        "source_url: https://example.com/app\nparser: apple_lookup_api\n---\n\n"
        "## iOS · 国信金太阳\n\n- 版本：9.30.20\n- 平台：iOS\n\n"
        "更新说明：\n\n手动下单慢？——丰富「智能订单」助你一键智投。\n",
        encoding="utf-8",
    )

    class StoreClient:
        def extract(self, *, metadata: dict[str, str], content: str) -> list[AppReleaseAnalysis]:
            assert "官方更新说明候选" in content
            return [AppReleaseAnalysis(update_summary="新增智能订单功能", highlights=["新增智能订单功能"])]

    refresh_all(
        _catalog(),
        client=StoreClient(),
        export_path=tmp_path / "app.csv",
        raw_dir=raw_dir,
        crawl_runner=lambda catalog: CrawlSummary(success={"gxzq": path}, failures={}),
    )
    with (tmp_path / "app.csv").open("r", encoding="utf-8-sig", newline="") as handle:
        row = next(csv.DictReader(handle))
    assert row["update_summary"] == "新增智能订单功能"


def test_markdown_writer_reuses_unchanged_source_document(tmp_path: Path) -> None:
    source = _catalog().brokers[0]
    writer = MarkdownWriter(tmp_path / "markdown")
    document = ParsedDocument(
        title="App 更新",
        sections=[ParsedSection(heading="版本", content="1.0.0")],
        source_metadata={},
    )
    first_response = CollectedContent(
        source=source,
        body="ignored",
        crawl_time="2026-07-29T10:00:00+08:00",
    )
    second_response = CollectedContent(
        source=source,
        body="ignored",
        crawl_time="2026-07-30T10:00:00+08:00",
    )

    writer.write(source, document, first_response)
    writer.write(source, document, second_response)

    assert len(list((tmp_path / "markdown" / source.broker_code).glob("*.md"))) == 1


def test_source_identity_is_portable_across_url_and_code_formatting() -> None:
    assert refresh_module._source_identity(
        " GXZQ ", "https://example.com/app/", "A" * 64
    ) == refresh_module._source_identity(
        "gxzq", "https://example.com/app", "a" * 64
    )
