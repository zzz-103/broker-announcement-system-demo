from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover - runtime dependency guard
    OpenAI = None


ROOT_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ROOT_DIR.parent
DEFAULT_INPUT_DIR = ROOT_DIR / "documents" / "markdown"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "documents" / "structured_announcements"
DEFAULT_LLM_CONFIG_PATH = ROOT_DIR / "config" / "llm_api_config.json"

BROKER_ALIAS_HINTS: dict[str, tuple[str, ...]] = {
    "boci_securities": ("boci", "bc"),
    "chengtong_securities": ("chengtong", "ct"),
    "china_galaxy_securities": ("galaxy", "cg", "cgs"),
    "citic_securities": ("citic", "cs", "zx"),
    "dongguan_securities": ("dongguan", "dg"),
    "everbright_securities": ("everbright", "eb", "gd"),
    "guangfa_securities": ("guangfa", "gf"),
    "huaxi_securities": ("huaxi", "hx"),
    "northeast_securities": ("northeast", "ne", "db"),
    "shanxi_securities": ("shanxi", "sx"),
    "xingye_securities": ("xingye", "xy"),
    "zhongtai_securities": ("zhongtai", "zt"),
    "zhongyuan_securities": ("zhongyuan", "zy"),
}

TABLE_FIELDS = [
    # ==========================================
    # 第一部分：系统元数据 (Meta) - 由你的Python程序自动记录，用于排错和溯源
    # ==========================================
    "broker_folder",        # 来源文件夹 (如 huaxi_securities)
    "markdown_file",        # 原始Markdown文件名
    "document_sha1",        # 文件哈希值 (强烈建议保留，用于看板数据去重)
    "processed_at",         # 处理时间
    "raw_json_path",        # 原始JSON存储路径 (排查大模型幻觉时溯源用)

    # ==========================================
    # 第二部分：看板核心业务数据 - 由大模型(LLM)按扁平化 Array 提取输出
    # ==========================================
    "broker_name",          # 券商名称 (看板过滤维度：查看特定券商)
    "publish_date",         # 发布日期 (看板时间轴：YYYY-MM-DD，筛选近1-2个月)
    "announcement_stage",   # 公告阶段 (看板分类器：采购招标 / 结果公示 / 流标废标)
    "procurement_category", # 行业类别 (看板饼图维度：IT软硬件 / 专业及金融服务 / 其他)
    "project_subcategory",  # 二级细分品类 (新增：看板核心下钻维度)
    "project_name",         # 项目/标段名称 (数据表格明细)
    "procurement_method",   # 采购方式 (看板辅助维度：如 单一来源、公开招标)
    "procurement_action",   # 采购主要动作 (新购、扩容、升级改造、维保等)

    "procurement_scope_summary", # 一句话概括采购内容、数量及核心规格

    "budget_amount_yuan",   # 采购预算，单位元
    "ceiling_price_yuan",   # 最高限价，单位元
    "winning_amount_yuan",  # 中标/成交金额纯数字_元 (看板核心度量值，招标阶段为 null)

    "bid_deadline_at",      # 投标、响应或报价截止时间
    "service_period_months", # 服务期、合同期，统一换算为月
    "delivery_period_days",  # 明确的整体交付或实施周期，统一换算为天

    "winning_supplier",     # 中标/成交供应商 (看谁赚了钱，招标阶段为 null)
]

