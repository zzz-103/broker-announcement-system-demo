#!/usr/bin/env python3
"""Small command-line entry point for the CFCPN notice scraper."""

from __future__ import annotations

import argparse
import json
import logging
import math
import random
import re
import sys
import tempfile
import time
from datetime import datetime
from datetime import date
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

from cfcpn_scraper import (
    create_session,
    fetch_notice_detail,
    fetch_notice_list,
    parse_notice_detail,
    write_index_markdown,
    write_notice_markdown,
)
from cfcpn_scraper.client import build_detail_url
from cfcpn_scraper.models import CfcpnError


LOGGER = logging.getLogger("cfcpn_scraper")
FRONT_MATTER_RE = re.compile(r"\A---\n(?P<body>.*?)\n---\n", re.DOTALL)
FRONT_MATTER_LINE_RE = re.compile(r"^(?P<key>[A-Za-z_][A-Za-z0-9_]*):\s*(?P<value>.*)$")
SLEEP_FUNC = time.sleep
RANDOM_UNIFORM = random.uniform
STOP_FORBIDDEN = "连续 403，触发访问保护熔断"
STOP_BEFORE_SINCE_DATE = "遇到早于日期下限的公告，停止扫描"
NOTICE_TYPE_CONFIGS = {
    "procurement": {"column": "cggg", "list_notice_type": "1", "label": "采购公告"},
    "result": {"column": "jggg", "list_notice_type": "4", "label": "结果公告"},
}


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args(argv)
    validate_keyword(args.keyword)
    notice_config = NOTICE_TYPE_CONFIGS[args.notice_type]
    args.column = notice_config["column"]
    args.list_notice_type = notice_config["list_notice_type"]
    logging.info("本次检索关键词：%r", args.keyword)
    logging.info(
        "公告类型：%s (%s, column=%s)",
        notice_config["label"],
        args.notice_type,
        args.column,
    )
    logging.info("日期范围：%s 至今", args.since_date.isoformat())
    if args.update and args.overwrite:
        raise SystemExit("--update cannot be used together with --overwrite")
    if args.update and args.start_page != 1:
        raise SystemExit("--update must start from page 1; do not pass --start-page > 1")
    if args.end_page is not None and args.end_page < args.start_page:
        raise SystemExit("--end-page must be greater than or equal to --start-page")

    output_dir = Path(args.output_dir)
    runtime_paths = resolve_runtime_paths(output_dir, args.notice_type, args.checkpoint_file)
    notices_dir = runtime_paths["notices_dir"]
    index_path = runtime_paths["index_path"]
    failures_path = runtime_paths["failures_path"]
    checkpoint_path = runtime_paths["checkpoint_path"]
    notices_dir.mkdir(parents=True, exist_ok=True)
    existing_paths, index_records = scan_existing_notices(notices_dir, args.notice_type)
    if args.resume:
        checkpoint = load_checkpoint(checkpoint_path)
        if checkpoint and checkpoint.get("completed", False):
            LOGGER.info("上一次任务已成功完成，不进行断点恢复，从第一页重新开始")
        else:
            last_page_from_json = 1
            if checkpoint:
                if checkpoint.get("keyword") and checkpoint.get("keyword") != args.keyword:
                    LOGGER.warning(
                        "checkpoint keyword %r differs from current keyword %r",
                        checkpoint.get("keyword"),
                        args.keyword,
                    )
                if checkpoint.get("notice_type") and checkpoint.get("notice_type") != args.notice_type:
                    LOGGER.warning(
                        "checkpoint notice_type %r differs from current notice_type %r",
                        checkpoint.get("notice_type"),
                        args.notice_type,
                    )
                last_page_from_json = int(checkpoint.get("last_completed_page") or 1)

            last_page_from_md = 1
            matching_count = sum(
                1
                for record in index_records.values()
                if record.get("keyword") == args.keyword
                and (parse_publish_date(record.get("publish_time")) or date.min) >= args.since_date
            )
            if args.page_size > 0:
                last_page_from_md = math.ceil(matching_count / args.page_size)

            if args.update:
                last_page = last_page_from_json
            else:
                last_page = max(last_page_from_json, last_page_from_md)

            if last_page > 1:
                args.start_page = max(1, last_page - 1)
                if args.update:
                    LOGGER.info(
                        "从 checkpoint 恢复 (json 页码: %s)，回退到第 %s 页重新检查",
                        last_page_from_json if checkpoint else "无",
                        args.start_page,
                    )
                else:
                    LOGGER.info(
                        "从 checkpoint 和已爬取文件恢复 (json 页码: %s, md 文件数: %s, 推算页码: %s)，回退到第 %s 页重新检查",
                        last_page_from_json if checkpoint else "无",
                        matching_count,
                        last_page_from_md,
                        args.start_page,
                    )

    processed_ids: set[str] = set()
    session = create_session()
    stats = {
        "keyword": args.keyword,
        "notice_type": args.notice_type,
        "column": args.column,
        "list_pages": 0,
        "found": 0,
        "new_ids": 0,
        "saved": 0,
        "skipped": 0,
        "skipped_by_date": 0,
        "failed": 0,
        "forbidden": 0,
    }
    stop_reason = ""
    circuit_breaker = False
    consecutive_known_pages = 0
    throttle = Throttle(args)
    forbidden_state = {"consecutive": 0}

    all_todo_items: list[dict[str, Any]] = []
    total = 0
    end_page = args.end_page
    page_no = args.start_page
    try:
        emit_progress("scanning", 0, "正在扫描列表获取待更新公告...")
        while True:
            if circuit_breaker:
                stop_reason = STOP_FORBIDDEN
                break
            if reached_max_items(stats["found"], args.max_items):
                stop_reason = "达到 max-items"
                break
            if end_page is not None and page_no > end_page:
                stop_reason = "达到 end-page"
                break

            try:
                throttle.wait_page()
                page_data = request_with_403_handling(
                    lambda: fetch_notice_list(
                        page_no,
                        args.page_size,
                        args.keyword,
                        notice_type=args.list_notice_type,
                        column=args.column,
                        session=session,
                    ),
                    args=args,
                    stats=stats,
                    forbidden_state=forbidden_state,
                    stage="list",
                    title=f"第 {page_no} 页列表",
                )
                if page_data is None:
                    circuit_breaker = True
                    stop_reason = STOP_FORBIDDEN
                    append_failure(
                        failures_path,
                        {
                            "notice_id": "",
                            "title": f"第 {page_no} 页列表",
                            "url": "",
                            "stage": "list",
                            "error": STOP_FORBIDDEN,
                        },
                    )
                    stats["failed"] += 1
                    break
                stats["list_pages"] += 1
            except Exception as exc:
                LOGGER.error("列表第 %s 页请求失败：%s", page_no, exc)
                append_failure(
                    failures_path,
                    {
                        "notice_id": "",
                        "title": "",
                        "url": "",
                        "stage": "list",
                        "error": str(exc),
                    },
                )
                stats["failed"] += 1
                if stats["list_pages"] == 0 and end_page is None:
                    stop_reason = "列表请求失败"
                    break
                page_no += 1
                continue

            if not total:
                total = page_data["total"]
                auto_end_page = math.ceil(total / args.page_size) if total else page_no
                if end_page is None:
                    end_page = auto_end_page

            stats["total"] = total

            todo_items, page_stats = scan_page(
                page_no=page_no,
                page_data=page_data,
                args=args,
                notices_dir=notices_dir,
                failures_path=failures_path,
                existing_paths=existing_paths,
                processed_ids=processed_ids,
                stats=stats,
                throttle=throttle,
            )
            all_todo_items.extend(todo_items)

            if page_stats["circuit_breaker"]:
                circuit_breaker = True
                stop_reason = STOP_FORBIDDEN
            if page_stats["before_since_date"]:
                stop_reason = STOP_BEFORE_SINCE_DATE
            write_checkpoint(
                checkpoint_path,
                {
                    "keyword": args.keyword,
                    "notice_type": args.notice_type,
                    "column": args.column,
                    "since_date": args.since_date.isoformat(),
                    "last_completed_page": page_no,
                    "checked_items": stats["found"],
                    "saved_items": stats["saved"],
                    "updated_at": now_iso(),
                    "stop_reason": stop_reason or "scanning",
                    "completed": False,
                },
            )
            if circuit_breaker:
                LOGGER.warning(STOP_FORBIDDEN)
                break
            if page_stats["before_since_date"]:
                LOGGER.info(STOP_BEFORE_SINCE_DATE)
                break
            if args.update:
                if page_stats["new_ids"] == 0:
                    consecutive_known_pages += 1
                else:
                    consecutive_known_pages = 0
                if page_stats["new_ids"] == 0:
                    LOGGER.info(
                        "第 %s 页：%s 条，新公告 %s 条，已存在 %s 条，失败 %s 条，连续旧页 %s/%s",
                        page_no,
                        page_stats["items"],
                        page_stats["new_ids"],
                        page_stats["known_ids"],
                        page_stats["failed"],
                        consecutive_known_pages,
                        args.known_pages_stop,
                    )
                else:
                    LOGGER.info(
                        "第 %s 页：%s 条，新公告 %s 条，已存在 %s 条，失败 %s 条",
                        page_no,
                        page_stats["items"],
                        page_stats["new_ids"],
                        page_stats["known_ids"],
                        page_stats["failed"],
                    )
                if consecutive_known_pages >= args.known_pages_stop:
                    stop_reason = "连续旧分页"
                    LOGGER.info(
                        "已连续 %s 页未发现新公告，停止增量扫描",
                        args.known_pages_stop,
                    )
                    break

            if reached_max_items(stats["found"], args.max_items):
                stop_reason = "达到 max-items"
                break
            if page_no >= (end_page or page_no):
                stop_reason = "达到 end-page" if args.end_page is not None else "已到最后一页"
                break
            page_no += 1

        # 第二阶段：详情下载与保存
        N = len(all_todo_items)
        if N > 0 and not circuit_breaker:
            LOGGER.info("扫描结束，本次需要新增爬取 %s 个公告。开始下载详情...", N)
            for i, item in enumerate(all_todo_items):
                if circuit_breaker:
                    break
                title = item.get("noticeTitle") or ""
                progress_percent = int((i + 1) * 100 / N)
                emit_progress(
                    "crawling",
                    progress_percent,
                    f"正在爬取新公告 ({i+1}/{N}): {title}",
                    current=i+1,
                    total=N,
                )
                item_circuit_breaker = download_and_save_item(
                    list_item=item,
                    args=args,
                    session=session,
                    notices_dir=notices_dir,
                    failures_path=failures_path,
                    existing_paths=existing_paths,
                    index_records=index_records,
                    stats=stats,
                    throttle=throttle,
                    forbidden_state=forbidden_state,
                )
                if item_circuit_breaker:
                    circuit_breaker = True
                    stop_reason = STOP_FORBIDDEN

                write_checkpoint(
                    checkpoint_path,
                    {
                        "keyword": args.keyword,
                        "notice_type": args.notice_type,
                        "column": args.column,
                        "since_date": args.since_date.isoformat(),
                        "last_completed_page": item.get("_page_no", page_no),
                        "checked_items": stats["found"],
                        "saved_items": stats["saved"],
                        "updated_at": now_iso(),
                        "stop_reason": stop_reason or "crawling",
                        "completed": False,
                    },
                )

                processed = i + 1
                if processed < N and not circuit_breaker:
                    throttle.maybe_batch_rest(processed)
        else:
            if not circuit_breaker:
                LOGGER.info("扫描结束，没有发现需要新增爬取的公告。")
                emit_progress("completed", 100, "已检查所有列表，没有新增的公告需要爬取。", current=0, total=0)
    except KeyboardInterrupt:
        stop_reason = "用户中断"
        LOGGER.warning("用户中断，正在重建索引")

    if stats["saved"] > 0 or not index_path.exists():
        rebuild_index(index_records, index_path)
    else:
        LOGGER.info("没有新增公告，保留现有索引文件：%s", index_path)
    if not stop_reason:
        stop_reason = "已到最后一页"
    write_checkpoint(
        checkpoint_path,
        {
            "keyword": args.keyword,
            "notice_type": args.notice_type,
            "column": args.column,
            "since_date": args.since_date.isoformat(),
            "last_completed_page": max(args.start_page, page_no if stats["list_pages"] else args.start_page),
            "checked_items": stats["found"],
            "saved_items": stats["saved"],
            "updated_at": now_iso(),
            "stop_reason": stop_reason,
            "completed": stop_reason in {"达到 end-page", "已到最后一页", STOP_BEFORE_SINCE_DATE, "连续旧分页"},
        },
    )
    print_stats(stats, output_dir, index_path, checkpoint_path, args.update, stop_reason, circuit_breaker)
    return 0 if stats["failed"] == 0 else 2


