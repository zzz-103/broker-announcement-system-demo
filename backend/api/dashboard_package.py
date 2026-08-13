from __future__ import annotations

"""Build and export the public dashboard data package.

The package is the data contract served to the formal frontend through the
protected /api/dashboard-data endpoints.  Raw CSV files remain the
crawler/LLM boundary; all display-oriented normalization happens here once.
"""

import csv
import hashlib
import io
import json
import os
import re
import threading
import unicodedata
import zipfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .app_watch_baseline import (
    APP_WATCH_BASELINE_FILENAME,
    app_watch_baseline_skip_ready,
    app_watch_csv_bytes,
    build_app_watch_baseline,
    validate_app_watch_baseline,
)
from .config import settings
from .matching_baseline import BASELINE_FILENAME, build_matching_baseline


SCHEMA_VERSION = "1.0.0"
READER_VERSION = "1.0.0"
PACKAGE_FILES = {
    "overview": "overview.json",
    "filters": "filters.json",
    "tender_projects": "tender_projects.json",
    "app_updates": "app_updates.json",
    "ai_analysis": "ai_analysis.json",
}
REQUIRED_KEYS = ("overview", "filters", "tender_projects", "app_updates", "ai_analysis")

BROKER_ALIASES = {
    "国泰海通": "国泰海通证券",
    "国泰海通证券股份有限公司": "国泰海通证券",
    "国泰君安": "国泰海通证券",
    "国泰君安证券": "国泰海通证券",
    "国泰君安证券股份有限公司": "国泰海通证券",
    "海通证券": "国泰海通证券",
    "海通证券股份有限公司": "国泰海通证券",
    "中银国际": "中银国际证券",
    "中银国际证券有限责任公司": "中银国际证券",
    "中银国际证券股份有限公司": "中银国际证券",
    "中信建投": "中信建投证券",
    "中信建投证券股份有限公司": "中信建投证券",
    "中国银河": "中国银河证券",
    "中国银河证券股份有限公司": "中国银河证券",
    "中金财富": "中金财富证券",
    "中国中金财富证券有限公司": "中金财富证券",
    "光大证券股份有限公司": "光大证券",
    "南京证券股份有限公司": "南京证券",
    "申万宏源": "申万宏源证券",
    "申万宏源证券有限公司": "申万宏源证券",
    "国联证券": "国联民生证券",
    "国联证券股份有限公司": "国联民生证券",
    "民生证券": "国联民生证券",
    "民生证券股份有限公司": "国联民生证券",
    "安信证券": "国投证券",
    "安信证券股份有限公司": "国投证券",
    "华融证券": "国新证券",
    "华融证券股份有限公司": "国新证券",
    "新时代证券": "诚通证券",
    "新时代证券股份有限公司": "诚通证券",
}

