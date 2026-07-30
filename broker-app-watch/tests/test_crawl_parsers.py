"""Fast fixture tests for the first two real crawlers."""

import json
from dataclasses import replace
from pathlib import Path

import pytest

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.core.config import BrokerSource
from broker_app_watch.parsers.base import ParsedDocument, ParsedSection
from broker_app_watch.parsers.broker_specific.cgws_download_html import CgwsDownloadHtmlParser
from broker_app_watch.parsers.broker_specific.ciccwm_appdown_api import CiccwmAppDownApiParser
from broker_app_watch.parsers.broker_specific.dgzq_soft_api import DgzqSoftApiParser
from broker_app_watch.parsers.broker_specific.easec_software_api import (
    EasecSoftwareApiParser,
)
from broker_app_watch.parsers.broker_specific.essence_softwares_api import (
    EssenceSoftwaresApiParser,
)
from broker_app_watch.parsers.broker_specific.guosen_software_api import (
    GuosenSoftwareApiParser,
)
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


FIXTURES = Path(__file__).parent / "fixtures"


def _source(**overrides: object) -> BrokerSource:
    values: dict[str, object] = {
        "broker_code": "gfzq",
        "broker_name": "广发证券",
        "app_name": "广发易淘金",
        "source_url": "https://example.com/app",
        "source_type": "http",
        "parser": "generic_html",
        "parser_options": {"section_headings": ["简介", "详细信息"]},
    }
    values.update(overrides)
    return BrokerSource.model_validate(values)


def _response(source: BrokerSource, body: str) -> CollectedContent:
    return CollectedContent(
        source=source,
        body=body,
        status_code=200,
        final_url=str(source.source_url),
        crawl_time="2026-07-23T10:30:00+08:00",
    )


def test_guosen_parser_maps_all_fields_and_metadata() -> None:
    body = (FIXTURES / "guosen_software.json").read_text(encoding="utf-8")
    source = _source(
        broker_code="gxzq",
        broker_name="国信证券",
        app_name="国信金太阳",
        source_type="api",
        parser="guosen_software_api",
        parser_options={"item_id": "13"},
    )

    document = GuosenSoftwareApiParser().parse(body, source, _response(source, body))

    assert document.title == "国信金太阳"
    assert [section.heading for section in document.sections] == ["基本介绍", "内容提要", "更新"]
    assert "提供证券交易服务。" in document.sections[0].content
    assert "1. 新增行情功能\n2. 优化交易流程" in document.sections[1].content
    assert "修复已知问题" in document.sections[2].content
    assert document.source_metadata == {
        "software_id": "13",
        "page_update_time": "2026-07-20",
        "labels": "证券交易,行情",
    }


def test_guosen_parser_requires_configured_id() -> None:
    payload = json.loads((FIXTURES / "guosen_software.json").read_text(encoding="utf-8"))
    source = _source(
        broker_code="gxzq",
        broker_name="国信证券",
        app_name="国信金太阳",
        source_type="api",
        parser="guosen_software_api",
        parser_options={"item_id": "999"},
    )

    with pytest.raises(ValueError, match="未找到指定软件"):
        GuosenSoftwareApiParser().parse(
            json.dumps(payload, ensure_ascii=False), source, _response(source, "")
        )


def test_generic_html_parser_only_extracts_requested_sections() -> None:
    body = (FIXTURES / "gf_app_detail.html").read_text(encoding="utf-8")
    source = _source()

    document = GenericHtmlParser().parse(body, source, _response(source, body))
    combined = "\n".join(section.content for section in document.sections)

    assert [section.heading for section in document.sections] == ["简介", "详细信息"]
    assert "便捷交易" in combined
    assert "版本号：9.9.9" in combined
    assert "用户评论" not in combined
    assert "其他应用推荐" not in combined
    assert "页脚内容" not in combined
    assert "[在线交易](https://example.com)" in combined