def get_default_since_date() -> date:
    today = date.today()
    y = today.year
    m = today.month - 3
    if m <= 0:
        m += 12
        y -= 1
    d = today.day
    while d > 28:
        try:
            return date(y, m, d)
        except ValueError:
            d -= 1
    return date(y, m, d)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    raw_args = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(description="抓取金采网公告并保存为 Markdown。")
    parser.add_argument("--keyword", default="证券", help="列表搜索关键词，默认：证券")
    parser.add_argument(
        "--notice-type",
        choices=sorted(NOTICE_TYPE_CONFIGS),
        default="procurement",
        help="公告类型，procurement=采购公告，result=结果公告，默认：procurement",
    )
    parser.add_argument("--since-date", type=parse_iso_date, default=get_default_since_date(), help="只处理此日期及之后的公告，默认：近三个月 (即 90 天前)")
    parser.add_argument("--start-page", type=positive_int, default=1, help="起始页，默认：1")
    parser.add_argument("--end-page", type=positive_int, help="结束页，不传则按 total 自动计算")
    parser.add_argument("--page-size", type=positive_int, default=10, help="每页数量，默认：10")
    parser.add_argument("--max-items", type=positive_int, help="本轮最多检查的列表公告数量")
    parser.add_argument("--output-dir", default="output", help="输出目录，默认：output")
    parser.add_argument("--delay", type=non_negative_float, default=1.0, help="兼容旧命令的固定请求间隔秒数")
    parser.add_argument("--delay-min", type=non_negative_float, help="详情请求随机间隔最小秒数，默认：20")
    parser.add_argument("--delay-max", type=non_negative_float, help="详情请求随机间隔最大秒数，默认：40")
    parser.add_argument("--page-delay-min", type=non_negative_float, help="列表翻页随机间隔最小秒数，默认：3")
    parser.add_argument("--page-delay-max", type=non_negative_float, help="列表翻页随机间隔最大秒数，默认：6")
    parser.add_argument("--batch-size", type=positive_int, default=20, help="每检查多少条公告后批次休息，默认：20")
    parser.add_argument("--batch-rest-min", type=non_negative_float, default=60.0, help="批次休息最小秒数，默认：60")
    parser.add_argument("--batch-rest-max", type=non_negative_float, default=120.0, help="批次休息最大秒数，默认：120")
    parser.add_argument("--forbidden-cooldown-min", type=non_negative_float, default=90.0, help="403 冷却最小秒数，默认：90")
    parser.add_argument("--forbidden-cooldown-max", type=non_negative_float, default=180.0, help="403 冷却最大秒数，默认：180")
    parser.add_argument("--max-consecutive-403", type=positive_int, default=2, help="连续 403 熔断阈值，默认：2")
    parser.add_argument("--checkpoint-file", help="checkpoint 文件路径，默认：<output-dir>/checkpoint.json")
    parser.add_argument("--resume", action="store_true", help="从 checkpoint 记录位置回退一页继续")
    parser.add_argument("--overwrite", action="store_true", help="覆盖已存在公告")
    parser.add_argument("--update", action="store_true", default=True, help="增量更新模式，从第一页扫描并在连续旧页后停止，默认：开启")
    parser.add_argument("--no-update", action="store_false", dest="update", help="禁用增量更新模式")
    parser.add_argument(
        "--known-pages-stop",
        type=positive_int,
        default=2,
        help="增量模式下连续多少页没有新 ID 后停止，默认：2",
    )
    args = parser.parse_args(argv)
    
    update_explicit = "--update" in raw_args
    overwrite_explicit = "--overwrite" in raw_args or args.overwrite
    start_page_explicit = "--start-page" in raw_args

    if (overwrite_explicit or (start_page_explicit and args.start_page > 1)) and not update_explicit:
        args.update = False

    finalize_delay_args(args, raw_args)
    validate_range("delay", args.delay_min, args.delay_max)
    validate_range("page-delay", args.page_delay_min, args.page_delay_max)
    validate_range("batch-rest", args.batch_rest_min, args.batch_rest_max)
    validate_range("forbidden-cooldown", args.forbidden_cooldown_min, args.forbidden_cooldown_max)
    return args