DOMAIN_RULES = (
    ("AI与智能化", ("AI", "AIGC", "大模型", "智能体", "人工智能", "机器学习", "知识库", "智能客服", "语音识别", "OCR", "智能投研", "智能问答", "智能运营")),
    ("数据治理与数据平台", ("数据治理", "数据仓库", "数据中台", "数据平台", "湖仓", "数据湖", "指标平台", "主数据", "元数据", "数据质量", "数据资产", "数据集市", "BI", "驾驶舱", "实时数据", "数据交换")),
    ("财富管理与客户经营", ("财富管理", "财富CRM", "CRM", "客户画像", "客户运营", "营销平台", "精准营销", "投顾平台", "产品销售", "客户服务")),
    ("APP与数字化渠道", ("APP", "移动端", "手机证券", "鸿蒙", "小程序", "互联网金融", "网上交易", "客户端", "数字渠道", "移动应用")),
    ("交易、柜台与核心系统", ("交易系统", "核心交易", "柜台", "集中交易", "极速交易", "两融", "融资融券", "期权", "清算", "结算", "估值", "登记结算", "法人清算", "行情交易", "OMS", "订单管理")),
    ("网络安全与监管科技", ("信息安全", "网络安全", "数据安全", "防火墙", "态势感知", "漏洞", "渗透测试", "终端安全", "反洗钱", "监管报送", "风险管理", "合规管理", "风控", "灾备", "容灾")),
    ("云计算、算力与基础设施", ("服务器", "存储", "算力", "云平台", "云计算", "容器", "虚拟化", "数据库", "操作系统", "交换机", "路由器", "网络设备", "机房", "备份", "硬件设备")),
    ("IT运维与技术服务", ("运维", "维保", "驻场", "技术支持", "技术服务", "开发外包", "人员外包", "系统维护", "续保", "续采")),
    ("投研资讯与金融数据", ("Wind", "同花顺", "金融数据", "行情数据", "行情系统", "期货行情", "资讯服务", "研报", "投研数据", "舆情", "数据终端", "资讯终端")),
)
CAPITAL_MARKET_KEYWORDS = ("投行", "资本市场", "质控", "承销", "保荐")
SYSTEM_OBJECT_KEYWORDS = ("系统", "平台", "软件", "应用", "数据库", "接口", "引擎", "网关", "终端", "内核", "模块", "助手", "程序化")
BUSINESS_DOMAIN_RULES = (
    ("交易、柜台与核心系统", ("交易系统", "交易软件", "交易功能", "交易执行", "交易平台", "交易算法", "交易网关", "连续竞价", "竞价网络", "智能交易", "策略交易", "自营交易", "专业化交易", "快速交易", "交易反演", "条件单", "多资产ETF", "ETF", "连板", "核心交易", "柜台", "柜面", "业务受理", "集中交易", "极速交易", "期权", "两融", "融资融券", "清算", "结算", "估值", "登记结算", "登记过户", "法人清算", "行情交易", "订单管理", "量化交易", "程序化交易", "固定收益", "固收", "衍生品", "回购", "收益互换", "委托交易", "股票质押", "增减持", "资产证券化", "资产负债", "资负", "场外交易", "OTC", "FICC", "账户及场外")),
    ("网络安全与监管科技", ("信息隔离墙", "合规系统", "合规管理", "合规", "监管报送", "监管系统", "监管政策", "报送系统", "反洗钱", "风险管理", "风险识别", "风险模型", "信用风险", "授信管理", "风控", "异常交易", "身份信息核验", "公安校验", "受益所有人", "安全流量", "CISP", "WAF", "零信任", "上网行为审计", "网页防篡改", "基金风险", "风险加权", "带外管理", "流量分析", "全链路流量", "RiskMetrics", "企业微信", "企微", "会话存档")),
    ("APP与数字化渠道", ("网厅", "网上开户", "非现场开户", "开户系统", "开户", "移动展业", "移动化", "手机证券", "线上业务办理", "互联网金融", "客户渠道", "客户服务", "客户联络", "小程序", "VTM", "双录", "业务权限", "一站通", "一账通", "视频见证")),
    ("财富管理与客户经营", ("财富管理", "财富管家", "财富", "投顾", "基金投顾", "基金绩效", "基金系统", "获客", "客户经营", "人群洞察", "产品中台", "LiveBOS", "理财", "资管", "资产管理", "信托", "托管", "经纪", "客户托管", "客户画像", "客户运营", "股权投资", "投资管理", "产品销售", "产品管理", "产品中心", "基金登记", "基金业务", "私募基金", "资产配置", "TA", "QTrade")),
    ("投研资讯与金融数据", ("投研", "金融数据", "行情数据", "行情系统", "实时行情", "量化数据", "量化分析", "金融量化", "量化", "投资数据", "研究数据", "市场数据", "债券数据", "数据终端", "投研数据", "实时同步平台", "Dataxone")),
    ("投行与资本市场", ("投行", "资本市场", "质控", "底稿", "承销", "保荐", "企业库", "机构库", "金融文档", "文档智能", "智能刷报", "项目库")),
    ("AI与智能化", ("智能投研", "智能投顾", "智能审核", "智能风控", "智能解析", "文档解析", "版面解析", "合同智能", "算法交易", "量化算法", "人脸质检")),
    ("IT运维与技术服务", ("财务账套", "财务附件自动采集", "财务自动化", "运营自动化", "新意系统", "金证系统", "顶点系统", "恒生系统", "RPA", "DevOps", "XC", "公有云", "云服务", "ORACLE")),
)
TECH_OBJECT_KEYWORDS = SYSTEM_OBJECT_KEYWORDS + ("功能", "总线", "算法", "模型", "节点", "底座", "数据中心", "防火墙", "负载均衡", "超融合", "服务器", "存储", "云平台", "RPA", "WAF", "FIX", "CSTP", "PB", "O32", "A5", "CISP", "Acadia", "OneLink", "Matrix", "XTS", "QMT", "ESB", "DevOps", "XC", "FICC", "OTC", "TA", "QTrade", "RiskMetrics", "Dataxone", "Bonree", "CTP", "企点", "金证", "新意", "华锐", "会话存档")
TECH_SERVICE_OBJECT_KEYWORDS = ("技术服务", "系统服务", "软件服务", "平台服务", "接口服务", "数据服务", "维护服务", "运维服务", "实施服务", "开发服务", "授权服务", "许可服务", "系统维保", "软件维保", "平台维保", "会话存档服务")
NON_FINTECH_CONTEXT_KEYWORDS = ("装修工程", "装修施工", "物业", "保洁", "安保", "空调", "通风", "消防", "办公", "办公家具", "办公电脑", "办公用房", "办公场地", "办公楼", "办公终端", "办公软件", "信创办公", "WPS", "Adobe", "工会消费券", "人力外包", "人力资源", "人事", "招聘", "薪酬", "员工绩效", "绩效考核", "绩效管理", "绩效系统", "部门绩效", "员工活动", "员工福利", "员工信息", "员工管理", "劳动合同", "电子劳动合同", "法务", "法律顾问", "审计服务", "内部审计", "财务审计", "税务管理", "财务总账", "财务共享", "智慧财务", "股权激励", "邮件", "邮箱", "电话录音", "录音系统", "会议系统", "会议", "会务", "培训", "比赛", "推广", "推广代理", "营销代理", "营销推广", "营销活动", "市场推广", "IP孵化", "巨量引擎", "市场投放", "应用市场", "投放", "广告", "广告投放", "内容运营", "企小码", "小红书", "公众号", "固定资产", "固定资产管理", "IT资产管理", "资产处置", "不良债权", "承销服务", "主承销商")
SOFT_NON_FINTECH_CONTEXT_KEYWORDS = ("投放", "广告", "广告投放")
NON_FINTECH_KEYWORDS = ("工程装修", "物业", "办公用品", "员工活动", "法律服务", "审计服务", "行政采购", "装修", "保洁", "安保", "餐饮", "车辆", "驾驶", "印刷", "广告制作")
TAG_RULES = (
    ("信创", ("信创", "国产化", "国产", "自主可控", "适配")),
    ("AI", ("AI", "AIGC", "大模型", "智能体", "人工智能")),
    ("数据治理", ("数据治理", "数据质量", "主数据", "元数据")),
    ("二期建设", ("二期", "三期", "四期", "第二阶段")),
    ("系统升级", ("升级", "改造", "扩容", "优化")),
    ("新建", ("新建", "建设", "构建", "搭建")),
    ("续采", ("续采", "续保", "续费", "延续")),
    ("运维", ("运维", "维保", "维护", "驻场")),
    ("软件采购", ("软件", "License", "授权", "许可")),
    ("硬件采购", ("硬件", "服务器", "设备", "采购设备")),
    ("外包服务", ("外包", "驻场", "人员外包", "人力外包")),
)
STAGE_SUFFIXES = ("采购公告", "招标公告", "结果公告", "结果公示", "中标公告", "成交公告", "流标公告", "废标公告", "候选人公示")
INVALID_BROKERS = {"", "未知", "未识别", "主体待识别", "券商待识别", "无法识别", "未提供", "无", "null", "undefined", "-", "--"}
PRIVATE_PATH_PATTERN = re.compile(r"(?i)(?<![A-Za-z0-9])(?:[a-z]:[\\/]|/(?:Volumes|Users|home|app)/)")
PRIVATE_HOST_PATTERN = re.compile(r"(?i)(?<![A-Za-z0-9])(?:localhost|127\.0\.0\.1|::1)(?::\d+)?(?:[/\\?]|$)")


def _text(value: object) -> str:
    return str(value or "").strip()


def _normalize_broker(value: object) -> str:
    name = re.sub(r"\s+", "", _text(value))
    return BROKER_ALIASES.get(name, name)


def _public_source_name(value: object) -> str:
    source = _text(value)
    if not source:
        return "公开招采数据"
    looks_like_relative_path = ("/" in source or "\\" in source) and not re.match(r"(?i)^https?://", source)
    return "公开招采数据" if looks_like_relative_path or PRIVATE_PATH_PATTERN.search(source) or PRIVATE_HOST_PATTERN.search(source) else source


def _public_source_url(value: object) -> str:
    """Keep only public web links in the package.

    App-watch source URLs are useful in the detail drawer, but a malformed
    local/file URL must never expose a crawler path in a public static bundle.
    """
    source = _text(value)
    if not source:
        return ""
    try:
        parsed = urlparse(source)
    except ValueError:
        return ""
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        return ""
    if hostname in {"localhost", "127.0.0.1", "::1"} or PRIVATE_PATH_PATTERN.search(source):
        return ""
    return source


def _parse_positive_amount(*values: object) -> float | None:
    for value in values:
        text = _text(value)
        if not text:
            continue
        try:
            parsed = float(text)
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            return parsed
    return None


def _parse_date(value: object) -> tuple[str, int | None]:
    text = _text(value)
    if not text:
        return "", None
    candidates = (text, text.replace("/", "-").replace(".", "-").replace("年", "-").replace("月", "-").replace("日", ""))
    formats = ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y%m%d", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S")
    for candidate in candidates:
        for fmt in formats:
            try:
                parsed = datetime.strptime(candidate, fmt)
            except ValueError:
                continue
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            parsed = parsed.astimezone(timezone.utc)
            return parsed.date().isoformat(), int(parsed.timestamp() * 1000)
    return "", None


def _normalize_project_name(value: object) -> str:
    name = _text(value).translate(str.maketrans("０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ", "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"))
    name = name.replace("（", "(").replace("）", ")")
    name = re.sub(r"\s+", " ", name)
    for suffix in STAGE_SUFFIXES:
        if name.endswith(suffix) and len(name) > len(suffix):
            name = name[: -len(suffix)]
            break
    return name.strip() or _text(value)


