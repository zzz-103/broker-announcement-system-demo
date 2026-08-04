"""App Watch LLM adapter backed by the shared backend client."""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from backend.llm_table.llm_client import (
    LLMApiConfig,
    OpenAICompatibleClient,
    parse_json_text,
)

from backend.broker_app_watch.llm.schemas import ReleaseAnalysis
from backend.broker_app_watch.storage.models import (
    AppReleaseAnalysis,
    ReleaseRecord,
)


class LlmClient(Protocol):
    """Analyze one release without coupling the project to a model SDK."""

    def analyze(self, release: ReleaseRecord) -> ReleaseAnalysis: ...


class AppReleaseLlmClient(Protocol):
    """Provider boundary kept narrow for deterministic refresh tests."""

    def extract(
        self, *, metadata: dict[str, str], content: str
    ) -> "AppReleaseExtraction": ...


@dataclass(slots=True)
class AppReleaseExtraction:
    analyses: list[AppReleaseAnalysis] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def __getitem__(self, index: int) -> AppReleaseAnalysis:
        return self.analyses[index]

    def __len__(self) -> int:
        return len(self.analyses)


def parse_app_release_response(value: str | Any) -> AppReleaseExtraction:
    """Parse the provider response while accepting a list or an envelope."""

    payload = parse_json_text(value) if isinstance(value, str) else value
    if isinstance(payload, list):
        payload = {"releases": payload}
    if not isinstance(payload, dict):
        raise ValueError("LLM response must be a JSON object or array")
    if "releases" not in payload:
        # Some compatible providers return one item directly.
        payload = {"releases": [payload]}
    releases = payload.get("releases")
    if not isinstance(releases, list):
        raise ValueError("LLM response releases must be an array")
    analyses: list[AppReleaseAnalysis] = []
    errors: list[str] = []
    for index, item in enumerate(releases):
        try:
            analyses.append(AppReleaseAnalysis.model_validate(item))
        except Exception as exc:  # noqa: BLE001 - isolate one model item
            errors.append(f"item[{index}] {type(exc).__name__}")
    return AppReleaseExtraction(analyses=analyses, errors=errors)


class OpenAICompatibleAppReleaseClient:
    """Use the shared backend OpenAI-compatible client with an App Watch prompt."""

    def __init__(
        self,
        config: LLMApiConfig,
    ) -> None:
        self.config = config
        self.client = OpenAICompatibleClient(config)

    @classmethod
    def from_config(cls, path: Path) -> "OpenAICompatibleAppReleaseClient":
        config = LLMApiConfig.load(path)
        config.validate()
        return cls(config)

    def extract(self, *, metadata: dict[str, str], content: str) -> AppReleaseExtraction:
        system_prompt = (
            "你是券商手机 App 更新公告结构化助手。只输出 JSON，不要 Markdown。"
            "JSON 格式必须是 {\"releases\":[...]}，每项包含 app_name、app_version、platform、"
            "publish_date、update_type、update_summary、feature_tags、highlights。"
            "source_metadata 中已有的 broker_code、broker_name、source_url、trusted_app_name、"
            "deterministic_* 字段是权威值，不得改写；仅补充缺失字段。"
            "无法确认的字符串留空；platform 未知时填 未知；不要编造日期、版本或功能。"
            "update_type 只能使用 新功能、体验优化、问题修复、合规安全、其他。"
            "feature_tags 只能使用 行情、交易、开户、理财、资讯、AI智能、安全、其他。"
        )
        user_prompt = json.dumps(
            {"source_metadata": metadata, "markdown": content},
            ensure_ascii=False,
        )
        request: dict[str, object] = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": self.config.temperature,
            "top_p": self.config.top_p,
            "max_tokens": self.config.max_tokens,
            "frequency_penalty": self.config.frequency_penalty,
            "presence_penalty": self.config.presence_penalty,
        }
        if self.config.use_json_object:
            request["response_format"] = {"type": "json_object"}
        try:
            payload = self.client._request_json(request)
        except Exception as exc:  # noqa: BLE001 - caller records one unit failure
            raise RuntimeError("App Watch LLM 请求或响应失败") from exc
        return parse_app_release_response(payload)