def resolve_runtime_paths(
    output_dir: Path,
    notice_type: str,
    checkpoint_file: str | None,
) -> dict[str, Path]:
    if notice_type == "result":
        type_output_dir = output_dir / "result"
        checkpoint_path = (
            Path(checkpoint_file)
            if checkpoint_file
            else output_dir / "checkpoints" / "result.json"
        )
        return {
            "notices_dir": type_output_dir / "notices",
            "index_path": type_output_dir / "index.md",
            "failures_path": type_output_dir / "failures.jsonl",
            "checkpoint_path": checkpoint_path,
        }

    checkpoint_path = Path(checkpoint_file) if checkpoint_file else output_dir / "checkpoint.json"
    return {
        "notices_dir": output_dir / "notices",
        "index_path": output_dir / "index.md",
        "failures_path": output_dir / "failures.jsonl",
        "checkpoint_path": checkpoint_path,
    }


def positive_int(value: str) -> int:
    try:
        number = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an integer") from exc
    if number < 1:
        raise argparse.ArgumentTypeError("must be >= 1")
    return number


def non_negative_float(value: str) -> float:
    try:
        number = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be a number") from exc
    if number < 0:
        raise argparse.ArgumentTypeError("must be >= 0")
    return number


def parse_iso_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be YYYY-MM-DD") from exc