def _supplier(value: object) -> str:
    text = _text(value)
    if not text:
        return ""
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return re.sub(r"\s+", " ", text)
    if isinstance(parsed, list):
        names = [_text(item) for item in parsed if _text(item)]
        return "、".join(names) if names else ""
    return re.sub(r"\s+", " ", text)


def _stage(value: object) -> str:
    text = _text(value)
    if re.search(r"流标|废标", text):
        return "流标废标"
    if re.search(r"结果|中标|成交|候选人公示", text):
        return "结果公示"
    if re.search(r"采购|招标|询价|供应商招募|单一来源|竞争性谈判", text):
        return "采购招标"
    return "其他"


def _classify(project: str, subcategory: str, category: str, scope_summary: str = "", is_broker_project: bool | None = None) -> tuple[str, bool]:
    project_context = f"{project} {scope_summary}"
    text = f"{project_context} {subcategory} {category}"

    def matched_domain(value: str, rules: tuple[tuple[str, tuple[str, ...]], ...] = DOMAIN_RULES) -> str | None:
        for domain, keywords in rules:
            if any(keyword in value for keyword in keywords):
                return domain
        return None

    business_domain = matched_domain(project_context, BUSINESS_DOMAIN_RULES)
    has_tech_object = any(keyword in project_context for keyword in TECH_OBJECT_KEYWORDS + TECH_SERVICE_OBJECT_KEYWORDS)
    has_title_tech_object = any(keyword in project for keyword in TECH_OBJECT_KEYWORDS + TECH_SERVICE_OBJECT_KEYWORDS)
    has_soft_nontech_context = any(keyword in project_context for keyword in SOFT_NON_FINTECH_CONTEXT_KEYWORDS)
    has_hard_nontech_context = any(
        keyword in project_context and keyword not in SOFT_NON_FINTECH_CONTEXT_KEYWORDS
        for keyword in NON_FINTECH_CONTEXT_KEYWORDS
    )

    # Production classifications can lose the original technical category, so
    # a clear financial business context plus a technical object in the title or
    # scope is sufficient.  These signals intentionally outrank stale category
    # values such as "工程建设与装修" and procurement actions are never used
    # as a negative signal by themselves.
    if business_domain and has_tech_object and not has_hard_nontech_context:
        return business_domain, True

    # Result notices and direct-procurement rows often lose the original
    # technical subcategory.  A broker-scoped technical object is therefore a
    # positive signal by itself; the explicit non-technology context above
    # protects office, marketing, legal and facility purchases.
    if (
        is_broker_project is True
        and has_title_tech_object
        and not has_hard_nontech_context
        and (not has_soft_nontech_context or business_domain is not None)
    ):
        return business_domain or matched_domain(project_context) or "IT运维与技术服务", True

    if has_hard_nontech_context or (has_soft_nontech_context and (business_domain is None or not has_tech_object)):
        return "非金融科技及其他", False

    # The category fields can contain stale or overly broad values (for example,
    # "工程建设与装修") even when the title and scope clearly name a financial
    # business system.  An explicit domain + system object in the title/scope
    # therefore takes precedence over that noisy metadata.
    project_domain = matched_domain(project_context)
    if project_domain and any(keyword in project_context for keyword in SYSTEM_OBJECT_KEYWORDS):
        return project_domain, True
    if (
        any(keyword in project_context for keyword in CAPITAL_MARKET_KEYWORDS)
        and any(keyword in project_context for keyword in SYSTEM_OBJECT_KEYWORDS)
    ):
        return "投行与资本市场", True

    if any(keyword in text for keyword in NON_FINTECH_KEYWORDS):
        return "非金融科技及其他", False
    domain = matched_domain(text)
    if domain:
        return domain, True
    if any(keyword in text for keyword in CAPITAL_MARKET_KEYWORDS) and any(keyword in text for keyword in SYSTEM_OBJECT_KEYWORDS):
        return "投行与资本市场", True
    if category == "IT软硬件":
        return "IT运维与技术服务", True
    return "非金融科技及其他", False


def _tags(project: str, subcategory: str) -> list[str]:
    text = f"{project} {subcategory}"
    return [tag for tag, keywords in TAG_RULES if any(keyword in text for keyword in keywords)]


def _score(record: dict[str, Any], baseline: int | None) -> tuple[int, str]:
    score = 0
    domain = record["primary_domain"]
    if domain == "AI与智能化": score += 30
    if domain == "交易、柜台与核心系统": score += 20
    if "信创" in record["topic_tags"]: score += 15
    if record["announcement_stage"] == "结果公示": score += 15
    if record["supplier_name"]: score += 10
    if record["display_amount_kind"] == "winning": score += 10
    if record["display_amount_kind"] == "budget": score += 5
    if baseline is not None and record["publish_timestamp"] is not None and baseline - record["publish_timestamp"] <= 30 * 86400000:
        score += 20
    reasons = []
    if domain == "AI与智能化": reasons.append("近期新增的AI与智能化项目")
    if domain == "交易、柜台与核心系统": reasons.append("涉及核心交易系统建设")
    if "信创" in record["topic_tags"]: reasons.append("具有信创或国产化属性")
    if record["announcement_stage"] == "结果公示" and record["supplier_name"]: reasons.append("结果公告已披露供应商")
    if record["display_amount_kind"] == "winning": reasons.append("公告公开披露成交金额")
    if record["display_amount_kind"] == "budget": reasons.append("公告公开披露项目预算")
    return score, reasons[0] if reasons else "公开招采动态值得关注"


def _safe_id(row: dict[str, str], project_key: str) -> str:
    source = _text(row.get("document_sha1"))
    if source:
        return source
    return hashlib.sha1(f"{project_key}|{_text(row.get('publish_date'))}|{_text(row.get('announcement_stage'))}".encode("utf-8")).hexdigest()