def test_essence_parser_collects_only_configured_platforms() -> None:
    body = (FIXTURES / "essence_softwares.json").read_text(encoding="utf-8")
    source = _source(
        broker_code="gtzq",
        broker_name="国投证券",
        app_name="国投证券",
        source_type="api",
        parser="essence_softwares_api",
        parser_options={"platform_groups": {"安卓": "2", "苹果": "4"}},
    )

    document = EssenceSoftwaresApiParser().parse(body, source, _response(source, body))

    assert document.title == "国投证券"
    assert [section.heading for section in document.sections] == [
        "安卓 · 国投证券",
        "安卓 · 国投证券同花顺",
        "苹果 · 国投证券",
    ]
    android = document.sections[0].content
    assert "- 版本：V9.6.3" in android
    assert "- 运行环境：需要安卓6.0及以上版本" in android
    assert "165.8 MB（173843955 字节）" in android
    assert "国投证券APP是手机版智能炒股软件" in android
    ios = document.sections[2].content
    assert "- 运行环境：需要iOS 12.0或更高版本" in ios
    # 仅收录安卓与苹果，不引入 PC 等其他分组
    combined = "\n".join(section.content for section in document.sections)
    assert "通达信版" not in combined
    assert "pc.exe" not in combined
    assert document.source_metadata == {"安卓_数量": "2", "苹果_数量": "1"}


def test_essence_parser_requires_present_group() -> None:
    body = (FIXTURES / "essence_softwares.json").read_text(encoding="utf-8")
    source = _source(
        broker_code="gtzq",
        broker_name="国投证券",
        app_name="国投证券",
        source_type="api",
        parser="essence_softwares_api",
        parser_options={"platform_groups": {"安卓": "2", "鸿蒙": "99"}},
    )

    with pytest.raises(ValueError, match="缺少鸿蒙分组"):
        EssenceSoftwaresApiParser().parse(body, source, _response(source, body))


def test_pingan_parser_ocrs_each_image_without_network_or_engine() -> None:
    body = (FIXTURES / "pingan_config.json").read_text(encoding="utf-8")
    source = _source(
        broker_code="pazq",
        broker_name="平安证券",
        app_name="平安证券",
        source_type="api",
        parser="pingan_image_ocr",
        parser_options={"list_path": ["results", "list"], "min_score": 0.6},
    )
    fetched: list[str] = []

    def fake_fetch(url: str) -> bytes:
        fetched.append(url)
        return b"fake-image-bytes"

    def fake_ocr(image_bytes: bytes) -> list[tuple[str, float]]:
        assert image_bytes == b"fake-image-bytes"
        return [("全新升级", 0.99), ("打新服务升级", 0.98), ("噪点", 0.30)]

    parser = PinganImageOcrParser(image_fetcher=fake_fetch, ocr_reader=fake_ocr)
    document = parser.parse(body, source, _response(source, body))

    assert fetched == [
        "https://pacdn.m.stock.pingan.com/image/06/cf9ee348b824436da392e3e2cf7ee7a8.jpg"
    ]
    assert [section.heading for section in document.sections] == ["图片 1"]
    assert document.sections[0].content == "全新升级\n打新服务升级"
    assert "噪点" not in document.sections[0].content
    assert document.source_metadata["image_count"] == "1"
    assert document.source_metadata["ocr_engine"] == "rapidocr-onnxruntime"


def test_pingan_parser_requires_image_list() -> None:
    source = _source(
        broker_code="pazq",
        broker_name="平安证券",
        app_name="平安证券",
        source_type="api",
        parser="pingan_image_ocr",
        parser_options={"list_path": ["results", "list"]},
    )
    parser = PinganImageOcrParser(
        image_fetcher=lambda url: b"", ocr_reader=lambda data: []
    )

    with pytest.raises(ValueError, match="未返回图片列表"):
        parser.parse('{"results": {"list": []}}', source, _response(source, ""))


