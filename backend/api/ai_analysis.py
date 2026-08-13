from __future__ import annotations

import csv
import json
import os
import threading
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status

from .config import PROJECT_ROOT, resolve_project_path
from backend.llm_table.llm_client import (
    LLMApiConfig,
    OpenAICompatibleClient,
)

DEFAULT_CSV_PATH = PROJECT_ROOT / "backend" / "data" / "announcement_table.csv"
DEFAULT_CACHE_PATH = PROJECT_ROOT / "backend" / "data" / "ai-analysis.json"
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "backend" / "config" / "llm_api_config.json"
DATE_FIELD = "publish_date"

analysis_lock = threading.Lock()


class AiAnalysisError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def cache_path() -> Path:
    return resolve_project_path(os.getenv("AI_ANALYSIS_CACHE_PATH"), DEFAULT_CACHE_PATH)


def csv_path() -> Path:
    return resolve_project_path(os.getenv("ANNOUNCEMENT_CSV_PATH"), DEFAULT_CSV_PATH)


def llm_config_path() -> Path:
    return resolve_project_path(os.getenv("LLM_CONFIG_PATH"), DEFAULT_CONFIG_PATH)


def window_days() -> int:
    try:
        value = int(os.getenv("AI_ANALYSIS_WINDOW_DAYS", "30"))
    except ValueError as exc:
        raise AiAnalysisError(500, "AI_ANALYSIS_WINDOW_DAYS 配置无效") from exc
    if not 1 <= value <= 3650:
        raise AiAnalysisError(500, "AI_ANALYSIS_WINDOW_DAYS 必须在 1 到 3650 之间")
    return value


def timeout_seconds() -> int:
    try:
        value = int(os.getenv("AI_ANALYSIS_TIMEOUT_SECONDS", "120"))
    except ValueError as exc:
        raise AiAnalysisError(500, "AI_ANALYSIS_TIMEOUT_SECONDS 配置无效") from exc
    if not 1 <= value <= 600:
        raise AiAnalysisError(500, "AI_ANALYSIS_TIMEOUT_SECONDS 必须在 1 到 600 之间")
    return value


def load_cached_analysis() -> dict[str, Any]:
    path = cache_path()
    if not path.exists():
        raise AiAnalysisError(404, "尚未生成 AI 情报分析")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise AiAnalysisError(500, "AI 情报分析缓存 JSON 损坏") from exc
    except OSError as exc:
        raise AiAnalysisError(500, "读取 AI 情报分析缓存失败") from exc

    if not isinstance(payload, dict):
        raise AiAnalysisError(500, "AI 情报分析缓存格式无效")
    normalized = normalize_analysis_payload(payload, cached=True)
    return normalized


def _run_generate_ai_analysis(days: int | None = None) -> dict[str, Any]:
    """Run the AI analysis without acquiring the analysis_lock.

    Callers are responsible for either holding the lock or operating inside
    the pipeline's global operation lock.  ``days`` defaults to
    ``window_days()`` when *None*.
    """
    effective_days = days if days is not None else window_days()
    recent_records, start_date, end_date = load_recent_records(effective_days)
    prompt_messages = build_prompt(recent_records, start_date, end_date, effective_days)
    analysis = request_model_analysis(prompt_messages)
    generated_at = datetime.now(timezone.utc).isoformat()
    payload = {
        "content": analysis["content"],
        "updatedAt": generated_at,
        "analysis": analysis,
        "meta": {
            "generated_at": generated_at,
            "source_count": len(recent_records),
            "window_days": effective_days,
            "cached": False,
        },
    }
    atomic_write_json(cache_path(), payload)
    # Imported mode is an evolving lineage: AI refreshes replace only the AI
    # artifact while preserving imported tender and App datasets.
    from .dashboard_package import dashboard_package_builder
    from .dashboard_package_import import promote_active_imported_package

    live_package = dashboard_package_builder.build(force=True)
    promote_active_imported_package(live_package, {"ai_analysis"})
    return payload


def generate_ai_analysis() -> dict[str, Any]:
    """HTTP-facing entry point: acquires analysis_lock then delegates."""
    if not analysis_lock.acquire(blocking=False):
        raise AiAnalysisError(409, "AI 情报分析任务正在运行")
    try:
        return _run_generate_ai_analysis()
    finally:
        analysis_lock.release()


