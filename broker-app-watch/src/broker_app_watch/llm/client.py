"""Small OpenAI-compatible client used by the App Watch refresh command."""

import json
import re
from pathlib import Path
from typing import Protocol

import httpx

from broker_app_watch.llm.schemas import ReleaseAnalysis
from broker_app_watch.storage.models import (
    AppReleaseAnalysis,
    AppReleaseAnalysisResponse,
    ReleaseRecord,
)


class LlmClient(Protocol):
    """Analyze one release without coupling the project to a model SDK."""

    def analyze(self, release: ReleaseRecord) -> ReleaseAnalysis: ...


class AppReleaseLlmClient(Protocol):
    """Provider boundary kept narrow for deterministic refresh tests."""

    def extract(self, *, metadata: dict[str, str], content: str) -> list[AppReleaseAnalysis]: ...


def _strip_json_fence(value: str) -> str:
    text = value.strip()
    match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.IGNORECASE | re.DOTALL)
    return match.group(1).strip() if match else text


def parse_app_release_response(value: str) -> list[AppReleaseAnalysis]:
    """Parse the provider response while accepting a list or an envelope."""

    payload = json.loads(_strip_json_fence(value))
    if isinstance(payload, list):
        payload = {"releases": payload}
    if not isinstance(payload, dict):
        raise ValueError("LLM response must be a JSON object or array")
    if "releases" not in payload:
        # Some compatible providers return one item directly.
        payload = {"releases": [payload]}
    parsed = AppReleaseAnalysisResponse.model_validate(payload)
    return parsed.releases


class OpenAICompatibleAppReleaseClient:
    """Call a chat-completions compatible endpoint without an SDK dependency."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float = 120.0,
        temperature: float = 0.1,
        top_p: float = 1.0,
        max_tokens: int | None = None,
        use_json_object: bool = True,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.temperature = temperature
        self.top_p = top_p
        self.max_tokens = max_tokens
        self.use_json_object = use_json_object

    @classmethod
    def from_config(cls, path: Path) -> "OpenAICompatibleAppReleaseClient":
        """Load only the non-sensitive shape needed by the refresh command."""

        with path.open("r", encoding="utf-8") as handle:
            config = json.load(handle)
        if not isinstance(config, dict):
            raise ValueError("LLM 配置必须是 JSON 对象")
        api_key = str(config.get("api_key") or "").strip()
        if not api_key:
            raise ValueError("LLM API key is missing")
        base_url = str(config.get("base_url") or "").strip()
        model = str(config.get("model") or "").strip()
        if not base_url or not model:
            raise ValueError("LLM base_url and model are required")
        return cls(
            base_url=base_url,
            api_key=api_key,
            model=model,
            timeout_seconds=float(config.get("timeout_seconds", 120)),
            temperature=float(config.get("temperature", 0.1)),
            top_p=float(config.get("top_p", 1.0)),
            max_tokens=(int(config["max_tokens"]) if config.get("max_tokens") else None),
            use_json_object=bool(config.get("use_json_object", True)),
        )

    def extract(self, *, metadata: dict[str, str], content: str) -> list[AppReleaseAnalysis]:
        system_prompt = (
            "你是券商手机 App 更新公告结构化助手。只输出 JSON，不要 Markdown。"
            "JSON 格式必须是 {\"releases\":[...]}，每项包含 app_version、platform、"
            "publish_date、update_type、update_summary、feature_tags、highlights。"
            "无法确认的字符串留空；platform 未知时填 未知；不要编造日期、版本或功能。"
            "update_type 只能使用 新功能、体验优化、问题修复、合规安全、其他。"
            "feature_tags 只能使用 行情、交易、开户、理财、资讯、AI智能、安全、其他。"
        )
        user_prompt = json.dumps(
            {"source_metadata": metadata, "markdown": content},
            ensure_ascii=False,
        )
        request: dict[str, object] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": self.temperature,
            "top_p": self.top_p,
        }
        if self.max_tokens is not None:
            request["max_tokens"] = self.max_tokens
        if self.use_json_object:
            request["response_format"] = {"type": "json_object"}

        try:
            response = httpx.post(
                f"{self.base_url}/chat/completions",
                json=request,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            body = response.json()
            message = body["choices"][0]["message"]["content"]
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise RuntimeError("App Watch LLM 请求或响应失败") from exc
        if not isinstance(message, str) or not message.strip():
            raise ValueError("App Watch LLM 返回为空")
        return parse_app_release_response(message)