def test_selected_apps_html_keeps_one_card_per_app_and_preferred_platform() -> None:
    body = """
    <div class="mobile-list">
      <div class="card">
        <h3>中山证券同花顺版APP</h3>
        <div class="content">
          <p>更新时间：2026-07-04</p>
          <p>全景行情、极速交易。</p>
          <p>iOS版：版本号V4.7.2</p>
          <p>安卓版：版本号V9.21.49</p>
        </div>
      </div>
      <div class="card"><h3>电脑软件</h3><div class="content">不要采集</div></div>
    </div>
    """
    source = _source(
        broker_code="zhongshan",
        broker_name="中山证券",
        app_name="中山证券手机APP",
        parser="selected_apps_html",
        parser_options={
            "app_names": ["中山证券同花顺版APP"],
            "card_selector": ".card",
            "name_selector": "h3",
            "content_selector": ".content",
            "excluded_line_prefixes": ["iOS版："],
        },
    )

    document = SelectedAppsHtmlParser().parse(body, source, _response(source, body))

    assert [section.heading for section in document.sections] == ["中山证券同花顺版APP"]
    assert "安卓版：版本号V9.21.49" in document.sections[0].content
    assert "iOS版" not in document.sections[0].content
    assert "不要采集" not in document.sections[0].content


def test_easec_parser_repairs_api_encoding_and_selects_mobile_app() -> None:
    body = json.dumps(
        {
            "results": [
                {
                    "id": "28",
                    "file_name": "东亚前海悦涨APP（推荐）".encode()
                    .decode("latin-1"),
                    "android_version": "v5.6.0",
                    "software_time": "2026-07-10 18:00:00",
                    "file_size": "170",
                    "developer": "东亚前海证券有限责任公司".encode()
                    .decode("latin-1"),
                    "description": "全行情覆盖，满足客户多层次需求".encode()
                    .decode("latin-1"),
                }
            ]
        },
        ensure_ascii=False,
    )
    source = _source(
        broker_code="easec",
        broker_name="东亚前海证券",
        app_name="东亚前海悦涨APP",
        source_type="api",
        parser="easec_software_api",
        parser_options={"item_id": "28"},
    )

    document = EasecSoftwareApiParser().parse(body, source, _response(source, body))

    assert "东亚前海悦涨APP（推荐）" in document.sections[0].content
    assert "v5.6.0" in document.sections[0].content
    assert "全行情覆盖，满足客户多层次需求" in document.sections[0].content


def test_ytzq_parser_selects_one_configured_client_per_app() -> None:
    body = json.dumps(
        {
            "results": [
                {
                    "softid": "26",
                    "title": "银泰掌易宝android版",
                    "version": "5.11.1",
                    "modify_date": "2026-07-04 18:54:34",
                    "content": "集证券开户、股票交易、股票行情于一体。",
                },
                {
                    "softid": "27",
                    "title": "银泰掌易宝iphone版",
                    "version": "5.11.1",
                    "modify_date": "2026-07-07 16:50:22",
                    "content": "iPhone 客户端。",
                },
            ]
        },
        ensure_ascii=False,
    )
    source = _source(
        broker_code="ytzq",
        broker_name="银泰证券",
        app_name="银泰证券手机APP",
        source_type="api",
        parser="ytzq_software_api",
        parser_options={"app_ids": {"银泰掌易宝": "26"}},
    )

    document = YtzqSoftwareApiParser().parse(body, source, _response(source, body))

    assert [section.heading for section in document.sections] == ["银泰掌易宝"]
    assert "银泰掌易宝android版" in document.sections[0].content
    assert "2026-07-04" in document.sections[0].content
    assert "iphone" not in document.sections[0].content


