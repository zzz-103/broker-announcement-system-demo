from __future__ import annotations

import argparse
import json
import os
from dataclasses import replace
from datetime import date
from pathlib import Path

from .collectors import CenturyCollector, CiticCollector, HuaxiCollector
from .config import DEFAULT_CONFIG_PATH, BrokerSourceConfig, load_configs
from .selector import prepare_selected_sources


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCRAPER_OUTPUT = (
    PROJECT_ROOT / "backend" / "python-http-www-cfcpn-com-jcw" / "output"
)
DEFAULT_OFFICIAL_ROOT = PROJECT_ROOT / "backend" / "data" / "official-sources"
DEFAULT_SELECTED_ROOT = DEFAULT_SCRAPER_OUTPUT / "selected"


def resolve_path(value: str | None, default: Path) -> Path:
    path = Path(value) if value else default
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


def positive_int(value: str) -> int:
    try:
        number = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an integer") from exc
    if number < 1:
        raise argparse.ArgumentTypeError("must be >= 1")
    return number


def iso_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be YYYY-MM-DD") from exc


def make_collector(
    config: BrokerSourceConfig,
    output_root: Path,
    *,
    since_date: date | None = None,
    max_pages: int | None = None,
    workers: int = 8,
    resume: bool = False,
    overwrite: bool = False,
) -> CenturyCollector | CiticCollector | HuaxiCollector:
    collectors = {
        "century": CenturyCollector,
        "citic": CiticCollector,
        "huaxi": HuaxiCollector,
    }
    collector_type = collectors.get(config.collector)
    if collector_type is None:
        raise ValueError(f"unknown collector type: {config.collector}")
    runtime_config = replace(config, pages=max_pages or config.pages)
    return collector_type(
        runtime_config,
        PROJECT_ROOT,
        output_root,
        since_date=since_date,
        max_pages=max_pages,
        workers=workers,
        resume=resume,
        overwrite=overwrite,
    )


def collect_command(args: argparse.Namespace) -> int:
    configs = load_configs(resolve_path(str(args.config), DEFAULT_CONFIG_PATH))
    requested = args.broker or [
        key for key, config in configs.items() if config.enabled
    ]
    unknown = sorted(set(requested).difference(configs))
    if unknown:
        raise ValueError(f"unknown broker keys: {', '.join(unknown)}")
    output_root = resolve_path(
        os.getenv("OFFICIAL_SOURCE_DATA_DIR"), DEFAULT_OFFICIAL_ROOT
    )
    manifests = []
    for key in requested:
        config = configs[key]
        if not config.enabled and not args.include_disabled:
            continue
        since_date = args.since_date
        max_pages = args.max_pages or (100 if since_date else config.pages)
        print(
            f"[official:{key}] 开始采集 | 日期范围："
            f"{since_date.isoformat() if since_date else '不限'} 至今 | "
            f"最大页数：{max_pages} | 详情并发：{args.workers} | "
            f"断点：{'恢复' if args.resume else '自动复用已完成公告'}",
            flush=True,
        )
        manifest = make_collector(
            config,
            output_root,
            since_date=since_date,
            max_pages=max_pages,
            workers=args.workers,
            resume=args.resume,
            overwrite=args.overwrite,
        ).run()
        manifests.append(manifest.to_dict())
        print(
            f"[official:{key}] status={manifest.status} "
            f"quality_passed={manifest.quality_passed} "
            f"pages={manifest.scanned_pages} valid={manifest.valid_count} "
            f"new={manifest.new_count} skipped={manifest.skipped_count} "
            f"stop={manifest.stop_reason}",
            flush=True,
        )
    print(json.dumps(manifests, ensure_ascii=False, indent=2))
    # A site failure is a normal fallback condition. Configuration/programming
    # errors still raise and return a non-zero exit code through main().
    return 0


def prepare_command(args: argparse.Namespace) -> int:
    configs = load_configs(resolve_path(str(args.config), DEFAULT_CONFIG_PATH))
    result = prepare_selected_sources(
        project_root=PROJECT_ROOT,
        configs=configs,
        official_root=resolve_path(
            os.getenv("OFFICIAL_SOURCE_DATA_DIR"), DEFAULT_OFFICIAL_ROOT
        ),
        cfcpn_procurement_dir=resolve_path(
            os.getenv("CFCPN_PROCUREMENT_INPUT_DIR"),
            DEFAULT_SCRAPER_OUTPUT / "notices",
        ),
        cfcpn_result_dir=resolve_path(
            os.getenv("CFCPN_RESULT_INPUT_DIR"),
            DEFAULT_SCRAPER_OUTPUT / "result" / "notices",
        ),
        external_dir=resolve_path(
            os.getenv("LLM_EXTERNAL_INPUT_DIR"),
            DEFAULT_SCRAPER_OUTPUT / "external" / "notices",
        ),
        output_root=resolve_path(
            os.getenv("SELECTED_SOURCE_OUTPUT_DIR"), DEFAULT_SELECTED_ROOT
        ),
    )
    print(json.dumps(result.__dict__, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="采集券商官网公告，并按 官网 > 金采网 > 外部数据 选择 LLM 输入。"
    )
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    subparsers = parser.add_subparsers(dest="command", required=True)

    collect = subparsers.add_parser("collect", help="运行启用的官网采集器")
    collect.add_argument("--broker", action="append", help="券商 key，可重复")
    collect.add_argument("--include-disabled", action="store_true")
    collect.add_argument(
        "--since-date",
        type=iso_date,
        default=os.getenv("OFFICIAL_SOURCE_SINCE_DATE", "2026-04-01"),
        help="只采集此日期及之后的公告，默认 2026-04-01，可由 OFFICIAL_SOURCE_SINCE_DATE 覆盖",
    )
    collect.add_argument(
        "--max-pages",
        type=positive_int,
        help="最多扫描页数；传入日期时默认 100",
    )
    collect.add_argument(
        "--workers",
        type=positive_int,
        default=8,
        help="详情并发数，默认 8",
    )
    collect.add_argument("--resume", action="store_true", help="从未完成 checkpoint 的页继续")
    collect.add_argument("--overwrite", action="store_true", help="重新下载已有公告详情")
    collect.set_defaults(handler=collect_command)

    prepare = subparsers.add_parser("prepare", help="准备统一、去重后的 LLM 输入")
    prepare.set_defaults(handler=prepare_command)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.handler(args)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
