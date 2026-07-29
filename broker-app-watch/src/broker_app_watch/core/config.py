"""Load application settings and broker source definitions."""

import os
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict

from broker_app_watch.core.paths import CONFIG_DIR, PROJECT_ROOT


class BrokerSource(BaseModel):
    """One broker App update source."""

    model_config = ConfigDict(extra="forbid")

    broker_code: str
    broker_name: str
    app_name: str
    source_url: HttpUrl
    source_type: Literal["http", "api", "browser"]
    parser: str
    enabled: bool = True
    fetch_url: HttpUrl | None = None
    request_method: Literal["GET", "POST"] = "GET"
    request_json: dict[str, Any] | None = None
    parser_options: dict[str, Any] = Field(default_factory=dict)


class BrokerCatalog(BaseModel):
    """Validated broker source catalog."""

    brokers: list[BrokerSource] = Field(default_factory=list)

    @property
    def enabled_sources(self) -> list[BrokerSource]:
        disabled = {
            item.strip()
            for item in os.getenv("BAW_DISABLED_BROKERS", "").split(",")
            if item.strip()
        }
        return [
            source
            for source in self.brokers
            if source.enabled and source.broker_code not in disabled
        ]


class AppSettings(BaseSettings):
    """Small set of runtime settings, overridable through BAW_* variables."""

    model_config = SettingsConfigDict(
        env_prefix="BAW_",
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = "development"
    log_level: str = "INFO"
    database_url: str | None = None
    browser_enabled: bool = False
    request_timeout_seconds: float = 20.0


def _read_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        content = yaml.safe_load(file) or {}
    if not isinstance(content, dict):
        raise ValueError(f"YAML root must be a mapping: {path.name}")
    return content


def load_broker_catalog(path: Path | None = None) -> BrokerCatalog:
    """Load and validate broker sources from YAML."""

    config_path = path or CONFIG_DIR / "brokers.yaml"
    return BrokerCatalog.model_validate(_read_yaml(config_path))


def load_settings(path: Path | None = None) -> AppSettings:
    """Load optional YAML settings, with environment variables taking precedence."""

    config_path = path or CONFIG_DIR / "settings.yaml"
    yaml_values = _read_yaml(config_path) if config_path.exists() else {}
    return AppSettings(**yaml_values)
