from __future__ import annotations

import unittest
from pathlib import Path

from backend.broker_sources.config import BrokerSourceConfig
from backend.broker_sources.selector import select_documents
from backend.broker_sources.source_reader import SourceDocument


def config(key: str) -> BrokerSourceConfig:
    return BrokerSourceConfig(
        key=key,
        broker_name="测试券商",
        collector="test",
        enabled=True,
        pages=2,
        page_size=10,
        min_content_chars=80,
        min_detail_success_ratio=0.8,
        aliases=("测试券商股份有限公司",),
        settings={},
    )


def document(source: str, broker: str, name: str) -> SourceDocument:
    return SourceDocument(
        path=Path(f"/{source}/{name}.md"),
        source_kind=source,
        broker_key=broker,
        notice_type="procurement",
        title=f"{name}采购公告",
        publish_date="2026-07-28",
        source_url=f"https://example.test/{source}/{name}",
        content_chars=200,
        content_sha256=f"{source}-{name}",
    )


class SourceSelectionTests(unittest.TestCase):
    def test_quality_passed_official_replaces_lower_priority_sources_for_broker(self) -> None:
        broker = "citic_securities"
        selected, decisions, _ = select_documents(
            [document("official", broker, "official")],
            [document("cfcpn", broker, "cfcpn")],
            [document("external", broker, "external")],
            {broker: config(broker)},
            {broker},
        )
        self.assertEqual([item.source_kind for item in selected], ["official"])
        self.assertEqual(decisions[broker], "official")

    def test_failed_official_falls_back_to_cfcpn_then_external(self) -> None:
        broker = "huaxi_securities"
        selected, decisions, _ = select_documents(
            [document("official", broker, "official")],
            [document("cfcpn", broker, "cfcpn")],
            [document("external", broker, "external")],
            {broker: config(broker)},
            set(),
        )
        self.assertEqual([item.source_kind for item in selected], ["cfcpn"])
        self.assertEqual(decisions[broker], "cfcpn")

        selected_without_cfcpn, decisions_without_cfcpn, _ = select_documents(
            [],
            [],
            [document("external", broker, "external")],
            {broker: config(broker)},
            set(),
        )
        self.assertEqual(
            [item.source_kind for item in selected_without_cfcpn], ["external"]
        )
        self.assertEqual(decisions_without_cfcpn[broker], "external")


if __name__ == "__main__":
    unittest.main()