def finalize_delay_args(args: argparse.Namespace, raw_args: list[str]) -> None:
    detail_random_supplied = any(
        item in raw_args for item in ("--delay-min", "--delay-max")
    )
    page_random_supplied = any(
        item in raw_args for item in ("--page-delay-min", "--page-delay-max")
    )
    old_delay_supplied = "--delay" in raw_args

    if detail_random_supplied:
        args.delay_min = 20.0 if args.delay_min is None else args.delay_min
        args.delay_max = 40.0 if args.delay_max is None else args.delay_max
    elif old_delay_supplied:
        args.delay_min = args.delay
        args.delay_max = args.delay
    else:
        args.delay_min = 20.0
        args.delay_max = 40.0

    if page_random_supplied:
        args.page_delay_min = 3.0 if args.page_delay_min is None else args.page_delay_min
        args.page_delay_max = 6.0 if args.page_delay_max is None else args.page_delay_max
    elif old_delay_supplied:
        args.page_delay_min = args.delay
        args.page_delay_max = args.delay
    else:
        args.page_delay_min = 3.0
        args.page_delay_max = 6.0


def validate_range(name: str, minimum: float, maximum: float) -> None:
    if minimum < 0 or maximum < 0:
        raise SystemExit(f"--{name}-min/--{name}-max must be >= 0")
    if maximum < minimum:
        raise SystemExit(f"--{name}-max must be greater than or equal to --{name}-min")