def test_qq_app_detail_parser_keeps_sections_and_ocrs_first_screenshot() -> None:
    body = """
    <h2>简介</h2><p>官方财富管理 App。</p>
    <h2>详细信息</h2><p>版本号：8.8.68</p>
    <h2>用户评论</h2><p>不要采集</p>
    <img alt="精彩截图-测试2026官方新版" src="https://img.example/shot-1.png">
    <img alt="精彩截图-测试2026官方新版" src="https://img.example/shot-2.png">
    """
    source = _source(
        broker_code="htzq",
        broker_name="华泰证券",
        app_name="涨乐财富通",
        parser="qq_app_detail_ocr",
        parser_options={
            "section_headings": ["简介", "详细信息"],
            "screenshot_alt": "精彩截图-测试2026官方新版",
            "screenshot_limit": 1,
            "min_score": 0.6,
        },
    )
    fetched: list[str] = []
    parser = QqAppDetailOcrParser(
        image_fetcher=lambda url: fetched.append(url) or b"image",
        ocr_reader=lambda data: [("更新说明", 0.99), ("噪点", 0.2)],
    )

    document = parser.parse(body, source, _response(source, body))

    assert fetched == ["https://img.example/shot-1.png"]
    assert [section.heading for section in document.sections] == [
        "简介",
        "详细信息",
        "截图文字 1",
    ]
    assert document.sections[2].content == "更新说明"
    assert document.source_metadata["screenshot_count"] == "1"


def test_dgzq_parser_keeps_only_configured_mobile_clients() -> None:
    body = (FIXTURES / "dgzq_soft.json").read_text(encoding="utf-8")
    source = _source(
        broker_code="dgzq",
        broker_name="东莞证券",
        app_name="东莞证券手机App",
        source_type="api",
        parser="dgzq_soft_api",
        parser_options={"mobile_clients": ["2", "3"]},
    )

    document = DgzqSoftApiParser().parse(body, source, _response(source, body))

    assert [section.heading for section in document.sections] == ["掌证宝6.4.8", "微官网软件下载"]
    zzb = document.sections[0].content
    assert "- 宣传语：一站式智能投资炒股APP" in zzb
    assert "- 更新说明：支持沪深交易新规" in zzb
    assert "- 下载（android）：https://media.dgzq.cn/zzb.apk" in zzb
    combined = "\n".join(section.content for section in document.sections)
    assert "pc.exe" not in combined
    assert document.source_metadata == {"手机端数量": "2"}


def test_dgzq_parser_requires_matching_client() -> None:
    body = (FIXTURES / "dgzq_soft.json").read_text(encoding="utf-8")
    source = _source(
        broker_code="dgzq",
        broker_name="东莞证券",
        app_name="东莞证券手机App",
        source_type="api",
        parser="dgzq_soft_api",
        parser_options={"mobile_clients": ["9"]},
    )

    with pytest.raises(ValueError, match="未解析出手机端"):
        DgzqSoftApiParser().parse(body, source, _response(source, body))


def test_ciccwm_parser_keeps_only_mobile_downloads() -> None:
    body = (FIXTURES / "ciccwm_menu.json").read_text(encoding="utf-8")
    source = _source(
        broker_code="ciccwm",
        broker_name="中金财富",
        app_name="中金财富",
        source_type="api",
        parser="ciccwm_appdown_api",
        parser_options={},
    )

    document = CiccwmAppDownApiParser().parse(body, source, _response(source, body))

    assert [section.heading for section in document.sections] == ["中金财富"]
    content = document.sections[0].content
    assert "- 版本：12.7.0" in content
    assert "- 更新时间：2026-06-26 18:23:23" in content
    assert "- 下载（安卓下载）：https://procos.ciccwm.com/app.apk" in content
    assert "一站式服务" in content
    # 电脑端（Windows 下载）不应被收录
    assert "pc.exe" not in content
    assert document.source_metadata == {"手机端数量": "1"}


def test_cgws_parser_extracts_named_apps_without_cross_reference() -> None:
    body = (FIXTURES / "cgws_download.html").read_text(encoding="utf-8")
    source = _source(
        broker_code="cgws",
        broker_name="长城证券",
        app_name="长城证券手机App",
        source_type="http",
        parser="cgws_download_html",
        parser_options={"app_names": ["长城炼金术", "长城易"]},
    )

    document = CgwsDownloadHtmlParser().parse(body, source, _response(source, body))

    assert [section.heading for section in document.sections] == ["长城炼金术", "长城易"]
    alchemy = document.sections[0].content
    assert "- 更新日期：2024-08-08" in alchemy
    assert "软件介绍：长城炼金术手机证券交易APP" in alchemy
    assert "点击立即下载" not in alchemy
    changyi = document.sections[1].content
    assert "- 更新日期：2022-06-14" in changyi
    assert "- 支持平台：iOS、Android" in changyi
    # “长城易”块虽提到“长城炼金术”，但其更新日期与介绍属于长城易自身
    assert "2024-08-08" not in changyi
    assert document.source_metadata == {"手机端数量": "2"}