SYSTEM_PROMPT = """你是一个专为 BI 数据看板准备底层数据的数据工程师。
你的任务是阅读券商的招标/中标 Markdown 公告，提取最核心的信息，并输出为扁平的 JSON 数组。

【硬性约束与处理逻辑】
1. 扁平结构：哪怕公告有多个标段，也请输出一个包含多个 JSON 对象的数组（Array）。

2. 分类树强制枚举 (procurement_category & project_subcategory)：
   你必须根据项目内容，从以下规定的【一级类别】和对应的【二级细分品类】中挑选最合适的一项。严禁自行创造词汇！
   
   ▶ 若属于 "IT软硬件" (一级)，二级细分必须从以下挑选：
      - "网络与信息安全" (如防火墙、密管机、安全漏扫、零信任等)
      - "基础算力与云存储" (如服务器、云平台节点、机柜租用、数据库等)
      - "业务系统与软件" (如交易系统定制、APP开发、办公软件正版化、业务终端等)
      - "IT运维与外包" (如驻场开发、系统维保服务、IT技术支持等)
   
   ▶ 若属于 "专业及金融服务" (一级)，二级细分必须从以下挑选：
      - "法律与合规服务" (如律所聘请、常年法律顾问等)
      - "审计与咨询服务" (如财务审计、管理咨询等)
      - "人力与外包服务" (如人事档案审核、劳务派遣、员工体检等)
      - "营销与投研数据" (如广告投放、采购万得/彭博终端数据等)
      
   ▶ 若属于 "其他" (一级)，二级细分必须从以下挑选：
      - "行政与办公后勤" (如AED急救设备、办公家具、桶装水等)
      - "工程装修与物业" (如新址装修、空调改造、安保保洁等)
      - "其他未分类" (确实无法归入以上的)

3. 公告阶段 (announcement_stage) 强制枚举：
   - ["采购招标", "结果公示", "流标废标"]。只有邀请投标阶段选"采购招标"，单一来源/中标选"结果公示"。

4. 预算、限价、成交金额提取规则：
   - `budget_amount_yuan`：只填写公告明确披露的采购预算、项目预算或预算金额。
   - `ceiling_price_yuan`：只填写最高限价、采购控制价、最高投标限价。
   - `winning_amount_yuan`：只填写中标、成交或最终采购金额。
   - 三个金额字段必须严格区分，禁止相互替代。
   - 招标或采购公告阶段没有成交结果时，`winning_amount_yuan` 必须为 `null`。
   - 公告没有明确披露对应金额时，必须输出 `null`，禁止推测。
   - 所有金额统一换算为人民币元的数字。
   - 示例：
     - 150万元 → 1500000
     - 2.8亿元 → 280000000
     - 500000元 → 500000

5. 截止时间 (bid_deadline_at)：
   - 提取投标截止时间、响应文件递交截止时间、报价截止时间或磋商响应截止时间。
   - 统一格式：YYYY-MM-DD HH:MM
   - 如果公告只写日期，没有具体时分，则输出：YYYY-MM-DD
   - 提取优先级：1. 投标文件递交截止时间；2. 响应文件递交截止时间；3. 报价截止时间；4. 项目参与截止时间。
   - 不要提取招标文件获取截止时间代替投标截止时间。
   - 公告未披露或格式无法识别时输出 null。

6. 服务期限 (service_period_months)：
   - 表示服务期、合同期限、租赁期限或维保期限。
   - 统一换算为月。
   - 示例：3年 → 36；2年 → 24；6个月 → 6；1年6个月 → 18。
   - 没有明确期限时输出 null。

7. 交付周期 (delivery_period_days)：
   - 表示公告明确披露的整体到货、交付、上线或实施完成周期。
   - 统一换算为天。
   - 示例：4周 → 28；30日 → 30；1个月 → 30。
   - 只有公告明确给出整体交付或最终实施完成周期时才填写。
   - 如果公告分别给出到货周期和部署周期，但无法明确判断总周期，不要自行相加，输出 null。多阶段周期可以在 `procurement_scope_summary` 中简要体现。
   - 禁止根据经验推测交付周期。没有明确周期时输出 null。

8. 采购概况摘要 (procurement_scope_summary)：
   - 用一句话概括：采购什么；数量或规模；核心品牌、容量、服务年限或关键规格。
   - 长度建议控制在30至80个中文字符。
   - 只保留对领导查看有价值的信息，不要包含供应商资格条件、报名方式、联系人、联系电话、开标地址、CA证书要求或投诉信息。
   - 示例：
     - 租赁1台高性能低时延服务器
     - 采购2套华为全闪信创SAN存储，单台可用容量不低于80TB
     - 采购投教及财经资讯数据服务，服务期3年

9. 采购主要动作 (procurement_action)：
   - 判断本项目最主要的采购动作，只能从以下枚举中选择：
     ["新购", "扩容", "升级改造", "续采续约", "维保", "租赁", "服务订阅", "替换迁移", "其他"]
   - 判断规则：
     1. 明确采购新增设备、新建系统或首次引入服务，填写“新购”。
     2. 明确增加容量、设备、节点、账号、席位或资源，填写“扩容”。
     3. 明确升级、改造、优化现有设备或系统，填写“升级改造”。
     4. 明确续签、续订、续租或延续原有采购，填写“续采续约”。
     5. 采购内容主要为维护、维保、保修或技术支持，填写“维保”。
     6. 以租赁服务器、设备、场地或其他资源为主，填写“租赁”。
     7. 采购数据、资讯、软件许可或周期性服务，但公告未明确属于续采，填写“服务订阅”。
     8. 明确涉及国产化替换、旧设备替换、系统迁移或产品迁移，填写“替换迁移”。
     9. 只有公告明确表达相关采购背景时才能判断，禁止仅根据项目名称主观推测。
     10. 无法准确判断时填写“其他”。
   - 注意区分：
     - 普通采购信创设备，不一定是“替换迁移”；只有明确提到替换、迁移、国产化改造时才填写“替换迁移”。
     - 普通数据服务采购填写“服务订阅”；只有明确写明续签、续订或原合同延续时才填写“续采续约”。
     - 购买服务器填写“新购”，租用服务器填写“租赁”。

10. 日期标准化：(publish_date) 统一格式为 "YYYY-MM-DD"。

【输出格式严格要求】
必须且只能输出一个合法的 JSON 数组，禁止任何解释性文字或 Markdown 代码块标记。

[
  {
    "broker_name": "string (券商名称，如 '中信证券')",
    "publish_date": "string|null (YYYY-MM-DD)",
    "announcement_stage": "采购招标 | 结果公示 | 流标废标",
    "procurement_category": "IT软硬件 | 专业及金融服务 | 其他",
    "project_subcategory": "string (严格按照上述给定的二级字典输出)",
    "project_name": "string (项目名称或标段名称)",
    "procurement_method": "string|null (公开招标、单一来源等)",
    "procurement_action": "新购 | 扩容 | 升级改造 | 续采续约 | 维保 | 租赁 | 服务订阅 | 替换迁移 | 其他",
    "procurement_scope_summary": "string|null (一句话概括采购内容、数量及核心规格)",
    "budget_amount_yuan": "number|null (采购预算，单位元)",
    "ceiling_price_yuan": "number|null (最高限价，单位元)",
    "winning_amount_yuan": "number|null (成交金额，单位元)",
    "bid_deadline_at": "string|null (YYYY-MM-DD HH:MM 或 YYYY-MM-DD)",
    "service_period_months": "number|null (服务期，单位月)",
    "delivery_period_days": "number|null (交付周期，单位天)",
    "winning_supplier": "string|null (招标阶段为null)",
    "source_file": "string (填入 markdown_file 元数据)"
"""

USER_PROMPT_TEMPLATE = """请严格按照 JSON Array 格式提取以下公告。

【已知元数据】
- markdown_file: {markdown_file}

【Markdown 原文】
<<<MARKDOWN
{markdown}
MARKDOWN
"""


@dataclass(slots=True)
class FileExtractionResult:
    rows: list[dict[str, Any]]
    raw_payload: Any | None
    error: str | None = None


@dataclass(slots=True)
class FileProcessingPlan:
    path: Path
    force_refresh: bool
    reason: str


@dataclass(slots=True)
class IncrementalSelectionResult:
    plans: list[FileProcessingPlan]
    skipped_files: list[Path]
    new_files: list[Path]
    changed_files: list[Path]


