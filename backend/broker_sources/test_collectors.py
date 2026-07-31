from __future__ import annotations

import unittest

from backend.broker_sources.collectors.century import CenturyCollector
from backend.broker_sources.collectors.citic import CiticCollector
from backend.broker_sources.collectors.huaxi import HuaxiCollector
from backend.broker_sources.http_client import (
    LEGACY_SERVER_CONNECT_OPTION,
    LegacyServerConnectAdapter,
    create_session,
)


class CollectorParserTests(unittest.TestCase):
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