def validate_keyword(keyword: str) -> None:
    try:
        keyword.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise SystemExit("--keyword must be UTF-8 encodable") from exc
    if "\ufffd" in keyword:
        raise SystemExit("--keyword contains Unicode replacement character; refusing to crawl")


def reached_max_items(found_count: int, max_items: int | None) -> bool:
    return max_items is not None and found_count >= max_items


class Throttle:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.detail_started = False
        self.page_started = False
        self.next_batch_at = args.batch_size

    def wait_detail(self) -> float:
        if not self.detail_started:
            self.detail_started = True
            return 0.0
        seconds = RANDOM_UNIFORM(self.args.delay_min, self.args.delay_max)
        LOGGER.info("详情请求等待 %.1f 秒", seconds)
        SLEEP_FUNC(seconds)
        return seconds

    def wait_page(self) -> float:
        if not self.page_started:
            self.page_started = True
            return 0.0
        seconds = RANDOM_UNIFORM(self.args.page_delay_min, self.args.page_delay_max)
        LOGGER.info("列表翻页等待 %.1f 秒", seconds)
        SLEEP_FUNC(seconds)
        return seconds

    def maybe_batch_rest(self, checked_items: int) -> None:
        if self.args.batch_size < 1:
            return
        if checked_items < self.next_batch_at:
            return
        seconds = RANDOM_UNIFORM(self.args.batch_rest_min, self.args.batch_rest_max)
        LOGGER.info("已检查 %s 条公告，进入批次休息 %.1f 秒", checked_items, seconds)
        SLEEP_FUNC(seconds)
        while self.next_batch_at <= checked_items:
            self.next_batch_at += self.args.batch_size