@dataclass(slots=True)
class LLMApiConfig:
    base_url: str
    api_key: str
    model: str
    temperature: float = 0.1
    top_p: float = 1.0
    max_tokens: int = 16384
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    timeout_seconds: int = 180
    use_json_object: bool = True

    @classmethod
    def load(cls, config_path: Path) -> "LLMApiConfig":
        payload = json.loads(config_path.read_text(encoding="utf-8"))
        api_key = os.environ.get("LLM_API_KEY")
        if api_key is None:
            api_key = str(payload.get("api_key", "")).strip()
        else:
            api_key = api_key.strip()
        return cls(
            base_url=str(payload.get("base_url", "")).strip(),
            api_key=api_key,
            model=str(payload.get("model", "")).strip(),
            temperature=float(payload.get("temperature", 0.1)),
            top_p=float(payload.get("top_p", 1.0)),
            max_tokens=int(payload.get("max_tokens", 16384)),
            frequency_penalty=float(payload.get("frequency_penalty", 0.0)),
            presence_penalty=float(payload.get("presence_penalty", 0.0)),
            timeout_seconds=int(payload.get("timeout_seconds", 180)),
            use_json_object=bool(payload.get("use_json_object", True)),
        )

    def validate(self) -> None:
        if not self.base_url:
            raise ValueError("llm_api_config.json 缺少 base_url")
        if not self.api_key:
            raise ValueError("llm_api_config.json 缺少 api_key")
        if not self.model:
            raise ValueError("llm_api_config.json 缺少 model")


class OpenAICompatibleClient:
    def __init__(
        self,
        config: LLMApiConfig,
    ) -> None:
        if OpenAI is None:
            raise ImportError(
                "缺少 openai 依赖，请先执行 `uv pip install openai` 或在当前环境中安装 openai。"
            )
        self.config = config
        self.client = OpenAI(
            base_url=self.config.base_url,
            api_key=self.config.api_key,
            timeout=self.config.timeout_seconds,
        )

    def extract(self, markdown: str, metadata: dict[str, str]) -> Any:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": USER_PROMPT_TEMPLATE.format(
                    broker_folder=metadata["broker_folder"],
                    markdown_file=metadata["markdown_file"],
                    relative_path=metadata["relative_path"],
                    markdown=markdown,
                ),
            },
        ]
        request_kwargs: dict[str, Any] = {
            "temperature": self.config.temperature,
            "top_p": self.config.top_p,
            "max_tokens": self.config.max_tokens,
            "frequency_penalty": self.config.frequency_penalty,
            "presence_penalty": self.config.presence_penalty,
            "model": self.config.model,
            "messages": messages,
        }

        return self._request_json(request_kwargs)

    def _request_json(self, request_kwargs: dict[str, Any]) -> Any:
        # #region debug-point B:openai-request-start
        report_debug_event(
            hypothesis_id="B",
            location="llm_markdown_table_builder.py:OpenAICompatibleClient._request_json:start",
            msg="about to call chat.completions.create",
            data={
                "model": self.config.model,
                "timeout_seconds": self.config.timeout_seconds,
                "max_tokens": self.config.max_tokens,
                "message_count": len(request_kwargs.get("messages", [])),
            },
            trace_id=str(time.time_ns()),
        )
        # #endregion
        response = self.client.chat.completions.create(**request_kwargs)
        # #region debug-point B:openai-request-end
        report_debug_event(
            hypothesis_id="B",
            location="llm_markdown_table_builder.py:OpenAICompatibleClient._request_json:end",
            msg="chat.completions.create returned",
            data={
                "model": self.config.model,
                "timeout_seconds": self.config.timeout_seconds,
            },
        )
        # #endregion
        content = self._extract_message_content(response)
        return parse_json_text(content)

    @staticmethod
    def _extract_message_content(response: Any) -> str:
        choices = getattr(response, "choices", None) or []
        if not choices:
            raise ValueError(f"API response missing choices: {response}")
        message = getattr(choices[0], "message", None)
        if message is None:
            raise ValueError(f"API response missing message: {response}")
        content = getattr(message, "content", None)
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            text_fragments: list[str] = []
            for item in content:
                item_type = getattr(item, "type", None)
                item_text = getattr(item, "text", None)
                if item_type == "text" and item_text:
                    text_fragments.append(str(item_text))
                elif isinstance(item, dict) and item.get("type") == "text":
                    text_fragments.append(str(item.get("text", "")))
            if text_fragments:
                return "\n".join(text_fragments)
        raise ValueError(f"API response missing message content: {response}")


def parse_json_text(text: str) -> Any:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    array_start = cleaned.find("[")
    array_end = cleaned.rfind("]")
    object_start = cleaned.find("{")
    object_end = cleaned.rfind("}")

    candidates: list[str] = []
    if array_start >= 0 and array_end > array_start:
        candidates.append(cleaned[array_start : array_end + 1])
    if object_start >= 0 and object_end > object_start:
        candidates.append(cleaned[object_start : object_end + 1])

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    raise ValueError(f"Unable to parse JSON from model output: {text[:500]}")


def emit_progress(stage: str, progress: int, message: str) -> None:
    payload = {
        "stage": stage,
        "progress": max(0, min(100, int(progress))),
        "message": message,
    }
    print(f"::progress::{json.dumps(payload, ensure_ascii=False)}", flush=True)


def atomic_temp_path(target_path: Path) -> Path:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    suffix = target_path.suffix
    return target_path.with_name(
        f".{target_path.stem}.{os.getpid()}.{time.time_ns()}.tmp{suffix}"
    )