def _ensure_unique_tender_ids(records: list[dict[str, Any]]) -> None:
    """Disambiguate source-hash collisions without depending on row order.

    A unique legacy hash remains unchanged.  When a hash occurs more than
    once, every row receives a digest of its normalized display record; truly
    identical rows get deterministic ordinal suffixes.
    """
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        grouped.setdefault(_text(record.get("id")), []).append(record)

    used: set[str] = {
        base
        for base, group in grouped.items()
        if base and len(group) == 1
    }
    for base in sorted(grouped):
        group = grouped[base]
        if not base or len(group) <= 1:
            continue
        keyed: list[tuple[str, str, dict[str, Any]]] = []
        for record in group:
            display = {key: value for key, value in record.items() if key != "id"}
            canonical = json.dumps(display, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            digest = hashlib.sha1(canonical.encode("utf-8")).hexdigest()[:12]
            keyed.append((canonical, digest, record))
        keyed.sort(key=lambda item: (item[0], item[1]))
        digest_counts = Counter(item[1] for item in keyed)
        digest_ordinals: dict[str, int] = {}
        for _, digest, record in keyed:
            digest_ordinals[digest] = digest_ordinals.get(digest, 0) + 1
            ordinal = digest_ordinals[digest]
            candidate = f"{base}-{digest}"
            if digest_counts[digest] > 1 and ordinal > 1:
                candidate = f"{candidate}-{ordinal}"
            while candidate in used:
                ordinal += 1
                digest_ordinals[digest] = ordinal
                candidate = f"{base}-{digest}-{ordinal}"
            record["id"] = candidate
            used.add(candidate)


def _read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [{str(key): value or "" for key, value in row.items()} for row in csv.DictReader(handle)]


def _build_tenders(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for row in _read_csv(path):
        broker = _normalize_broker(row.get("broker_name")) or "主体待识别"
        project = _text(row.get("project_name"))
        broker_flag = _text(row.get("is_broker_project")).lower()
        is_broker_project = None if broker_flag not in {"true", "false"} else broker_flag == "true"
        normalized_project = _normalize_project_name(project)
        project_key = f"{broker}||{normalized_project}"
        publish_date, publish_timestamp = _parse_date(row.get("publish_date"))
        budget = _parse_positive_amount(row.get("budget_amount_yuan"))
        winning = _parse_positive_amount(row.get("winning_amount_yuan"), row.get("winning_amount"))
        display = winning if winning is not None else budget
        display_kind = "winning" if winning is not None else "budget" if budget is not None else None
        supplier = _supplier(row.get("winning_supplier") or row.get("winner") or row.get("winner_candidates"))
        domain, is_fintech = _classify(
            project,
            _text(row.get("project_subcategory")),
            _text(row.get("procurement_category")),
            _text(row.get("procurement_scope_summary")),
            is_broker_project,
        )
        stage = _stage(row.get("announcement_stage"))
        source_name = _public_source_name(row.get("source") or row.get("data_source"))
        record = {
            "id": _safe_id(row, project_key),
            "broker_name": broker,
            "is_broker_project": is_broker_project,
            "publish_date": publish_date,
            "publish_timestamp": publish_timestamp,
            "announcement_stage": stage,
            "project_name": project,
            "normalized_project_name": normalized_project,
            "procurement_method": _text(row.get("procurement_method")),
            "budget_amount_yuan": budget,
            "winning_amount_yuan": winning,
            "display_amount_yuan": display,
            "display_amount_kind": display_kind,
            "supplier_name": supplier,
            "source_name": source_name,
            "processed_at": _text(row.get("processed_at")),
            "project_key": project_key,
            "amount_sample_key": f"{project_key}||{display_kind}||{display}" if display is not None else None,
            "primary_domain": domain,
            "topic_tags": _tags(project, _text(row.get("project_subcategory"))),
            "is_fintech": is_fintech,
        }
        record["search_text"] = "\n".join((project, broker, supplier, record["procurement_method"])).lower()
        records.append(record)
    _ensure_unique_tender_ids(records)
    baseline = max((r["publish_timestamp"] for r in records if r["publish_timestamp"] is not None), default=None)
    for record in records:
        record["priority_score"], record["priority_reason"] = _score(record, baseline)
    return records


def _json_array(value: object) -> list[str]:
    if isinstance(value, list):
        return [_text(item) for item in value if _text(item)]
    text = _text(value)
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return [text]
    return [_text(item) for item in parsed if _text(item)] if isinstance(parsed, list) else [text]


_APP_UPDATE_TYPES = ("新功能", "体验优化", "问题修复", "合规安全", "其他")
_PLATFORM_ORDER = {
    "Android": 0,
    "iOS": 1,
    "HarmonyOS": 2,
    "Windows": 3,
    "macOS": 4,
    "Web": 5,
    "未知": 99,
}
_CHANGE_WORDS = (
    "新增", "增加", "新功能", "全新", "新版本", "上线", "推出", "支持", "优化", "提升", "改进", "升级", "修复",
    "解决", "调整", "完善", "改版", "适配", "兼容", "重构", "增强", "恢复", "移除",
    "下线", "更新", "改造", "替换", "补充", "修正", "安全", "合规", "风控", "体验",
    "提速", "流畅", "稳定", "性能", "卡顿", "崩溃", "焕新",
    "add", "support", "improv", "fix", "upgrad", "enhanc", "compatib", "refactor", "remove",
)
_LOW_VALUE_UPDATE_PATTERNS = (
    re.compile(r"^(?:[-*•]\s*)?(?:运行环境|系统要求|支持语言|适用客户|文件大小|下载地址|下载链接|md5(?:值)?|开发者|官方网站|官网|官方微信|热线电话|联系电话|联系方式)\s*[：:]", re.I),
    re.compile(r"^(?:需要|支持)\s*(?:ios|android|安卓|苹果|鸿蒙|harmonyos)\s*[\d.]+", re.I),
    re.compile(r"^(?:https?://|ftp://|www\.)", re.I),
    re.compile(r"^(?:[-*•]\s*)?(?:本软件|本产品|本应用).{0,40}(?:是一款|为用户提供|致力于|专注于提供)", re.I),
    re.compile(r"(?:手机版智能炒股软件|股票交易平台|一站式服务|专注于提供|欢迎.*联系)", re.I),
)
_METADATA_WORDS = (
    "运行环境", "系统要求", "支持语言", "适用客户", "文件大小", "下载地址", "下载链接", "md5",
    "开发者", "官方网站", "官方微信", "热线电话", "联系电话", "联系方式",
)


def _canonical_app_text(value: object) -> str:
    """Normalize display text without changing the source CSV."""
    # Keep Chinese punctuation as authored (NFKC would turn "，" into ","),
    # because this helper feeds user-visible summaries.  Version/name identity
    # helpers below perform their own compatibility normalization.
    text = _text(value)
    text = re.sub(r"\s+", " ", text).strip()
    # Markdown bullets and labels are implementation details of the crawler;
    # removing them makes duplicate highlights deterministic.
    return re.sub(r"^(?:[-*•]\s*)+", "", text).strip()


def _normalized_app_version(value: object) -> str:
    text = unicodedata.normalize("NFKC", _text(value)).strip()
    text = re.sub(r"^版本(?:号)?\s*[:：]?\s*", "", text, flags=re.I)
    text = re.sub(r"^[vV]\s*", "", text)
    return re.sub(r"\s+", "", text).lower()


def _normalized_app_name(value: object) -> str:
    text = unicodedata.normalize("NFKC", _text(value))
    return re.sub(r"\s+", " ", text).strip().lower()


def _normalized_broker_code(value: object) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", _text(value))).lower()


def _app_identity(row: dict[str, str]) -> tuple[str, str, str]:
    broker_code = _normalized_broker_code(row.get("broker_code"))
    broker_name = _normalize_broker(row.get("broker_name"))
    # Codes are the strongest identity.  A canonical broker name makes older
    # rows (which predate broker_code) merge without treating aliases as new
    # brokers.
    broker_key = f"code:{broker_code}" if broker_code else f"broker:{broker_name.lower()}"
    return broker_key, broker_code, broker_name


def _normalized_platform(value: object) -> str:
    text = unicodedata.normalize("NFKC", _text(value))
    compact = re.sub(r"\s+", "", text).lower()
    aliases = {
        "安卓": "Android", "android": "Android", "android手机": "Android",
        "苹果": "iOS", "ios": "iOS", "iphone": "iOS", "ipad": "iOS",
        "鸿蒙": "HarmonyOS", "harmony": "HarmonyOS", "harmonyos": "HarmonyOS",
        "windows": "Windows", "win": "Windows", "mac": "macOS", "macos": "macOS",
        "网页": "Web", "web": "Web", "h5": "Web", "未知": "未知",
    }
    return aliases.get(compact, text or "未知") or "未知"


def _is_low_value_update_text(value: object) -> bool:
    text = _canonical_app_text(value)
    if not text or len(text) < 2:
        return True
    if any(word in text.lower() for word in _METADATA_WORDS):
        # Metadata can contain a useful change sentence after a label; only
        # reject it when no change signal is present.
        if not any(word.lower() in text.lower() for word in _CHANGE_WORDS):
            return True
    if any(pattern.search(text) for pattern in _LOW_VALUE_UPDATE_PATTERNS):
        return True
    # A sentence with no change verb is usually a product description copied
    # from the source page.  Keep it only when it is explicitly labelled as a
    # change by the caller (all normal update summaries contain a change word).
    if not any(word.lower() in text.lower() for word in _CHANGE_WORDS):
        return True
    return False


def _app_text_score(value: object) -> int:
    text = _canonical_app_text(value)
    if _is_low_value_update_text(text):
        return -100
    score = min(len(text), 180) // 10
    score += sum(1 for word in _CHANGE_WORDS if word.lower() in text.lower()) * 10
    if re.search(r"(?:修复|解决|新增|上线|支持|优化|升级|适配|改进|enhanc|fix|add|support|improv)", text, re.I):
        score += 8
    return score


def _clean_update_candidates(values: list[object]) -> list[str]:
    candidates: dict[str, tuple[int, str]] = {}
    for value in values:
        text = _canonical_app_text(value)
        if _is_low_value_update_text(text):
            continue
        key = re.sub(r"[\s，。；;、,:：.!！?？]+", "", text).lower()
        if key not in candidates or _app_text_score(text) > candidates[key][0]:
            candidates[key] = (_app_text_score(text), text)
    return [item[1] for item in sorted(candidates.values(), key=lambda item: (-item[0], item[1]))]


def _snapshot_key(row: dict[str, str], broker_key: str, app_key: str, platform: str, date: str) -> str:
    content_hash = _text(row.get("content_sha256")).lower()
    source_url = _public_source_url(row.get("source_url"))
    if content_hash:
        snapshot = f"hash:{content_hash}"
    else:
        snapshot_payload = {
            "source_url": source_url,
            "app_version": _normalized_app_version(row.get("app_version")),
            "update_type": _canonical_app_text(row.get("update_type")),
            "update_summary": _canonical_app_text(row.get("update_summary")),
            # Keep raw text in the conservative fallback digest.  Dropping
            # low-quality text here would accidentally merge two different
            # no-version snapshots merely because both summaries were later
            # filtered from the display.
            "feature_tags": sorted(_canonical_app_text(item) for item in _json_array(row.get("feature_tags"))),
            "highlights": sorted(_canonical_app_text(item) for item in _json_array(row.get("highlights"))),
        }
        canonical = json.dumps(snapshot_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        snapshot = f"digest:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"
    # Date and platform are intentionally part of an unversioned key.  Two
    # missing-version snapshots from different days/platforms are not assumed
    # to describe the same release.
    return "unversioned|" + "|".join((broker_key, app_key, platform.lower(), date, source_url, snapshot))


def _app_release_key(row: dict[str, str], broker_key: str, app_key: str, platform: str, date: str) -> str:
    version = _normalized_app_version(row.get("app_version"))
    if version:
        return "versioned|" + "|".join((broker_key, app_key, version))
    return _snapshot_key(row, broker_key, app_key, platform, date)


def _merge_platforms(values: list[str]) -> str:
    platforms = {item for item in (_normalized_platform(value) for value in values) if item and item != "未知"}
    if len(platforms) > 1:
        return "全平台"
    return next(iter(platforms), "未知")


def _representative_row(group: list[dict[str, Any]]) -> dict[str, Any]:
    def row_score(row: dict[str, Any]) -> tuple[int, int, int, str, str]:
        summary_score = _app_text_score(row.get("update_summary"))
        highlight_score = max((_app_text_score(item) for item in row.get("highlights", [])), default=-100)
        timestamp = row.get("publish_timestamp") or 0
        # The final lexical fields make the choice independent of CSV row
        # order when two snapshots carry equal-quality text.
        return (summary_score, highlight_score, timestamp, row.get("content_sha256", ""), row.get("source_url", ""))

    return max(group, key=row_score)


def _build_app_updates(path: Path) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in _read_csv(path):
        broker_key, broker_code, broker_name = _app_identity(row)
        app = _canonical_app_text(row.get("app_name"))
        summary = _canonical_app_text(row.get("update_summary"))
        if not (broker_name or broker_code or app or summary):
            continue
        date, timestamp = _parse_date(row.get("publish_date"))
        platform = _normalized_platform(row.get("platform"))
        app_key = _normalized_app_name(app)
        record = {
            "broker_key": broker_key,
            "broker_code": broker_code,
            "broker_name": broker_name,
            "app_name": app,
            "source_url": _public_source_url(row.get("source_url")),
            "content_sha256": _text(row.get("content_sha256")),
            "crawl_time": _text(row.get("crawl_time")),
            "app_version": _canonical_app_text(row.get("app_version")),
            "version_key": _normalized_app_version(row.get("app_version")),
            "platform": platform,
            "publish_date": date,
            "publish_timestamp": timestamp,
            "update_type": _canonical_app_text(row.get("update_type")) or "其他",
            "update_summary": summary,
            "feature_tags": _json_array(row.get("feature_tags")),
            "highlights": _json_array(row.get("highlights")),
            "processed_at": _text(row.get("processed_at")),
        }
        key = _app_release_key(row, broker_key, app_key, platform, date)
        grouped.setdefault(key, []).append(record)

    records: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for key in sorted(grouped):
        group = grouped[key]
        representative = _representative_row(group)
        version_candidates = sorted({row["version_key"] for row in group if row["version_key"]})
        version = version_candidates[0] if version_candidates else ""
        # A versioned group gets a stable identity derived only from its
        # release key.  No crawl timestamp, summary or row order is included.
        record_id = "app-" + hashlib.sha256(key.encode("utf-8")).hexdigest()
        if record_id in used_ids:  # defensive collision guard for malformed keys
            record_id = f"{record_id}-{hashlib.sha1(key.encode('utf-8')).hexdigest()[:12]}"
        used_ids.add(record_id)
        meaningful_summaries = _clean_update_candidates([row["update_summary"] for row in group])
        meaningful_highlights = _clean_update_candidates([item for row in group for item in row["highlights"]])
        update_summary = meaningful_summaries[0] if meaningful_summaries else (meaningful_highlights[0] if meaningful_highlights else "")
        highlights = [item for item in meaningful_highlights if item != update_summary][:5]
        # Prefer update type belonging to the representative meaningful text;
        # otherwise choose a deterministic value without inventing a type.
        typed_rows = [row for row in group if _app_text_score(row["update_summary"]) >= 0 or any(_app_text_score(item) >= 0 for item in row["highlights"])]
        if typed_rows:
            update_type = min(
                typed_rows,
                key=lambda row: (
                    _APP_UPDATE_TYPES.index(row["update_type"]) if row["update_type"] in _APP_UPDATE_TYPES else len(_APP_UPDATE_TYPES),
                    row["update_type"],
                    _canonical_app_text(row["update_summary"]),
                    -(row["publish_timestamp"] or 0),
                ),
            )["update_type"] or "其他"
        else:
            update_type = "其他"
        dates = sorted((row for row in group if row["publish_timestamp"] is not None), key=lambda row: (row["publish_timestamp"], row["publish_date"]), reverse=True)
        latest = dates[0] if dates else representative
        feature_tags = sorted({tag for row in group for tag in (_canonical_app_text(item) for item in row["feature_tags"]) if tag})
        platforms = sorted({row["platform"] for row in group if row["platform"]}, key=lambda value: (_PLATFORM_ORDER.get(value, 50), value))
        content_hashes = sorted({row["content_sha256"] for row in group if row["content_sha256"]})
        content_sha256 = representative["content_sha256"] or (content_hashes[0] if content_hashes else "")
        record = {
            "id": record_id,
            "broker_code": representative["broker_code"] or broker_code,
            "broker_name": representative["broker_name"] or broker_name or representative["broker_code"] or broker_code,
            "app_name": representative["app_name"] or app,
            "source_url": representative["source_url"] or min((row["source_url"] for row in group if row["source_url"]), default=""),
            "content_sha256": content_sha256,
            "crawl_time": latest["crawl_time"],
            "app_version": version or representative["app_version"],
            "platform": _merge_platforms(platforms),
            "publish_date": latest["publish_date"],
            "publish_timestamp": latest["publish_timestamp"],
            "update_type": update_type,
            "update_summary": update_summary,
            "feature_tags": feature_tags,
            "highlights": highlights,
            "processed_at": latest["processed_at"],
        }
        record["search_text"] = "\n".join((record["broker_name"], record["broker_code"], record["app_name"], record["app_version"], record["update_summary"], record["update_type"], " ".join(record["feature_tags"]), " ".join(record["highlights"]))).lower()
        records.append(record)
    return sorted(records, key=lambda item: (item["publish_timestamp"] or 0, item["id"]), reverse=True)


def _analysis(path: Path) -> tuple[dict[str, Any], bool, str | None]:
    if not path.exists():
        return {"content": None, "updated_at": None, "meta": None}, False, "暂无 AI 情报分析缓存"
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return {"content": None, "updated_at": None, "meta": None}, False, "AI 情报分析文件无法解析"
    content = payload.get("content") if isinstance(payload, dict) else None
    if not isinstance(content, str):
        content = payload.get("analysis", {}).get("content") if isinstance(payload, dict) and isinstance(payload.get("analysis"), dict) else None
    meta = payload.get("meta") if isinstance(payload, dict) else None
    updated_at = payload.get("updated_at") if isinstance(payload, dict) else None
    if not isinstance(updated_at, str) and isinstance(payload, dict):
        updated_at = payload.get("updatedAt")
    if not isinstance(updated_at, str) and isinstance(meta, dict):
        updated_at = meta.get("generated_at")
    return {"content": content if isinstance(content, str) else None, "updated_at": updated_at if isinstance(updated_at, str) else None, "meta": meta if isinstance(meta, dict) else None}, bool(content), None if content else "AI 情报分析文件没有可展示内容"


def _fingerprint(path: Path) -> tuple[bool, int, int]:
    try:
        stat = path.stat()
    except OSError:
        return False, 0, 0
    return True, stat.st_mtime_ns, stat.st_size


def _period(records: list[dict[str, Any]], date_key: str = "publish_date") -> dict[str, str | None]:
    dates = [record[date_key] for record in records if record.get(date_key)]
    return {"from": min(dates) if dates else None, "to": max(dates) if dates else None}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _atomic_write(path: Path, body: bytes) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_bytes(body)
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


@dataclass(frozen=True, slots=True)
class PackageArtifact:
    key: str
    filename: str
    body: bytes
    count: int | None
    period: dict[str, str | None] | None
    available: bool
    reason: str | None


@dataclass(frozen=True, slots=True)
class DashboardPackage:
    manifest: dict[str, Any]
    artifacts: dict[str, PackageArtifact]
    manifest_body: bytes | None = None
    matching_baseline_body: bytes | None = None
    app_watch_baseline_body: bytes | None = None

    def body(self, key: str) -> bytes:
        if key == "manifest":
            if self.manifest_body is not None:
                return self.manifest_body
            return json.dumps(self.manifest, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
        return self.artifacts[key].body


def _decoded_records(artifact: PackageArtifact, label: str) -> list[dict[str, Any]]:
    try:
        payload = json.loads(artifact.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{label} 数据无法解析") from exc
    if not isinstance(payload, list) or not all(isinstance(row, dict) for row in payload):
        raise ValueError(f"{label} 数据结构无效")
    return payload


def _json_artifact(
    key: str,
    payload: object,
    *,
    count: int | None,
    period: dict[str, str | None] | None,
    available: bool = True,
    reason: str | None = None,
) -> PackageArtifact:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
    return PackageArtifact(key, PACKAGE_FILES[key], body, count, period, available, reason)


def _merge_record_artifacts(
    key: str,
    base_artifact: PackageArtifact,
    live_artifact: PackageArtifact,
) -> PackageArtifact:
    base_rows = _decoded_records(base_artifact, key)
    live_rows = _decoded_records(live_artifact, key)
    identity_field = "id"
    merged: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(base_rows):
        identity = _text(row.get(identity_field)) or f"base:{index}:{_sha256(json.dumps(row, sort_keys=True, default=str).encode())}"
        merged[identity] = row
    for index, row in enumerate(live_rows):
        identity = _text(row.get(identity_field)) or f"live:{index}:{_sha256(json.dumps(row, sort_keys=True, default=str).encode())}"
        merged[identity] = row
    rows = sorted(
        merged.values(),
        key=lambda row: (row.get("publish_timestamp") or 0, _text(row.get("id"))),
        reverse=True,
    )
    return _json_artifact(key, rows, count=len(rows), period=_period(rows))


def _merge_app_watch_baseline_bodies(base_body: bytes | None, live_body: bytes | None) -> bytes | None:
    if base_body is None:
        return live_body
    if live_body is None:
        return base_body
    rows = [*validate_app_watch_baseline(base_body), *validate_app_watch_baseline(live_body)]
    merged: dict[tuple[str, str, str, str, str, str, str, str], Any] = {}
    for row in rows:
        key = (
            row.broker_code,
            row.source_url,
            row.content_sha256,
            row.app_name,
            row.app_version,
            row.platform,
            row.publish_date,
            row.update_summary,
        )
        current = merged.get(key)
        if current is None or (row.crawl_time, row.processed_at, row.markdown_file) > (
            current.crawl_time,
            current.processed_at,
            current.markdown_file,
        ):
            merged[key] = row
    return app_watch_csv_bytes(list(merged.values()))


def compose_dashboard_package(
    base: DashboardPackage,
    live: DashboardPackage,
    replace_datasets: set[str],
) -> DashboardPackage:
    """Promote selected live datasets into an imported package lineage.

    The imported package remains the authority for every dataset that the
    successful task did not update. Overview, filters and all integrity
    metadata are rebuilt from the resulting snapshot.
    """

    replaceable = {"tender_projects", "app_updates", "ai_analysis"}
    if not replace_datasets or not replace_datasets <= replaceable:
        raise ValueError("工作包提升的数据集范围无效")
    selected = {key: base.artifacts[key] for key in ("tender_projects", "app_updates", "ai_analysis")}
    for key in replace_datasets:
        selected[key] = (
            live.artifacts[key]
            if key == "ai_analysis"
            else _merge_record_artifacts(key, base.artifacts[key], live.artifacts[key])
        )
    tenders = _decoded_records(selected["tender_projects"], "tender_projects")
    app_updates = _decoded_records(selected["app_updates"], "app_updates")
    generated_at = datetime.now(timezone.utc).isoformat()
    overview = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "tender_projects": {
            "record_count": len(tenders),
            "broker_count": len({
                _text(row.get("broker_name"))
                for row in tenders
                if _text(row.get("broker_name")).lower() not in INVALID_BROKERS
                and row.get("is_broker_project") is not False
            }),
            "fintech_count": sum(1 for row in tenders if row.get("is_fintech") is True),
            "period": _period(tenders),
        },
        "app_updates": {
            "record_count": len(app_updates),
            "broker_count": len({
                _text(row.get("broker_name") or row.get("broker_code"))
                for row in app_updates
                if _text(row.get("broker_name") or row.get("broker_code"))
            }),
            "app_count": len({
                f"{_text(row.get('broker_code') or row.get('broker_name'))}||{_text(row.get('app_name'))}"
                for row in app_updates
                if _text(row.get("app_name"))
            }),
            "period": _period(app_updates),
        },
    }
    filters = {
        "schema_version": SCHEMA_VERSION,
        "procurement": {
            "brokers": sorted({
                _text(row.get("broker_name"))
                for row in tenders
                if _text(row.get("broker_name")).lower() not in INVALID_BROKERS
                and row.get("is_broker_project") is not False
            }),
            "domains": sorted({_text(row.get("primary_domain")) for row in tenders if _text(row.get("primary_domain"))}),
            "stages": ["采购招标", "结果公示", "流标废标", "其他"],
            "procurement_methods": sorted({_text(row.get("procurement_method")) for row in tenders if _text(row.get("procurement_method"))}),
            "default_time_range": "90d",
            "default_fintech_only": True,
        },
        "app_updates": {
            "brokers": sorted({_text(row.get("broker_name")) for row in app_updates if _text(row.get("broker_name"))}),
            "apps": sorted({_text(row.get("app_name")) for row in app_updates if _text(row.get("app_name"))}),
            "update_types": sorted({_text(row.get("update_type")) for row in app_updates if _text(row.get("update_type"))}),
            "feature_tags": sorted({
                _text(tag)
                for row in app_updates
                for tag in (row.get("feature_tags") if isinstance(row.get("feature_tags"), list) else [])
                if _text(tag)
            }),
        },
    }
    artifacts = {
        "overview": _json_artifact("overview", overview, count=1, period=None),
        "filters": _json_artifact("filters", filters, count=1, period=None),
        **selected,
    }
    matching_baseline_body = (
        live.matching_baseline_body
        if "tender_projects" in replace_datasets
        else base.matching_baseline_body
    )
    app_watch_baseline_body = (
        _merge_app_watch_baseline_bodies(
            base.app_watch_baseline_body,
            live.app_watch_baseline_body,
        )
        if "app_updates" in replace_datasets
        else base.app_watch_baseline_body
    )
    package_hash = _sha256(
        b"".join(artifacts[key].body for key in REQUIRED_KEYS)
        + (matching_baseline_body or b"")
        + (app_watch_baseline_body or b"")
    )[:20]
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "minimum_reader_version": READER_VERSION,
        "package_version": f"dashboard-{package_hash}",
        "generated_at": generated_at,
        "source": "世纪证券业务信息平台标准化导出",
        "timezone": "UTC",
        "datasets": {
            key: {
                "file": artifact.filename,
                "record_count": artifact.count,
                "bytes": len(artifact.body),
                "sha256": _sha256(artifact.body),
                "available": artifact.available,
                "reason": artifact.reason,
                "period": artifact.period,
            }
            for key, artifact in artifacts.items()
        },
        "matching_baseline": (
            {
                "file": BASELINE_FILENAME,
                "bytes": len(matching_baseline_body),
                "sha256": _sha256(matching_baseline_body),
                "available": True,
            }
            if matching_baseline_body is not None
            else {"file": BASELINE_FILENAME, "bytes": 0, "sha256": None, "available": False}
        ),
        "app_watch_baseline": (
            {
                "file": APP_WATCH_BASELINE_FILENAME,
                "bytes": len(app_watch_baseline_body),
                "sha256": _sha256(app_watch_baseline_body),
                "record_count": sum(1 for line in app_watch_baseline_body.decode("utf-8-sig").splitlines()[1:] if line.strip()),
                "available": True,
                "skip_ready": app_watch_baseline_skip_ready(app_watch_baseline_body),
            }
            if app_watch_baseline_body is not None
            else {
                "file": APP_WATCH_BASELINE_FILENAME,
                "bytes": 0,
                "sha256": None,
                "record_count": 0,
                "available": False,
                "skip_ready": False,
            }
        ),
    }
    return DashboardPackage(
        manifest,
        artifacts,
        matching_baseline_body=matching_baseline_body,
        app_watch_baseline_body=app_watch_baseline_body,
    )


class DashboardPackageBuilder:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._fingerprint: tuple[tuple[bool, int, int], ...] | None = None
        self._package: DashboardPackage | None = None

    def source_paths(self) -> dict[str, Path]:
        return {
            "tender_projects": settings.announcement_csv_path,
            "app_updates": settings.app_releases_csv_path,
            "ai_analysis": settings.ai_analysis_cache_path,
        }

    def matching_baseline_paths(self) -> dict[str, Path] | None:
        required = (
            "matching_procurement_csv_path",
            "matching_result_csv_path",
            "matching_verified_links_path",
        )
        if not all(hasattr(settings, name) for name in required):
            return None
        return {
            "procurement": settings.matching_procurement_csv_path,
            "result": settings.matching_result_csv_path,
            "verified_links": settings.matching_verified_links_path,
        }

    def export_manifest_path(self) -> Path:
        return settings.dashboard_data_export_dir / "manifest.json"

    def build(self, force: bool = False, *, paths_override: dict[str, Path] | None = None) -> DashboardPackage:
        paths = paths_override or self.source_paths()
        baseline_paths = self.matching_baseline_paths()
        fingerprint_paths = [paths[key] for key in ("tender_projects", "app_updates", "ai_analysis")]
        if baseline_paths:
            fingerprint_paths.extend(baseline_paths.values())
        fingerprint = tuple(_fingerprint(path) for path in fingerprint_paths)
        with self._lock:
            if not force and self._package is not None and self._fingerprint == fingerprint:
                return self._package
            tenders = _build_tenders(paths["tender_projects"])
            app_updates = _build_app_updates(paths["app_updates"])
            analysis, analysis_available, analysis_reason = _analysis(paths["ai_analysis"])
            overview = {
                "schema_version": SCHEMA_VERSION,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "tender_projects": {
                    "record_count": len(tenders),
                    "broker_count": len({r["broker_name"] for r in tenders if r["broker_name"].lower() not in INVALID_BROKERS and r["is_broker_project"] is not False}),
                    "fintech_count": sum(1 for r in tenders if r["is_fintech"]),
                    "period": _period(tenders),
                },
                "app_updates": {
                    "record_count": len(app_updates),
                    "broker_count": len({r["broker_name"] or r["broker_code"] for r in app_updates if r["broker_name"] or r["broker_code"]}),
                    "app_count": len({f"{r['broker_code'] or r['broker_name']}||{r['app_name']}" for r in app_updates if r["app_name"]}),
                    "period": _period(app_updates),
                },
            }
            filter_payload = {
                "schema_version": SCHEMA_VERSION,
                "procurement": {
                    "brokers": sorted({r["broker_name"] for r in tenders if r["broker_name"].lower() not in INVALID_BROKERS and r["is_broker_project"] is not False}, key=lambda value: value),
                    "domains": sorted({r["primary_domain"] for r in tenders}),
                    "stages": ["采购招标", "结果公示", "流标废标", "其他"],
                    "procurement_methods": sorted({r["procurement_method"] for r in tenders if r["procurement_method"]}),
                    "default_time_range": "90d",
                    "default_fintech_only": True,
                },
                "app_updates": {
                    "brokers": sorted({r["broker_name"] for r in app_updates if r["broker_name"]}),
                    "apps": sorted({r["app_name"] for r in app_updates if r["app_name"]}),
                    "update_types": sorted({r["update_type"] for r in app_updates}),
                    "feature_tags": sorted({tag for r in app_updates for tag in r["feature_tags"]}),
                },
            }
            artifacts: dict[str, PackageArtifact] = {}
            raw_payloads = {
                "overview": (overview, 1, None, True, None),
                "filters": (filter_payload, 1, None, True, None),
                "tender_projects": (tenders, len(tenders), _period(tenders), bool(tenders) or paths["tender_projects"].exists(), None if tenders or paths["tender_projects"].exists() else "正式招采数据文件不存在"),
                "app_updates": (app_updates, len(app_updates), _period(app_updates), bool(app_updates), "暂无券商 App 更新数据" if not app_updates else None),
                "ai_analysis": (analysis, 1 if analysis_available else 0, None, analysis_available, analysis_reason),
            }
            for key, (payload, count, period, available, reason) in raw_payloads.items():
                body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
                artifacts[key] = PackageArtifact(key, PACKAGE_FILES[key], body, count, period, available, reason)
            generated_at = overview["generated_at"]
            datasets = {
                key: {
                    "file": artifact.filename,
                    "record_count": artifact.count,
                    "bytes": len(artifact.body),
                    "sha256": _sha256(artifact.body),
                    "available": artifact.available,
                    "reason": artifact.reason,
                    "period": artifact.period,
                }
                for key, artifact in artifacts.items()
            }
            baseline = build_matching_baseline(baseline_paths) if baseline_paths else None
            baseline_body = (
                json.dumps(baseline, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
                if baseline is not None
                else None
            )
            app_watch_baseline_body = build_app_watch_baseline(paths["app_updates"])
            package_hash = _sha256(
                b"".join(artifacts[key].body for key in REQUIRED_KEYS)
                + (baseline_body or b"")
                + (app_watch_baseline_body or b"")
            )[:20]
            manifest = {
                "schema_version": SCHEMA_VERSION,
                "minimum_reader_version": READER_VERSION,
                "package_version": f"dashboard-{package_hash}",
                "generated_at": generated_at,
                "source": "世纪证券业务信息平台标准化导出",
                "timezone": "UTC",
                "datasets": datasets,
                "matching_baseline": (
                    {
                        "file": BASELINE_FILENAME,
                        "bytes": len(baseline_body),
                        "sha256": _sha256(baseline_body),
                        "available": True,
                    }
                    if baseline_body is not None
                    else {"file": BASELINE_FILENAME, "bytes": 0, "sha256": None, "available": False}
                ),
                "app_watch_baseline": (
                    {
                        "file": APP_WATCH_BASELINE_FILENAME,
                        "bytes": len(app_watch_baseline_body),
                        "sha256": _sha256(app_watch_baseline_body),
                        "record_count": len(_read_csv(paths["app_updates"])),
                        "available": True,
                        "skip_ready": app_watch_baseline_skip_ready(app_watch_baseline_body),
                    }
                    if app_watch_baseline_body is not None
                    else {
                        "file": APP_WATCH_BASELINE_FILENAME,
                        "bytes": 0,
                        "sha256": None,
                        "record_count": 0,
                        "available": False,
                        "skip_ready": False,
                    }
                ),
            }
            self._fingerprint = fingerprint
            self._package = DashboardPackage(
                manifest,
                artifacts,
                matching_baseline_body=baseline_body,
                app_watch_baseline_body=app_watch_baseline_body,
            )
            return self._package

    def export(
        self,
        package: DashboardPackage | None = None,
        target: Path | None = None,
        write_zip: bool = True,
    ) -> Path:
        package = package or self.build()
        target = (target or settings.dashboard_data_export_dir).resolve()
        target.mkdir(parents=True, exist_ok=True)
        for key in ("manifest", *REQUIRED_KEYS):
            filename = "manifest.json" if key == "manifest" else package.artifacts[key].filename
            _atomic_write(target / filename, package.body(key))
        if package.matching_baseline_body is not None:
            _atomic_write(target / BASELINE_FILENAME, package.matching_baseline_body)
        else:
            (target / BASELINE_FILENAME).unlink(missing_ok=True)
        if package.app_watch_baseline_body is not None:
            _atomic_write(target / APP_WATCH_BASELINE_FILENAME, package.app_watch_baseline_body)
        else:
            (target / APP_WATCH_BASELINE_FILENAME).unlink(missing_ok=True)
        if write_zip:
            zip_target = target.with_suffix(".zip")
            zip_temp = zip_target.with_name(f".{zip_target.name}.{os.getpid()}.tmp")
            try:
                with zipfile.ZipFile(zip_temp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                    for key in ("manifest", *REQUIRED_KEYS):
                        filename = "manifest.json" if key == "manifest" else package.artifacts[key].filename
                        archive.writestr(f"dashboard-data/{filename}", package.body(key))
                    if package.matching_baseline_body is not None:
                        archive.writestr(
                            f"dashboard-data/{BASELINE_FILENAME}", package.matching_baseline_body
                        )
                    if package.app_watch_baseline_body is not None:
                        archive.writestr(
                            f"dashboard-data/{APP_WATCH_BASELINE_FILENAME}",
                            package.app_watch_baseline_body,
                        )
                os.replace(zip_temp, zip_target)
            finally:
                try:
                    zip_temp.unlink()
                except FileNotFoundError:
                    pass
        return target


dashboard_package_builder = DashboardPackageBuilder()


def package_zip_bytes(package: DashboardPackage | None = None) -> bytes:
    package = package or dashboard_package_builder.build()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for key in ("manifest", *REQUIRED_KEYS):
            filename = "manifest.json" if key == "manifest" else package.artifacts[key].filename
            archive.writestr(f"dashboard-data/{filename}", package.body(key))
        if package.matching_baseline_body is not None:
            archive.writestr(
                f"dashboard-data/{BASELINE_FILENAME}", package.matching_baseline_body
            )
        if package.app_watch_baseline_body is not None:
            archive.writestr(
                f"dashboard-data/{APP_WATCH_BASELINE_FILENAME}",
                package.app_watch_baseline_body,
            )
    return output.getvalue()
