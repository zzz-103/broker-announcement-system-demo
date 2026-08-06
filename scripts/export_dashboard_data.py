"""Export the standardized dashboard data package.

Examples (run from the repository root)::

    python scripts/export_dashboard_data.py
    python scripts/export_dashboard_data.py --zip

The command reads the same processed files used by FastAPI and writes the
standardized dashboard-data directory consumed by the frontend API.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.api.dashboard_package import dashboard_package_builder  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="导出世纪证券标准看板数据包")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("backend/data/dashboard-data"),
        help="输出目录，默认 backend/data/dashboard-data",
    )
    parser.add_argument(
        "--zip",
        action="store_true",
        help="同时在输出目录旁生成 dashboard-data.zip",
    )
    args = parser.parse_args()
    output = args.output if args.output.is_absolute() else PROJECT_ROOT / args.output
    package = dashboard_package_builder.build(force=True)
    dashboard_package_builder.export(package, target=output, write_zip=args.zip)
    try:
        display_output = str(output.resolve().relative_to(PROJECT_ROOT))
    except ValueError:
        display_output = str(output.resolve())
    print(json.dumps({
        "output": display_output,
        "generated_at": package.manifest["generated_at"],
        "schema_version": package.manifest["schema_version"],
        "datasets": {
            key: value["record_count"]
            for key, value in package.manifest["datasets"].items()
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