def load_recent_records(days: int) -> tuple[list[dict[str, str]], datetime, datetime]:
    path = csv_path()
    if not path.exists():
        raise AiAnalysisError(404, "announcement_table.csv 不存在，请先生成公告数据")

    try:
        with path.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            records = list(reader)
    except csv.Error as exc:
        raise AiAnalysisError(500, f"公告 CSV 解析失败: {exc}") from exc
    except OSError as exc:
        raise AiAnalysisError(500, "读取公告 CSV 失败") from exc

    if not records:
        raise AiAnalysisError(422, "公告 CSV 为空，没有可分析数据")
    if DATE_FIELD not in (reader.fieldnames or []):
        raise AiAnalysisError(422, f"公告 CSV 缺少日期字段: {DATE_FIELD}")

    dated_records: list[tuple[dict[str, str], datetime]] = []
    invalid_date_count = 0
    for record in records:
        parsed = parse_publish_date(record.get(DATE_FIELD, ""))
        if parsed is None:
            if record.get(DATE_FIELD, "").strip():
                invalid_date_count += 1
            continue
        dated_records.append((record, parsed))

    if not dated_records:
        detail = f"日期字段 {DATE_FIELD} 无法识别"
        if invalid_date_count == 0:
            detail = f"日期字段 {DATE_FIELD} 没有有效日期"
        raise AiAnalysisError(422, detail)

    end_date = max(parsed for _, parsed in dated_records)
    start_date = end_date - timedelta(days=days)
    recent = [
        record
        for record, parsed in dated_records
        if start_date <= parsed <= end_date
    ]
    if not recent:
        raise AiAnalysisError(422, f"最近 {days} 天没有公告可分析")
    return recent, start_date, end_date


def parse_publish_date(raw: str) -> datetime | None:
    value = raw.strip()
    if not value:
        return None
    candidates = [value, value.replace("Z", "+00:00")]
    if " " in value:
        candidates.append(value.split(" ", 1)[0])
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
            return parsed
        except ValueError:
            continue
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(value[:10], fmt)
        except ValueError:
            continue
    return None


def build_prompt(
    records: list[dict[str, str]],
    start_date: datetime,
    end_date: datetime,
    days: int,
) -> list[dict[str, str]]:
    broker_counts = Counter(normalized_value(r.get("broker_name"), "主体待识别") for r in records)
    category_counts = Counter(normalized_value(r.get("project_subcategory") or r.get("procurement_category"), "未分类") for r in records)
    stage_counts = Counter(normalized_value(r.get("announcement_stage"), "阶段待识别") for r in records)
    supplier_counts = Counter(
        normalized_value(r.get("winning_supplier"), "")
        for r in records
        if normalized_value(r.get("winning_supplier"), "")
    )

    price_samples: list[str] = []
    total_amount = 0.0
    price_count = 0
    for record in records:
        amount = parse_amount(record.get("winning_amount_yuan", ""))
        if amount is None:
            continue
        price_count += 1
        total_amount += amount
        if len(price_samples) < 10:
            price_samples.append(
                " | ".join(
                    [
                        normalized_value(record.get("broker_name"), "主体待识别"),
                        normalized_value(record.get("project_name"), "项目待识别"),
                        normalized_value(record.get("winning_supplier"), "未披露"),
                        f"{amount / 10000:.1f}万元",
                    ]
                )
            )

    total_category = sum(category_counts.values()) or 1
    data_summary = "\n".join(
        [
            f"统计区间：{start_date.date().isoformat()} 至 {end_date.date().isoformat()}",
            f"公告记录总数：{len(records)} 条，涉及主体：{len(broker_counts)} 家",
            f"窗口天数：{days} 天",
            f"阶段分布：{format_counter(stage_counts, 8)}",
            f"金融科技方向分布：{format_counter(category_counts, 8, total_category)}",
            f"活跃券商 Top 8：{format_counter(broker_counts, 8)}",
            f"高频供应商 Top 8：{format_counter(supplier_counts, 8) or '无公开供应商样本'}",
            f"公开价格样本：{price_count} 个，总金额约 {total_amount / 10000:.0f} 万元",
            "价格样本明细：\n" + ("\n".join(f"- {item}" for item in price_samples) or "- 无"),
        ]
    )

    system_prompt = """你是一位严谨的金融科技行业数据分析师，专门为证券公司管理层撰写招采情报分析。
严格规则：
1. 所有结论必须有上方数据直接支撑，禁止推测、臆断或编造任何不在数据中的信息。
2. 禁止使用“行业领先”“市场第一”“规模最大”等无法从数据验证的表述。
3. 禁止对券商科技投入水平、竞争力或战略意图做主观评价。
4. 所有排名和比较仅限当前数据集，不得外推到行业整体。
5. 如果某项数据不足以得出结论，明确标注“数据样本有限”。
6. “活跃度”仅指公开招采活跃度，不得表述为真实科技投入规模。
7. 供应商出现频次不代表市场份额或中标率。

请输出 JSON 对象，格式为 {"content":"Markdown 分析报告"}。content 内使用 Markdown，章节标题用 ##，关键数据用 **加粗**，总字数 500-800 字。"""

    user_prompt = f"请基于以下近{days}天券商金融科技公开招采数据，撰写情报分析报告：\n\n{data_summary}"
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def request_model_analysis(messages: list[dict[str, str]]) -> dict[str, str]:
    path = llm_config_path()
    try:
        config = LLMApiConfig.load(path)
        override_timeout = timeout_seconds()
        config.timeout_seconds = override_timeout
        config.validate()
    except ValueError as exc:
        message = str(exc)
        if "api_key" in message:
            message = "LLM API Key 缺失或为空"
        raise AiAnalysisError(500, message) from exc
    except (json.JSONDecodeError, OSError) as exc:
        raise AiAnalysisError(500, "读取 LLM 配置失败") from exc

    request_kwargs: dict[str, Any] = {
        "model": config.model,
        "messages": messages,
        "temperature": config.temperature,
        "top_p": config.top_p,
        "max_tokens": config.max_tokens,
        "frequency_penalty": config.frequency_penalty,
        "presence_penalty": config.presence_penalty,
    }
    if config.use_json_object:
        request_kwargs["response_format"] = {"type": "json_object"}

    try:
        client = OpenAICompatibleClient(config)
        result = client._request_json(request_kwargs)
    except TimeoutError as exc:
        raise AiAnalysisError(504, "LLM 请求超时") from exc
    except Exception as exc:
        name = exc.__class__.__name__.lower()
        if "timeout" in name:
            raise AiAnalysisError(504, "LLM 请求超时") from exc
        if isinstance(exc, ValueError) and "Unable to parse JSON" in str(exc):
            raise AiAnalysisError(502, "模型结果无法解析为 JSON") from exc
        if isinstance(exc, ImportError):
            raise AiAnalysisError(500, "缺少 openai 依赖") from exc
        raise AiAnalysisError(502, "LLM 服务返回错误") from exc

    if isinstance(result, str):
        content = result.strip()
    elif isinstance(result, dict):
        content = str(result.get("content", "")).strip()
    else:
        raise AiAnalysisError(502, "模型结果格式无效")
    if not content:
        raise AiAnalysisError(502, "模型结果缺少 content")
    return {"content": content}