def test_cgws_parser_requires_app_present() -> None:
    body = (FIXTURES / "cgws_download.html").read_text(encoding="utf-8")
    source = _source(
        broker_code="cgws",
        broker_name="长城证券",
        app_name="长城证券手机App",
        source_type="http",
        parser="cgws_download_html",
        parser_options={"app_names": ["不存在的App"]},
    )

    with pytest.raises(ValueError, match="缺失手机端"):
        CgwsDownloadHtmlParser().parse(body, source, _response(source, body))


def test_ykzq_parser_keeps_only_mobile_apps() -> None:
    body = (FIXTURES / "ykzq_cms_article.json").read_text(encoding="utf-8")
    source = _source(
        broker_code="ykzq",
        broker_name="粤开证券",
        app_name="粤开证券手机App",
        source_type="api",
        parser="ykzq_cms_article",
        parser_options={},
    )

    document = YkzqCmsArticleParser().parse(body, source, _response(source, body))

    # 仅保留含 .apk 且名称为手机端的 App；同花顺PC（.exe）与“期权宝（模拟交易）PC端”均排除
    assert [section.heading for section in document.sections] == [
        "粤管家APP",
        "粤开手机销户APP(安卓)",
    ]
    ygj = document.sections[0].content
    assert "版本信息：8.04.01" in ygj
    assert "更新日期：20260709" in ygj
    assert "- 下载：https://download.ykzq.com/software/hs/ygj.apk" in ygj
    assert "点击立即下载" not in ygj
    combined = "\n".join(section.content for section in document.sections)
    assert ".exe" not in combined
    assert "模拟交易" not in combined
    assert document.source_metadata == {"手机端数量": "2"}


def test_ykzq_parser_requires_mobile_app() -> None:
    payload = {
        "data": {
            "records": [
                {
                    "content": (
                        '<div class="so-download-cont"><h2>粤开通达信PC</h2>'
                        '<dd><a href="https://download.ykzq.com/x.exe">下载</a></dd></div>'
                    )
                }
            ]
        }
    }
    source = _source(
        broker_code="ykzq",
        broker_name="粤开证券",
        app_name="粤开证券手机App",
        source_type="api",
        parser="ykzq_cms_article",
        parser_options={},
    )

    with pytest.raises(ValueError, match="未解析出手机端"):
        YkzqCmsArticleParser().parse(
            json.dumps(payload, ensure_ascii=False), source, _response(source, "")
        )


def test_markdown_writer_front_matter_and_stable_content_hash(tmp_path: Path) -> None:
    source = _source()
    document = ParsedDocument(
        title=source.app_name,
        sections=[
            ParsedSection(heading="简介", content="完整正文"),
        ],
        source_metadata={},
    )
    response = _response(source, "")
    path = MarkdownWriter(tmp_path).write(source, document, response)
    written = (tmp_path / "gfzq" / path.name).read_text(encoding="utf-8")

    assert path.is_relative_to(Path("data/raw/markdown"))
    assert written.startswith("---\n")
    assert "# 广发易淘金" in written
    assert "## 简介" in written
    assert "content_sha256:" in written

    changed_time = replace(response, crawl_time="2026-07-24T10:30:00+08:00")
    second_path = MarkdownWriter(tmp_path / "second").write(source, document, changed_time)
    second = (tmp_path / "second" / "gfzq" / second_path.name).read_text(encoding="utf-8")
    first_hash = next(line for line in written.splitlines() if line.startswith("content_sha256:"))
    second_hash = next(line for line in second.splitlines() if line.startswith("content_sha256:"))
    assert first_hash == second_hash