def request_with_403_handling(
    operation: Any,
    args: argparse.Namespace,
    stats: dict[str, int],
    forbidden_state: dict[str, int],
    stage: str,
    title: str,
) -> Any | None:
    for attempt in (1, 2):
        try:
            result = operation()
            forbidden_state["consecutive"] = 0
            return result
        except CfcpnError as exc:
            if exc.status_code != 403:
                raise
            stats["forbidden"] += 1
            forbidden_state["consecutive"] += 1
            LOGGER.warning(
                "%s 请求 403：%s，连续 403 次数 %s/%s",
                stage,
                title,
                forbidden_state["consecutive"],
                args.max_consecutive_403,
            )
            if forbidden_state["consecutive"] >= args.max_consecutive_403:
                return None
            if attempt == 2:
                raise
            seconds = retry_after_seconds(exc.headers)
            if seconds is None:
                seconds = RANDOM_UNIFORM(
                    args.forbidden_cooldown_min, args.forbidden_cooldown_max
                )
            LOGGER.warning("403 冷却 %.1f 秒后重试一次", seconds)
            SLEEP_FUNC(seconds)
    return None


def retry_after_seconds(headers: dict[str, str]) -> float | None:
    value = ""
    for key, header_value in headers.items():
        if key.lower() == "retry-after":
            value = header_value.strip()
            break
    if not value:
        return None
    if value.isdigit():
        return max(0.0, float(value))
    try:
        retry_at = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if retry_at.tzinfo is None:
        retry_at = retry_at.astimezone()
    return max(0.0, (retry_at - datetime.now(retry_at.tzinfo)).total_seconds())


