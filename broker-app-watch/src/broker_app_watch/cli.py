"""Command-line entry points for configuration checks and crawling."""

import argparse
from collections.abc import Sequence
from pathlib import Path

from broker_app_watch.core.config import load_broker_catalog, load_settings
from broker_app_watch.core.paths import EXPORTS_DATA_DIR, PROJECT_ROOT, RAW_DATA_DIR
from broker_app_watch.llm.client import OpenAICompatibleAppReleaseClient
from broker_app_watch.pipeline.crawl import build_crawl_plan, crawl_all, crawl_broker
from broker_app_watch.pipeline.refresh import RefreshError, process_existing, refresh_all


def _check_config() -> int:
    catalog = load_broker_catalog()
    settings = load_settings()
    print(f"配置读取成功：{len(catalog.brokers)} 个来源，环境={settings.environment}")
    return 0


def _list_sources() -> int:
    sources = load_broker_catalog().enabled_sources
    if not sources:
        print("没有已启用的券商来源。")
        return 0
    for source in sources:
        print(
            f"{source.broker_code}\t{source.broker_name}\t{source.app_name}"
            f"\t{source.source_type}\t{source.source_url}"
        )
    return 0


def _dry_run() -> int:
    plan = build_crawl_plan(load_broker_catalog())
    print(f"Dry-run：计划处理 {len(plan)} 个已启用来源，不发起网络请求。")
    for item in plan:
        print(
            f"- {item.broker_code} / {item.app_name}: "
            f"collector={item.source_type}, parser={item.parser}"
        )
    return 0


def _crawl(args: argparse.Namespace) -> int:
    catalog = load_broker_catalog()
    if args.broker:
        try:
            output = crawl_broker(catalog, args.broker)
        except Exception as exc:  # noqa: BLE001 - CLI converts one failure to exit code
            print(f"成功：0\n失败：1\n\n{args.broker} -> {type(exc).__name__}")
            return 1
        print(f"成功：1\n失败：0\n\n{args.broker} -> {output.as_posix()}")
        return 0

    summary = crawl_all(catalog)
    print(f"成功：{len(summary.success)}\n失败：{len(summary.failures)}")
    for broker_code, output in summary.success.items():
        print(f"\n{broker_code} -> {output.as_posix()}")
    for broker_code in summary.failures:
        print(f"\n{broker_code} -> 失败")
    return 1 if summary.failures else 0


def _resolve_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else PROJECT_ROOT / path


def _refresh(args: argparse.Namespace) -> int:
    if not args.all:
        print("refresh 目前只支持 --all。")
        return 2
    try:
        client = OpenAICompatibleAppReleaseClient.from_config(_resolve_path(args.llm_config))
        result = refresh_all(
            load_broker_catalog(),
            client=client,
            export_path=_resolve_path(args.export_path),
        )
    except (OSError, ValueError, RefreshError) as exc:
        print(f"App 更新刷新失败：{type(exc).__name__}")
        return 1

    if result.blocked:
        print(
            f"App 更新刷新已阻止发布：保留旧 CSV（{result.exported_rows} 条），"
            f"失败率 {result.failure_rate:.1%}。"
        )
        return 1
    print(f"App 更新刷新完成：导出 {result.exported_rows} 条记录。")
    if result.updated_brokers:
        print(f"已更新券商：{', '.join(result.updated_brokers)}")
    if result.preserved_brokers:
        print(f"沿用旧数据券商：{', '.join(result.preserved_brokers)}")
    for broker_code, message in sorted(result.failures.items()):
        print(f"警告：{broker_code} -> {message}")
    return 0


def _process(args: argparse.Namespace) -> int:
    try:
        client = OpenAICompatibleAppReleaseClient.from_config(_resolve_path(args.llm_config))
        result = process_existing(
            load_broker_catalog(),
            client=client,
            export_path=_resolve_path(args.export_path),
            raw_dir=_resolve_path(args.input_dir),
        )
    except (OSError, ValueError, RefreshError) as exc:
        print(f"App 更新处理失败：{type(exc).__name__}")
        return 1
    if result.blocked:
        print(
            f"App 更新处理已阻止发布：保留旧 CSV（{result.exported_rows} 条），"
            f"失败率 {result.failure_rate:.1%}。"
        )
        return 1
    print(f"App 更新处理完成：导出 {result.exported_rows} 条记录。")
    for path, message in sorted(result.failures.items()):
        print(f"警告：{path} -> {message}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="券商 App 更新记录采集与分析工具")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("check-config", "list-sources", "dry-run"):
        subparsers.add_parser(command, help="执行项目检查")
    crawl_parser = subparsers.add_parser("crawl", help="抓取并保存 Markdown")
    crawl_group = crawl_parser.add_mutually_exclusive_group(required=True)
    crawl_group.add_argument("--broker", help="单个券商代码")
    crawl_group.add_argument("--all", action="store_true", help="全部已启用来源")
    refresh_parser = subparsers.add_parser("refresh", help="抓取并生成结构化 App 更新 CSV")
    refresh_parser.add_argument("--all", action="store_true", help="刷新全部已启用来源")
    refresh_parser.add_argument("--llm-config", required=True, help="LLM JSON 配置路径")
    refresh_parser.add_argument(
        "--export-path",
        default=(EXPORTS_DATA_DIR / "app_releases.csv").as_posix(),
        help="CSV 导出路径",
    )
    process_parser = subparsers.add_parser("process", help="处理已有 Markdown 并生成 CSV")
    process_parser.add_argument("--input-dir", default=(RAW_DATA_DIR / "markdown").as_posix())
    process_parser.add_argument("--llm-config", required=True, help="LLM JSON 配置路径")
    process_parser.add_argument(
        "--export-path",
        default=(EXPORTS_DATA_DIR / "app_releases.csv").as_posix(),
        help="CSV 导出路径",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    commands = {
        "check-config": _check_config,
        "list-sources": _list_sources,
        "dry-run": _dry_run,
        "crawl": _crawl,
        "refresh": _refresh,
    }
    if args.command in {"crawl", "refresh", "process"}:
        if args.command == "process":
            return _process(args)
        return commands[args.command](args)
    return commands[args.command]()


if __name__ == "__main__":
    raise SystemExit(main())
