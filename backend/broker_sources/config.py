from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_CONFIG_PATH = Path(__file__).with_name("sources.json")


@dataclass(frozen=True)
class BrokerSourceConfig:
    key: str
    broker_name: str
    collector: str
    enabled: bool
    pages: int
    page_size: int
    min_content_chars: int
    min_detail_success_ratio: float
    aliases: tuple[str, ...]
    settings: dict[str, Any]


def load_configs(path: Path = DEFAULT_CONFIG_PATH) -> dict[str, BrokerSourceConfig]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    brokers = payload.get("brokers")
    if not isinstance(brokers, list):
        raise ValueError("broker source config must contain a brokers list")
    configs: dict[str, BrokerSourceConfig] = {}
    for item in brokers:
        if not isinstance(item, dict):
            raise ValueError("broker source config entries must be objects")
        config = BrokerSourceConfig(
            key=str(item["key"]),
            broker_name=str(item["broker_name"]),
            collector=str(item["collector"]),
            enabled=bool(item.get("enabled", False)),
            pages=max(1, int(item.get("pages", 1))),
            page_size=max(1, int(item.get("page_size", 10))),
            min_content_chars=max(1, int(item.get("min_content_chars", 80))),
            min_detail_success_ratio=min(
                1.0, max(0.0, float(item.get("min_detail_success_ratio", 0.8)))
            ),
            aliases=tuple(str(value) for value in item.get("aliases", [])),
            settings=dict(item.get("settings") or {}),
        )
        if config.key in configs:
            raise ValueError(f"duplicate broker source config: {config.key}")
        configs[config.key] = config
    return configs