def scan_page(
    page_no: int,
    page_data: dict[str, Any],
    args: argparse.Namespace,
    notices_dir: Path,
    failures_path: Path,
    existing_paths: dict[str, Path],
    processed_ids: set[str],
    stats: dict[str, int],
    throttle: Throttle,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    page_stats = {
        "items": 0,
        "new_ids": 0,
        "known_ids": 0,
        "failed": 0,
        "circuit_breaker": 0,
        "before_since_date": 0,
    }
    todo_items: list[dict[str, Any]] = []

    for item_index, list_item in enumerate(page_data["rows"], start=1):
        if reached_max_items(stats["found"], args.max_items):
            break
        page_stats["items"] += 1
        stats["found"] += 1

        notice_id = str(list_item.get("id") or "")
        title = str(list_item.get("noticeTitle") or "")
        publish_date = parse_publish_date(list_item.get("publishTime"))

        if publish_date and publish_date < args.since_date:
            LOGGER.info(
                "公告早于日期下限，跳过并停止：当前页 %s，当前公告序号 %s，公告 ID %s，发布时间 %s，日期下限 %s",
                page_no,
                item_index,
                notice_id,
                publish_date.isoformat(),
                args.since_date.isoformat(),
            )
            stats["skipped_by_date"] += 1
            page_stats["before_since_date"] = 1
            break

        if not notice_id:
            stats["failed"] += 1
            page_stats["failed"] += 1
            append_failure(
                failures_path,
                {
                    "notice_id": "",
                    "title": title,
                    "url": "",
                    "stage": "parse",
                    "error": "list item has no id",
                },
            )
            continue

        notice_key_value = notice_key(args.notice_type, notice_id)
        if notice_key_value in processed_ids:
            LOGGER.info("本轮已处理，跳过：%s %s", notice_id, title)
            stats["skipped"] += 1
            page_stats["known_ids"] += 1
            continue
        processed_ids.add(notice_key_value)

        existing_path = existing_paths.get(notice_key_value)
        if existing_path and not args.overwrite:
            LOGGER.info("已存在，跳过：%s %s", notice_id, title)
            stats["skipped"] += 1
            page_stats["known_ids"] += 1
            continue

        page_stats["new_ids"] += 1
        stats["new_ids"] += 1

        list_item["_item_index"] = item_index
        list_item["_page_no"] = page_no
        todo_items.append(list_item)

    return todo_items, page_stats


def download_and_save_item(
    list_item: dict[str, Any],
    args: argparse.Namespace,
    session: Any,
    notices_dir: Path,
    failures_path: Path,
    existing_paths: dict[str, Path],
    index_records: dict[str, dict[str, Any]],
    stats: dict[str, int],
    throttle: Throttle,
    forbidden_state: dict[str, int],
) -> bool:
    """下载并保存单个公告详情，返回是否发生熔断 (circuit_breaker)"""
    notice_id = str(list_item.get("id") or "")
    title = str(list_item.get("noticeTitle") or "")
    item_index = list_item.get("_item_index", 1)
    page_no = list_item.get("_page_no", 1)
    
    notice_key_value = notice_key(args.notice_type, notice_id)
    existing_path = existing_paths.get(notice_key_value)
    circuit_breaker = False

    try:
        waited = throttle.wait_detail()
        LOGGER.info(
            "详情请求：当前页 %s，当前公告序号 %s，公告 ID %s，标题 %s，等待 %.1f 秒，连续 403 次数 %s",
            page_no,
            item_index,
            notice_id,
            title,
            waited,
            forbidden_state["consecutive"],
        )
        detail_data = request_with_403_handling(
            lambda: fetch_notice_detail(notice_id, args.column, session=session),
            args=args,
            stats=stats,
            forbidden_state=forbidden_state,
            stage="detail",
            title=title,
        )
        if detail_data is None:
            circuit_breaker = True
            raise CfcpnError(STOP_FORBIDDEN, status_code=403)
        LOGGER.info(
            "详情请求结果：当前页 %s，当前公告序号 %s，公告 ID %s，请求结果 success，连续 403 次数 %s",
            page_no,
            item_index,
            notice_id,
            forbidden_state["consecutive"],
        )
    except Exception as exc:
        LOGGER.error("详情请求失败：%s %s %s", notice_id, title, exc)
        stats["failed"] += 1
        append_failure(
            failures_path,
            {
                "notice_id": notice_id,
                "title": title,
                "url": build_detail_url(notice_id, args.column),
                "stage": "detail",
                "error": str(exc),
            },
        )
        return circuit_breaker

    try:
        notice = parse_notice_detail(
            detail_data,
            list_item,
            notice_type=args.notice_type,
            column=args.column,
        )
    except Exception as exc:
        LOGGER.error("字段解析失败：%s %s %s", notice_id, title, exc)
        stats["failed"] += 1
        append_failure(
            failures_path,
            {
                "notice_id": notice_id,
                "title": title,
                "url": detail_data.get("_detail_url", ""),
                "stage": "parse",
                "error": str(exc),
            },
        )
        return circuit_breaker

    try:
        if args.overwrite and existing_path and existing_path.exists():
            existing_path.unlink()
        path = write_notice_markdown(notice, notices_dir, keyword=args.keyword)
        existing_paths[notice_key_value] = path
        index_records[notice_id] = {
            "notice_id": notice_id,
            "title": notice.get("title", ""),
            "publish_time": notice.get("publish_time", ""),
            "purchaser": notice.get("purchaser", ""),
            "region": notice.get("region", ""),
            "keyword": args.keyword,
            "path": path,
        }
        stats["saved"] += 1
        LOGGER.info("已保存：%s", path)
    except Exception as exc:
        LOGGER.error("写入失败：%s %s %s", notice_id, title, exc)
        stats["failed"] += 1
        append_failure(
            failures_path,
            {
                "notice_id": notice_id,
                "title": title,
                "url": notice.get("detail_url", ""),
                "stage": "write",
                "error": str(exc),
            },
        )
    return circuit_breaker


def emit_progress(
    stage: str,
    progress: int,
    message: str,
    *,
    current: int | None = None,
    total: int | None = None,
) -> None:
    payload = {
        "stage": stage,
        "progress": max(0, min(100, int(progress))),
        "message": message,
    }
    if current is not None and total is not None:
        payload["current"] = max(0, int(current))
        payload["total"] = max(0, int(total))
    print(f"::progress::{json.dumps(payload, ensure_ascii=False)}", flush=True)


def append_failure(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "notice_id": str(record.get("notice_id") or ""),
        "title": str(record.get("title") or ""),
        "url": str(record.get("url") or ""),
        "stage": str(record.get("stage") or ""),
        "error": str(record.get("error") or "")[:500],
        "time": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def parse_publish_date(value: Any) -> date | None:
    text = str(value or "")
    match = re.search(r"\d{4}-\d{2}-\d{2}", text)
    if not match:
        return None
    try:
        return date.fromisoformat(match.group(0))
    except ValueError:
        return None


def load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        LOGGER.info("未找到 checkpoint：%s", path)
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        LOGGER.warning("checkpoint 无法读取：%s %s", path, exc)
        return {}


def write_checkpoint(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=path.name, suffix=".tmp", dir=str(path.parent))
    try:
        with open(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        Path(tmp_name).replace(path)
    except Exception:
        Path(tmp_name).unlink(missing_ok=True)
        raise


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def notice_key(notice_type: str, notice_id: str) -> str:
    return f"{notice_type}:{notice_id}"


def scan_existing_notices(
    notices_dir: Path,
    notice_type: str,
) -> tuple[dict[str, Path], dict[str, dict[str, Any]]]:
    paths: dict[str, Path] = {}
    index_records: dict[str, dict[str, Any]] = {}
    if not notices_dir.exists():
        return paths, index_records
    for path in notices_dir.glob("*.md"):
        data = read_front_matter(path)
        notice_id = str(data.get("notice_id") or "")
        existing_notice_type = str(data.get("notice_type") or "")
        if notice_type == "procurement" and existing_notice_type == "":
            existing_notice_type = "procurement"
        if notice_id and existing_notice_type == notice_type:
            key = notice_key(notice_type, notice_id)
            if key not in paths:
                paths[key] = path
                index_records[notice_id] = {
                    "notice_id": notice_id,
                    "title": data.get("title", ""),
                    "publish_time": data.get("publish_time", ""),
                    "purchaser": data.get("purchaser", ""),
                    "region": data.get("region", ""),
                    "keyword": data.get("keyword", ""),
                    "path": path,
                }
    return paths, index_records


def rebuild_index(index_records: dict[str, dict[str, Any]], index_path: Path) -> Path:
    notices = list(index_records.values())
    paths = {
        notice_id: record["path"]
        for notice_id, record in index_records.items()
        if isinstance(record.get("path"), Path)
    }
    return write_index_markdown(notices, paths, index_path)


def read_front_matter(path: Path) -> dict[str, str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    match = FRONT_MATTER_RE.match(text)
    if not match:
        return {}

    data: dict[str, str] = {}
    for line in match.group("body").splitlines():
        line_match = FRONT_MATTER_LINE_RE.match(line)
        if not line_match:
            continue
        key = line_match.group("key")
        raw_value = line_match.group("value").strip()
        try:
            value = json.loads(raw_value)
        except json.JSONDecodeError:
            value = raw_value.strip("\"'")
        data[key] = str(value)
    return data


def print_stats(
    stats: dict[str, int],
    output_dir: Path,
    index_path: Path,
    checkpoint_path: Path,
    update_mode: bool,
    stop_reason: str,
    circuit_breaker: bool,
) -> None:
    print(f"运行模式: {'增量更新' if update_mode else '普通扫描'}")
    print(f"检索关键词: {stats.get('keyword', '')}")
    print(f"公告类型: {stats.get('notice_type', '')}")
    print(f"栏目: {stats.get('column', '')}")
    print(f"请求页数: {stats['list_pages']}")
    print(f"检查公告数: {stats['found']}")
    print(f"发现新 ID 数量: {stats['new_ids']}")
    print(f"成功保存数: {stats['saved']}")
    print(f"跳过旧公告数: {stats['skipped']}")
    print(f"日期过滤跳过数: {stats['skipped_by_date']}")
    print(f"失败数: {stats['failed']}")
    print(f"403 数量: {stats['forbidden']}")
    print(f"是否触发熔断: {'是' if circuit_breaker else '否'}")
    print(f"停止原因: {stop_reason}")
    print(f"checkpoint 路径: {checkpoint_path}")
    print(f"输出目录: {output_dir}")
    print(f"索引文件路径: {index_path}")


if __name__ == "__main__":
    sys.exit(main())