def normalize_analysis_payload(payload: dict[str, Any], cached: bool) -> dict[str, Any]:
    content = ""
    if isinstance(payload.get("analysis"), dict):
        content = str(payload["analysis"].get("content", "")).strip()
    if not content:
        content = str(payload.get("content", "")).strip()
    updated_at = str(payload.get("updatedAt") or payload.get("updated_at") or "").strip()
    generated_at = updated_at or datetime.now(timezone.utc).isoformat()
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    return {
        "content": content or None,
        "updatedAt": updated_at or None,
        "analysis": {"content": content},
        "meta": {
            "generated_at": str(meta.get("generated_at") or generated_at),
            "source_count": int(meta.get("source_count") or 0),
            "window_days": int(meta.get("window_days") or window_days()),
            "cached": cached,
        },
    }


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.stem}.{os.getpid()}.{threading.get_ident()}.tmp{path.suffix}")
    try:
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp_path, path)
    except OSError as exc:
        raise AiAnalysisError(500, "AI 情报分析缓存写入失败，上一版缓存未被覆盖") from exc
    finally:
        try:
            if temp_path.exists():
                temp_path.unlink()
        except OSError:
            pass


def normalized_value(value: str | None, fallback: str) -> str:
    text = (value or "").strip()
    return text or fallback


def parse_amount(raw: str | None) -> float | None:
    value = (raw or "").strip()
    if not value:
        return None
    try:
        amount = float(value)
    except ValueError:
        return None
    return amount if amount > 0 else None


def format_counter(counter: Counter[str], limit: int, total: int | None = None) -> str:
    parts: list[str] = []
    for name, count in counter.most_common(limit):
        if total:
            parts.append(f"{name}：{count} 条（{count / total * 100:.1f}%）")
        else:
            parts.append(f"{name}：{count} 条")
    return "；".join(parts)


def to_http_exception(exc: AiAnalysisError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)
