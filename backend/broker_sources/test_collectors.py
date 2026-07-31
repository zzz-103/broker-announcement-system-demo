from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.broker_sources.collectors.base import OfficialCollector, safe_filename
from backend.broker_sources.config import BrokerSourceConfig
from backend.broker_sources.collectors.century import CenturyCollector
from backend.broker_sources.collectors.citic import CiticCollector
from backend.broker_sources.collectors.huaxi import HuaxiCollector
from backend.broker_sources.http_client import (
    LEGACY_SERVER_CONNECT_OPTION,
    LegacyServerConnectAdapter,
    create_session,
)
from backend.broker_sources.models import StandardNotice


def collector_config() -> BrokerSourceConfig:
    return BrokerSourceConfig(
        key="huaxi_securities",
        broker_name="华西证券",
        collector="huaxi",
        enabled=True,
        pages=100,
        page_size=10,
        min_content_chars=1,
        min_detail_success_ratio=0.8,
        aliases=(),
        settings={
            "base_url": "https://example.com",
            "list_page_url": "https://example.com/list",
            "api_url": "https://example.com/api",
            "func_no": "741000",
            "catalog_id": "15",
        },
    )


class _DummyCollector(OfficialCollector):
    def collect_notices(self) -> list[StandardNotice]:
        return []


class CollectorParserTests(unittest.TestCase):
    def test_incremental_probe_stops_after_two_existing_pages(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            collector = _DummyCollector(collector_config(), Path(directory), Path(directory))
            self.assertFalse(collector._should_stop_after_list_page(False))
            self.assertTrue(collector._should_stop_after_list_page(False))
            self.assertEqual(collector.stop_reason, "前两页均为已下载数据")

    def test_incremental_probe_allows_two_extra_pages_when_first_two_are_new(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            collector = _DummyCollector(collector_config(), Path(directory), Path(directory))
            self.assertFalse(collector._should_stop_after_list_page(True))
            self.assertFalse(collector._should_stop_after_list_page(True))
            self.assertFalse(collector._should_stop_after_list_page(True))
            self.assertTrue(collector._should_stop_after_list_page(True))
            self.assertEqual(collector.scanned_pages, 0)

    def test_bounded_probe_preserves_previous_downloaded_notices(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old_run = root / "runs" / "old" / "notices"
            old_run.mkdir(parents=True)
            notice = StandardNotice(
                broker_key="huaxi_securities",
                broker_name="华西证券",
                source_kind="official",
                source_name="券商官网",
                notice_id="1",
                notice_type="procurement",
                title="旧公告",
                publish_date="2026-07-01",
                source_url="https://example.com/1",
                collected_at="2026-07-01T00:00:00+00:00",
                collection_status="success",
                content_text="公告正文足够长",
            )
            old_file = old_run / safe_filename(notice)
            old_file.write_text("旧公告正文", encoding="utf-8")
            checkpoint_dir = root / "checkpoints"
            checkpoint_dir.mkdir()
            (checkpoint_dir / "huaxi_securities.json").write_text(
                json.dumps(
                    {
                        "notices": [
                            {
                                "source_url": notice.source_url,
                                "notice": notice.to_dict(),
                                "markdown_path": old_file.as_posix(),
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            collector = _DummyCollector(collector_config(), root, root)
            preserved = collector._preserve_previous_notices([])
            self.assertEqual([item.source_url for item in preserved], [notice.source_url])
            self.assertTrue((collector.notices_dir / old_file.name).exists())

    def test_century_parses_xhr_items_and_separates_notice_types(self) -> None:
        payload = {
            "status": True,
            "data": {
                "TotalPages": 62,
                "Items": [
                    {
                        "Whir_U_ContentNew_PID": 61088,
                        "Title": "世纪证券合规风控系统一期项目维护费项目采购中选公示",
                        "Content": "<p>中选单位：上海金仕达软件科技股份有限公司</p>",
                        "Timesamp": 1784851200000,
                    },
                    {
                        "Whir_U_ContentNew_PID": 61062,
                        "Title": "世纪证券总部大楼职场办公家具利旧搬迁及新增项目招标公告",
                        "Content": "<p>项目最高限价：162万元</p>",
                        "Timesamp": 1784678400000,
                    },
                ],
            },
        }

        records, total_pages = CenturyCollector.parse_list(
            payload,
            "https://www.csco.com.cn/PurchasingReport.shtml",
        )

        self.assertEqual(total_pages, 62)
        self.assertEqual([item["notice_type"] for item in records], ["result", "procurement"])
        self.assertEqual(records[0]["publish_date"], "2026-07-24")
        self.assertEqual(
            records[0]["detail_url"],
            "https://www.csco.com.cn/PurchasingReport.shtml#notice-61088",
        )
        self.assertIn("上海金仕达", records[0]["content_text"])

    def test_legacy_tls_is_enabled_only_when_requested(self) -> None:
        default_session = create_session()
        legacy_session = create_session(allow_legacy_server_connect=True)

        self.assertNotIsInstance(
            default_session.adapters["https://"],
            LegacyServerConnectAdapter,
        )
        adapter = legacy_session.adapters["https://"]
        self.assertIsInstance(adapter, LegacyServerConnectAdapter)
        context = adapter.poolmanager.connection_pool_kw["ssl_context"]
        self.assertTrue(context.options & LEGACY_SERVER_CONNECT_OPTION)

    def test_citic_parses_relative_detail_link_and_full_body(self) -> None:
        list_html = """
        <ul>
          <li><span>2026-07-26</span>
            <a href="./202607/t20260726_1214901.html">
              关于APP市场流量动态与用户体验数据服务（2026）的采购申请 - 采购结果公告
            </a>
          </li>
        </ul>
        """.encode()
        records = CiticCollector.parse_list(
            list_html,
            "https://www.cs.ecitic.com/newsite/xxgs/cgxmjg/index.html",
        )
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["publish_date"], "2026-07-26")
        self.assertEqual(
            records[0]["detail_url"],
            "https://www.cs.ecitic.com/newsite/xxgs/cgxmjg/202607/t20260726_1214901.html",
        )

        detail_html = """
        <div class="docHtmlB">
          <p>采购申请已完成集中采购工作，现将采购结果公布如下。</p>
          <table><tr><td>中选供应商</td><td>北京易观数智科技股份有限公司</td></tr></table>
        </div>
        """.encode()
        body = CiticCollector.parse_detail(detail_html)
        self.assertIn("北京易观数智科技股份有限公司", body)

    def test_huaxi_uses_verified_api_shape_and_detail_container(self) -> None:
        payload = {
            "error_no": "0",
            "results": [
                {
                    "data": [
                        {
                            "article_id": "98037",
                            "title": "华西证券股份有限公司量化投研平台服务器采购项目采购公告",
                            "url": "/main/a/20260728/98037.shtml",
                            "create_date": "2026-07-28",
                        }
                    ]
                }
            ],
        }
        records = HuaxiCollector.parse_list(payload, "https://www.hx168.com.cn")
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["notice_id"], "98037")
        self.assertEqual(
            records[0]["detail_url"],
            "https://www.hx168.com.cn/main/a/20260728/98037.shtml",
        )

        detail_html = """
        <div class="article_cont clearfix">
          <p>项目编号：ITXM20260101076</p>
          <p>最高限价为：150万元。签订合同后30个工作日内交货。</p>
        </div>
        """.encode()
        body = HuaxiCollector.parse_detail(detail_html)
        self.assertIn("150万元", body)


if __name__ == "__main__":
    unittest.main()