def atomic_write_text(target_path: Path, content: str, encoding: str = "utf-8") -> None:
    temp_path = atomic_temp_path(target_path)
    try:
        temp_path.write_text(content, encoding=encoding)
        os.replace(temp_path, target_path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def discover_markdown_files(input_dir: Path, broker_folders: set[str] | None) -> list[Path]:
    files = sorted(input_dir.rglob("*.md"))
    if broker_folders:
        files = [path for path in files if path.parent.name in broker_folders]
    return files


def discover_broker_folders(input_dir: Path) -> list[str]:
    if not input_dir.exists():
        return []
    folders = [path.name for path in input_dir.iterdir() if path.is_dir()]
    return sorted(folders)


def read_jsonl_rows(jsonl_path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not jsonl_path.exists():
        return rows
    for line in jsonl_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        payload = json.loads(line)
        if isinstance(payload, dict):
            rows.append(payload)
    return rows


def read_csv_rows(csv_path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not csv_path.exists():
        return rows
    with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            rows.append({field: row.get(field, "") for field in TABLE_FIELDS})
    return rows


def load_existing_output_rows(output_dir: Path) -> list[dict[str, Any]]:
    jsonl_path = output_dir / "announcement_table.jsonl"
    csv_path = output_dir / "announcement_table.csv"

    rows = read_jsonl_rows(jsonl_path)
    if not rows:
        rows = read_csv_rows(csv_path)
    return [normalize_row_fields(row) for row in rows]


def row_file_key(row: dict[str, Any]) -> tuple[str, str]:
    return (
        normalize_scalar(row.get("broker_folder")),
        normalize_scalar(row.get("markdown_file")),
    )


def path_file_key(path: Path) -> tuple[str, str]:
    return path.parent.name, path.name


def build_existing_sha1_map(rows: list[dict[str, Any]]) -> dict[tuple[str, str], str]:
    sha1_map: dict[tuple[str, str], str] = {}
    for row in rows:
        file_key = row_file_key(row)
        document_sha1 = normalize_scalar(row.get("document_sha1"))
        if not file_key[0] or not file_key[1]:
            continue
        if document_sha1:
            sha1_map[file_key] = document_sha1
        else:
            sha1_map.setdefault(file_key, "")
    return sha1_map


def select_files_for_processing(
    files: list[Path],
    output_dir: Path,
    incremental: bool,
    overwrite: bool,
) -> IncrementalSelectionResult:
    if not incremental:
        return IncrementalSelectionResult(
            plans=[
                FileProcessingPlan(path=path, force_refresh=overwrite, reason="full_refresh")
                for path in files
            ],
            skipped_files=[],
            new_files=[],
            changed_files=[],
        )

    existing_rows = load_existing_output_rows(output_dir)
    existing_sha1_map = build_existing_sha1_map(existing_rows)
    plans: list[FileProcessingPlan] = []
    skipped_files: list[Path] = []
    new_files: list[Path] = []
    changed_files: list[Path] = []

    for path in files:
        if overwrite:
            plans.append(FileProcessingPlan(path=path, force_refresh=True, reason="overwrite"))
            changed_files.append(path)
            continue

        markdown = path.read_text(encoding="utf-8").strip()
        current_sha1 = sha1_text(markdown)
        existing_sha1 = existing_sha1_map.get(path_file_key(path))

        if existing_sha1 is None:
            new_files.append(path)
            plans.append(FileProcessingPlan(path=path, force_refresh=False, reason="new_file"))
            continue

        if existing_sha1 and existing_sha1 == current_sha1:
            skipped_files.append(path)
            continue

        changed_files.append(path)
        plans.append(FileProcessingPlan(path=path, force_refresh=True, reason="content_changed"))

    return IncrementalSelectionResult(
        plans=plans,
        skipped_files=skipped_files,
        new_files=new_files,
        changed_files=changed_files,
    )


def merge_rows_by_file(
    existing_rows: list[dict[str, Any]],
    new_rows: list[dict[str, Any]],
    replaced_file_keys: set[tuple[str, str]],
) -> list[dict[str, Any]]:
    preserved_rows = [
        row for row in existing_rows
        if row_file_key(row) not in replaced_file_keys
    ]
    return preserved_rows + new_rows


def broker_stem(folder_name: str) -> str:
    return re.sub(r"_securities$", "", folder_name)


def broker_aliases(folder_name: str) -> list[str]:
    aliases: list[str] = [folder_name]
    stem = broker_stem(folder_name)
    if stem != folder_name:
        aliases.append(stem)
    for alias in BROKER_ALIAS_HINTS.get(folder_name, ()):
        if alias not in aliases:
            aliases.append(alias)
    return aliases


def resolve_broker_folders(selectors: list[str] | None, available_folders: list[str]) -> set[str] | None:
    if not selectors:
        return None

    available_set = set(available_folders)
    alias_to_folder: dict[str, str] = {}
    for folder_name in available_folders:
        for alias in broker_aliases(folder_name):
            alias_key = alias.lower()
            existing = alias_to_folder.get(alias_key)
            if existing and existing != folder_name:
                continue
            alias_to_folder[alias_key] = folder_name

    resolved: set[str] = set()
    for selector in selectors:
        selector_key = selector.strip().lower()
        if not selector_key:
            continue
        exact_match = alias_to_folder.get(selector_key)
        if exact_match:
            resolved.add(exact_match)
            continue

        prefix_matches = sorted(
            folder_name
            for folder_name in available_folders
            if folder_name.lower().startswith(selector_key)
            or broker_stem(folder_name).lower().startswith(selector_key)
        )
        if len(prefix_matches) == 1:
            resolved.add(prefix_matches[0])
            continue
        if len(prefix_matches) > 1:
            raise ValueError(
                f"券商选择 `{selector}` 存在歧义，可匹配: {', '.join(prefix_matches)}"
            )
        raise ValueError(
            f"未识别的券商选择 `{selector}`。可先执行 `--list-brokers` 查看可用目录与缩写。"
        )

    unknown_folders = resolved - available_set
    if unknown_folders:
        raise ValueError(f"未找到券商目录: {', '.join(sorted(unknown_folders))}")
    return resolved


def print_available_brokers(input_dir: Path) -> None:
    folders = discover_broker_folders(input_dir)
    if not folders:
        print(f"未找到券商目录: {input_dir}")
        return

    print(f"券商目录根路径: {input_dir}")
    print("可用券商选择如下：")
    for folder_name in folders:
        aliases = ", ".join(broker_aliases(folder_name))
        print(f"- {folder_name}: {aliases}")


def sha1_text(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def split_people_and_phones(raw_text: str | None) -> tuple[str | None, str | None]:
    if not raw_text:
        return None, None
    phones = re.findall(r"(?:0\d{2,3}-\d{7,8}|\d{11})", raw_text)
    phone_text = "、".join(dict.fromkeys(phones)) if phones else None
    person_text = re.sub(r"(?:0\d{2,3}-\d{7,8}|\d{11})", "", raw_text)
    person_text = re.sub(r"[：:,\s、/]+$", "", person_text).strip() or None
    return person_text, phone_text


def normalize_candidate_suppliers(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        cleaned = [str(item).strip(" ;；") for item in value if str(item).strip(" ;；")]
        return "; ".join(cleaned)
    if isinstance(value, str):
        items = re.split(r"[;；]\s*", value)
        cleaned = [item.strip() for item in items if item.strip()]
        return "; ".join(cleaned)
    return str(value)


def flatten_payload(
    payload: Any,
    metadata: dict[str, str],
    raw_json_path: str,
    processed_at: str,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    confidence = ""

    if isinstance(payload, list):
        records = [item for item in payload if isinstance(item, dict)]
    elif isinstance(payload, dict):
        confidence = normalize_scalar(payload.get("confidence"))
        legacy_records = payload.get("records")
        if isinstance(legacy_records, list):
            document = payload.get("document") or {}
            for item in legacy_records:
                if not isinstance(item, dict):
                    continue
                records.append(
                    {
                        "broker_name": item.get("broker_name") or document.get("broker_name"),
                        "publish_date": item.get("publish_date") or document.get("publish_date"),
                        "announcement_stage": item.get("announcement_stage") or item.get("result_status"),
                        "procurement_category": item.get("procurement_category"),
                        "project_subcategory": item.get("project_subcategory"),
                        "project_name": item.get("project_name") or document.get("project_name"),
                        "procurement_method": item.get("procurement_method"),
                        "winning_supplier": item.get("winning_supplier"),
                        "winning_amount_yuan": item.get("winning_amount_yuan") or item.get("winning_amount"),
                        "source_file": item.get("source_file") or metadata["markdown_file"],
                    }
                )
        else:
            records = [payload]

    if not records:
        records = [{"source_file": metadata["markdown_file"]}]

    rows: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            record = {"project_name": str(record), "source_file": metadata["markdown_file"]}

        row = {
            "broker_folder": metadata["broker_folder"],
            "markdown_file": metadata["markdown_file"],
            "document_sha1": metadata["document_sha1"],
            "broker_name": record.get("broker_name") or "",
            "publish_date": record.get("publish_date") or "",
            "announcement_stage": record.get("announcement_stage") or "",
            "procurement_category": record.get("procurement_category") or "",
            "project_subcategory": record.get("project_subcategory") or "",
            "project_name": record.get("project_name") or "",
            "procurement_method": record.get("procurement_method") or "",
            "procurement_action": record.get("procurement_action") or "",
            "procurement_scope_summary": record.get("procurement_scope_summary") or "",
            "budget_amount_yuan": record.get("budget_amount_yuan"),
            "ceiling_price_yuan": record.get("ceiling_price_yuan"),
            "winning_amount_yuan": record.get("winning_amount_yuan"),
            "bid_deadline_at": record.get("bid_deadline_at") or "",
            "service_period_months": record.get("service_period_months"),
            "delivery_period_days": record.get("delivery_period_days"),
            "winning_supplier": record.get("winning_supplier") or "",
            "raw_json_path": raw_json_path,
            "processed_at": processed_at,
        }
        rows.append(normalize_row_fields(row))

    return rows


def portable_path(path: Path, base: Path = PROJECT_ROOT) -> str:
    """Return a repo-relative path when possible so generated artifacts are portable."""
    try:
        return path.resolve().relative_to(base.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def normalize_scalar(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value).strip()


NUMERIC_FIELDS = {
    "budget_amount_yuan",
    "ceiling_price_yuan",
    "winning_amount_yuan",
    "service_period_months",
    "delivery_period_days",
}


def normalize_numeric(value: Any) -> int | float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        cleaned = value.strip().replace(",", "")
        if not cleaned or cleaned.lower() in ("null", "none"):
            return None
        try:
            if "." in cleaned:
                return float(cleaned)
            return int(cleaned)
        except ValueError:
            return None
    return None


def normalize_row_fields(row: dict[str, Any]) -> dict[str, Any]:
    normalized = {}
    for field in TABLE_FIELDS:
        val = row.get(field)
        if field in NUMERIC_FIELDS:
            normalized[field] = normalize_numeric(val)
        else:
            normalized[field] = normalize_scalar(val)
    return normalized


def is_timeout_error(exc: Exception) -> bool:
    return exc.__class__.__name__ == "APITimeoutError" or "timed out" in str(exc).lower()


# #region debug-point A:report-helper
def report_debug_event(
    hypothesis_id: str,
    location: str,
    msg: str,
    data: dict[str, Any],
    trace_id: str | None = None,
    run_id: str = "pre",
) -> None:
    env_path = ROOT_DIR / ".dbg" / "llm-timeout-hang.env"
    server_url = "http://127.0.0.1:7777/event"
    session_id = "llm-timeout-hang"
    try:
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("DEBUG_SERVER_URL="):
                    server_url = line.split("=", 1)[1].strip() or server_url
                elif line.startswith("DEBUG_SESSION_ID="):
                    session_id = line.split("=", 1)[1].strip() or session_id
        payload = {
            "sessionId": session_id,
            "runId": run_id,
            "hypothesisId": hypothesis_id,
            "location": location,
            "msg": f"[DEBUG] {msg}",
            "data": data,
            "traceId": trace_id,
            "ts": int(time.time() * 1000),
        }
        urllib.request.urlopen(
            urllib.request.Request(
                server_url,
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            ),
            timeout=2,
        ).read()
    except Exception:
        pass
# #endregion


def request_progress_logger(
    path: Path,
    timeout_seconds: float,
    log_interval_seconds: float,
    stop_event: threading.Event,
    started_at: float,
) -> None:
    timeout_warning_printed = False
    interval = max(1.0, log_interval_seconds)

    while not stop_event.wait(interval):
        elapsed = time.monotonic() - started_at
        print(
            f"[RUNNING] {path} 已运行 {elapsed:.1f}s / 超时阈值 {timeout_seconds:.1f}s",
            flush=True,
        )
        if elapsed >= timeout_seconds and not timeout_warning_printed:
            print(
                f"[TIMEOUT-WAIT] {path} 已超过超时阈值，正在等待底层请求返回异常...",
                flush=True,
            )
            timeout_warning_printed = True


def first_non_empty(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        value_text = str(value).strip()
        if value_text:
            return value_text
    return ""


def process_markdown_file(
    path: Path,
    input_dir: Path,
    output_dir: Path,
    client: OpenAICompatibleClient,
    force_refresh: bool,
    request_semaphore: threading.Semaphore,
    min_interval_seconds: float,
    request_start_lock: threading.Lock | None,
    next_allowed_call_at: list[float],
    request_log_interval_seconds: float,
) -> FileExtractionResult:
    relative_path = path.relative_to(input_dir)
    raw_json_path = output_dir / "raw_json" / relative_path.with_suffix(".json")
    raw_json_path.parent.mkdir(parents=True, exist_ok=True)

    markdown = path.read_text(encoding="utf-8").strip()
    if not markdown:
        return FileExtractionResult(rows=[], raw_payload=None, error=f"Empty markdown: {path}")

    metadata = {
        "broker_folder": path.parent.name,
        "markdown_file": path.name,
        "relative_path": str(relative_path),
        "document_sha1": sha1_text(markdown),
    }
    raw_json_reference = portable_path(raw_json_path)
    processed_at = datetime.now(timezone.utc).isoformat()

    if raw_json_path.exists() and not force_refresh:
        cached_payload = json.loads(raw_json_path.read_text(encoding="utf-8"))
        rows = flatten_payload(cached_payload, metadata, raw_json_reference, processed_at)
        return FileExtractionResult(rows=rows, raw_payload=cached_payload)

    with request_semaphore:
        if request_start_lock is not None and min_interval_seconds > 0:
            with request_start_lock:
                now = time.monotonic()
                if now < next_allowed_call_at[0]:
                    time.sleep(next_allowed_call_at[0] - now)
                next_allowed_call_at[0] = time.monotonic() + min_interval_seconds

        started_at = time.monotonic()
        # #region debug-point C:file-request-start
        report_debug_event(
            hypothesis_id="C",
            location="llm_markdown_table_builder.py:process_markdown_file:start",
            msg="file request started",
            data={
                "path": str(path),
                "broker_folder": metadata["broker_folder"],
                "markdown_file": metadata["markdown_file"],
                "document_sha1": metadata["document_sha1"],
                "markdown_chars": len(markdown),
                "markdown_lines": markdown.count("\n") + 1,
                "timeout_seconds": client.config.timeout_seconds,
                "request_log_interval_seconds": request_log_interval_seconds,
                "force_refresh": force_refresh,
            },
            trace_id=metadata["document_sha1"],
        )
        # #endregion
        print(
            f"[REQUEST START] {path} (timeout={client.config.timeout_seconds}s)",
            flush=True,
        )
        stop_event = threading.Event()
        monitor_thread = threading.Thread(
            target=request_progress_logger,
            args=(
                path,
                float(client.config.timeout_seconds),
                request_log_interval_seconds,
                stop_event,
                started_at,
            ),
            daemon=True,
        )
        if request_log_interval_seconds > 0:
            monitor_thread.start()

        try:
            payload = client.extract(markdown=markdown, metadata=metadata)
        except Exception as exc:
            elapsed = time.monotonic() - started_at
            # #region debug-point D:file-request-error
            report_debug_event(
                hypothesis_id="D",
                location="llm_markdown_table_builder.py:process_markdown_file:error",
                msg="file request failed",
                data={
                    "path": str(path),
                    "document_sha1": metadata["document_sha1"],
                    "elapsed_seconds": round(elapsed, 3),
                    "error_type": exc.__class__.__name__,
                    "error_text": str(exc),
                    "is_timeout_error": is_timeout_error(exc),
                },
                trace_id=metadata["document_sha1"],
            )
            # #endregion
            if is_timeout_error(exc):
                print(
                    f"[REQUEST TIMEOUT] {path} 在 {elapsed:.1f}s 后超时: {exc}",
                    flush=True,
                )
            else:
                print(
                    f"[REQUEST ERROR] {path} 在 {elapsed:.1f}s 后失败: {exc}",
                    flush=True,
                )
            raise
        finally:
            stop_event.set()

        elapsed = time.monotonic() - started_at
        # #region debug-point E:file-request-done
        report_debug_event(
            hypothesis_id="E",
            location="llm_markdown_table_builder.py:process_markdown_file:done",
            msg="file request completed",
            data={
                "path": str(path),
                "document_sha1": metadata["document_sha1"],
                "elapsed_seconds": round(elapsed, 3),
                "payload_type": type(payload).__name__,
            },
            trace_id=metadata["document_sha1"],
        )
        # #endregion
        print(
            f"[REQUEST DONE] {path} 用时 {elapsed:.1f}s",
            flush=True,
        )
    raw_json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    rows = flatten_payload(payload, metadata, raw_json_reference, processed_at)
    return FileExtractionResult(rows=rows, raw_payload=payload)


def write_csv(rows: list[dict[str, Any]], csv_path: Path) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = atomic_temp_path(csv_path)
    try:
        with temp_path.open("w", encoding="utf-8-sig", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=TABLE_FIELDS)
            writer.writeheader()
            csv_rows = []
            for row in rows:
                csv_rows.append({k: ("" if v is None else v) for k, v in row.items()})
            writer.writerows(csv_rows)
        os.replace(temp_path, csv_path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def write_jsonl(rows: list[dict[str, Any]], jsonl_path: Path) -> None:
    jsonl_path.parent.mkdir(parents=True, exist_ok=True)
    content = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    atomic_write_text(jsonl_path, content, encoding="utf-8")


def write_failures_jsonl(failures: list[dict[str, Any]], jsonl_path: Path) -> None:
    jsonl_path.parent.mkdir(parents=True, exist_ok=True)
    content = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in failures)
    atomic_write_text(jsonl_path, content, encoding="utf-8")


def maybe_export_xlsx(rows: list[dict[str, Any]], xlsx_path: Path) -> str | None:
    try:
        import pandas as pd
    except ImportError:
        return None

    dataframe = pd.DataFrame(rows, columns=TABLE_FIELDS)
    xlsx_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = atomic_temp_path(xlsx_path)
    try:
        dataframe.to_excel(temp_path, index=False)
        os.replace(temp_path, xlsx_path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass
    return str(xlsx_path)


def sort_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: (
            normalize_scalar(row.get("broker_folder")),
            normalize_scalar(row.get("markdown_file")),
            normalize_scalar(row.get("project_name")),
            normalize_scalar(row.get("publish_date")),
            normalize_scalar(row.get("winning_supplier")),
        ),
    )


def group_rows_by_broker(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        broker_folder = normalize_scalar(row.get("broker_folder")) or "unknown_broker"
        grouped[broker_folder].append(row)
    return dict(grouped)


def count_files_by_broker(files: list[Path]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for path in files:
        counts[path.parent.name] += 1
    return dict(counts)


def count_failures_by_broker(failures: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for item in failures:
        file_path = item.get("file")
        if not file_path:
            continue
        counts[Path(str(file_path)).parent.name] += 1
    return dict(counts)


def write_output_bundle(
    rows: list[dict[str, Any]],
    output_dir: Path,
    summary_path: Path,
    summary_payload: dict[str, Any],
) -> dict[str, str | None]:
    csv_path = output_dir / "announcement_table.csv"
    jsonl_path = output_dir / "announcement_table.jsonl"
    xlsx_path = output_dir / "announcement_table.xlsx"

    sorted_rows = sort_rows(rows)
    write_csv(sorted_rows, csv_path)
    write_jsonl(sorted_rows, jsonl_path)
    xlsx_exported = maybe_export_xlsx(sorted_rows, xlsx_path)

    atomic_write_text(
        summary_path,
        json.dumps(summary_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {
        "csv_path": portable_path(csv_path),
        "jsonl_path": portable_path(jsonl_path),
        "xlsx_path": portable_path(Path(xlsx_exported)) if xlsx_exported else None,
        "summary_path": portable_path(summary_path),
    }


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="调用大模型 API，将 Markdown 招投标公告抽取为结构化 JSON 和汇总表。",
    )
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--llm-config", type=Path, default=DEFAULT_LLM_CONFIG_PATH)
    parser.add_argument(
        "--broker-folders",
        nargs="*",
        help="仅处理指定券商目录，支持目录名、简称或缩写，例如 citic_securities citic zx huaxi hx",
    )
    parser.add_argument(
        "--list-brokers",
        action="store_true",
        help="列出 input-dir 下可用的券商目录及其可识别缩写，然后退出",
    )
    parser.add_argument("--max-files", type=int, default=None)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument(
        "--max-concurrent-requests",
        type=int,
        default=None,
        help="同时进行中的 LLM API 请求上限，默认等于 workers（当前默认 4）",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=120,
        help="单个 LLM 请求超时秒数，默认 120，会覆盖 llm_api_config.json 中的 timeout_seconds",
    )
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument(
        "--min-interval-seconds",
        type=float,
        default=0.0,
        help="相邻请求的最小启动间隔秒数；默认 0，表示不做全局串行节流",
    )
    parser.add_argument(
        "--request-log-interval-seconds",
        type=float,
        default=60.0,
        help="单个请求执行中实时提示的输出间隔秒数，默认 60；设为 0 可关闭",
    )
    parser.add_argument(
        "--incremental",
        dest="incremental",
        action="store_true",
        help="默认开启：仅处理新增或内容发生变化的 Markdown，并合并更新现有总表",
    )
    parser.add_argument(
        "--full-refresh",
        dest="incremental",
        action="store_false",
        help="忽略现有总表索引，重新处理当前匹配到的全部 Markdown",
    )
    parser.set_defaults(incremental=True)
    return parser


def main() -> int:
    parser = build_argument_parser()
    args = parser.parse_args()

    input_dir = args.input_dir.resolve()
    output_dir = args.output_dir.resolve()
    llm_config_path = args.llm_config.resolve()

    if args.list_brokers:
        print_available_brokers(input_dir)
        return 0

    available_broker_folders = discover_broker_folders(input_dir)
    try:
        broker_folders = resolve_broker_folders(args.broker_folders, available_broker_folders)
    except ValueError as exc:
        parser.error(str(exc))

    if not llm_config_path.exists():
        parser.error(f"未找到 LLM 配置文件: {llm_config_path}")

    llm_config = LLMApiConfig.load(llm_config_path)
    llm_config.timeout_seconds = max(1, args.timeout_seconds)
    if not llm_config.api_key:
        emit_progress("failed", 100, "LLM API key is missing. Set LLM_API_KEY or api_key in llm_api_config.json.")
        print(
            "LLM API key is missing. Set LLM_API_KEY or api_key in llm_api_config.json.",
            file=sys.stderr,
        )
        return 1
    llm_config.validate()

    discovered_files = discover_markdown_files(input_dir, broker_folders)
    if args.max_files is not None:
        discovered_files = discovered_files[: args.max_files]

    if not discovered_files:
        print("未找到待处理的 Markdown 文件。", file=sys.stderr)
        return 1

    existing_rows = load_existing_output_rows(output_dir)
    selection = select_files_for_processing(
        discovered_files,
        output_dir=output_dir,
        incremental=args.incremental,
        overwrite=args.overwrite,
    )
    plans = selection.plans

    if not plans and args.incremental:
        summary = {
            "input_dir": portable_path(input_dir),
            "output_dir": portable_path(output_dir),
            "broker_output_root": portable_path(output_dir / "brokers"),
            "llm_config_path": portable_path(llm_config_path),
            "model": llm_config.model,
            "api_base_url": llm_config.base_url,
            "incremental": True,
            "discovered_files": len(discovered_files),
            "processed_files": 0,
            "skipped_unchanged_files": len(selection.skipped_files),
            "new_files": 0,
            "changed_files": 0,
            "success_files": 0,
            "failed_files": 0,
            "output_rows": len(existing_rows),
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "message": "未发现新增或变更的 Markdown，沿用现有结构化结果。",
        }
        print("未发现新增或变更的 Markdown，跳过 LLM 调用。")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    client = OpenAICompatibleClient(config=llm_config)

    all_rows: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    successful_file_keys: set[tuple[str, str]] = set()
    max_concurrent_requests = max(1, args.max_concurrent_requests or args.workers)
    request_semaphore = threading.Semaphore(max_concurrent_requests)
    request_start_lock = threading.Lock() if args.min_interval_seconds > 0 else None
    next_allowed_call_at = [0.0]

    print(f"扫描到 Markdown 文件数: {len(discovered_files)}")
    print(f"本次待处理文件数: {len(plans)}")
    if args.incremental:
        print(f"增量跳过未变更文件数: {len(selection.skipped_files)}")
        print(f"新增文件数: {len(selection.new_files)}")
        print(f"内容变更文件数: {len(selection.changed_files)}")
    print(f"输出目录: {output_dir}")
    print(f"模型: {llm_config.model}")
    print(f"LLM 配置: {llm_config_path}")
    print(f"单请求超时秒数: {llm_config.timeout_seconds}")
    print(f"工作线程数: {max(1, args.workers)}")
    print(f"最大并发请求数: {max_concurrent_requests}")
    print(f"请求最小启动间隔秒数: {max(0.0, args.min_interval_seconds)}")
    print(f"请求执行中日志间隔秒数: {max(0.0, args.request_log_interval_seconds)}")

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        future_map = {
            executor.submit(
                process_markdown_file,
                plan.path,
                input_dir,
                output_dir,
                client,
                plan.force_refresh,
                request_semaphore,
                max(0.0, args.min_interval_seconds),
                request_start_lock,
                next_allowed_call_at,
                max(0.0, args.request_log_interval_seconds),
            ): plan
            for plan in plans
        }

        for index, future in enumerate(as_completed(future_map), start=1):
            plan = future_map[future]
            path = plan.path
            try:
                result = future.result()
                if result.error:
                    failures.append({"file": portable_path(path), "error": result.error})
                    print(f"[{index}/{len(plans)}] FAILED {path}: {result.error}")
                    continue
                all_rows.extend(result.rows)
                successful_file_keys.add(path_file_key(path))
                print(
                    f"[{index}/{len(plans)}] OK {path} -> {len(result.rows)} rows "
                    f"({plan.reason})"
                )
            except (TimeoutError, ValueError, json.JSONDecodeError) as exc:
                failures.append({"file": portable_path(path), "error": repr(exc)})
                print(f"[{index}/{len(plans)}] FAILED {path}: {exc}")
            except Exception as exc:
                failures.append({"file": portable_path(path), "error": repr(exc)})
                print(f"[{index}/{len(plans)}] FAILED {path}: {exc}")

    failure_path = output_dir / "failed_files.jsonl"
    write_failures_jsonl(failures, failure_path)

    output_rows = (
        merge_rows_by_file(existing_rows, all_rows, successful_file_keys)
        if args.incremental
        else all_rows
    )

    broker_output_root = output_dir / "brokers"
    files_by_broker = count_files_by_broker([plan.path for plan in plans])
    failures_by_broker = count_failures_by_broker(failures)
    rows_by_broker = group_rows_by_broker(output_rows)
    broker_summaries: dict[str, dict[str, Any]] = {}

    for broker_folder in sorted(set(files_by_broker) | set(rows_by_broker) | set(failures_by_broker)):
        broker_rows = rows_by_broker.get(broker_folder, [])
        broker_output_dir = broker_output_root / broker_folder
        broker_summary = {
            "broker_folder": broker_folder,
            "output_dir": portable_path(broker_output_dir),
            "processed_files": files_by_broker.get(broker_folder, 0),
            "failed_files": failures_by_broker.get(broker_folder, 0),
            "success_files": files_by_broker.get(broker_folder, 0) - failures_by_broker.get(broker_folder, 0),
            "output_rows": len(broker_rows),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }
        broker_paths = write_output_bundle(
            broker_rows,
            broker_output_dir,
            broker_output_dir / "run_summary.json",
            broker_summary,
        )
        broker_summary.update(broker_paths)
        (broker_output_dir / "run_summary.json").write_text(
            json.dumps(broker_summary, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        broker_summaries[broker_folder] = broker_summary

    summary = {
        "input_dir": portable_path(input_dir),
        "output_dir": portable_path(output_dir),
        "broker_output_root": portable_path(broker_output_root),
        "llm_config_path": portable_path(llm_config_path),
        "model": llm_config.model,
        "api_base_url": llm_config.base_url,
        "incremental": args.incremental,
        "discovered_files": len(discovered_files),
        "processed_files": len(plans),
        "skipped_unchanged_files": len(selection.skipped_files),
        "new_files": len(selection.new_files),
        "changed_files": len(selection.changed_files),
        "success_files": len(plans) - len(failures),
        "failed_files": len(failures),
        "output_rows": len(output_rows),
        "failed_files_path": portable_path(failure_path),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "broker_summaries": broker_summaries,
    }
    master_paths = write_output_bundle(
        output_rows,
        output_dir,
        output_dir / "run_summary.json",
        summary,
    )
    summary.update(master_paths)
    (output_dir / "run_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("")
    print("处理完成")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())
