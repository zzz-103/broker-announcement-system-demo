from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LLM_OVERRIDE_PATH = PROJECT_ROOT / "backend" / "data" / "llm_api_config.override.json"


def resolve_llm_override_path() -> Path:
    """Return the server-side DeepSeek/LLM override path.

    The override intentionally lives below ``backend/data`` so it can be
    ignored by deployments and never needs to be exposed to the frontend.
    Tests may point it at a temporary file with ``LLM_CONFIG_OVERRIDE_PATH``.
    """
    configured = os.getenv("LLM_CONFIG_OVERRIDE_PATH")
    path = Path(configured) if configured else DEFAULT_LLM_OVERRIDE_PATH
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


def resolve_llm_config_source(config_path: Path) -> Path:
    """Resolve the administrator override before the legacy config path."""
    override_path = resolve_llm_override_path()
    return override_path if override_path.exists() else config_path


def llm_config_available(config_path: Path) -> bool:
    """Return whether either the shared override or fallback config exists."""
    return resolve_llm_config_source(config_path).exists()


def write_llm_config_override(payload: dict[str, object], path: Path | None = None) -> Path:
    """Atomically write an administrator-supplied LLM config override."""
    destination = (path or resolve_llm_override_path()).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=destination.parent,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, destination)
        temporary_path = None
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
    return destination


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
        source_path = resolve_llm_config_source(config_path)
        payload = json.loads(source_path.read_text(encoding="utf-8"))
        return cls(
            base_url=str(payload.get("base_url", "")).strip(),
            api_key=str(payload.get("api_key", "")).strip(),
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
        try:
            parsed_base_url = urlsplit(self.base_url)
        except ValueError as exc:
            raise ValueError("llm_api_config.json 的 base_url 无效") from exc
        if (
            parsed_base_url.scheme not in {"http", "https"}
            or not parsed_base_url.hostname
            or parsed_base_url.username
            or parsed_base_url.password
            or parsed_base_url.query
            or parsed_base_url.fragment
        ):
            raise ValueError("llm_api_config.json 的 base_url 必须是有效的 HTTP(S) 地址")
        if not self.api_key:
            raise ValueError("llm_api_config.json 缺少 api_key")
        if not self.model:
            raise ValueError("llm_api_config.json 缺少 model")
        if not 1 <= self.timeout_seconds <= 600:
            raise ValueError("llm_api_config.json 的 timeout_seconds 必须在 1 到 600 之间")
        if not 1 <= self.max_tokens <= 1_000_000:
            raise ValueError("llm_api_config.json 的 max_tokens 必须在 1 到 1000000 之间")


class OpenAICompatibleClient:
    def __init__(self, config: LLMApiConfig) -> None:
        try:
            from openai import OpenAI
        except ImportError as exc:  # pragma: no cover - runtime dependency guard
            raise ImportError(
                "缺少 openai 依赖，请先在当前环境中安装 openai。"
            ) from exc
        self.config = config
        timeout = httpx.Timeout(
            self.config.timeout_seconds,
            connect=min(5.0, self.config.timeout_seconds),
            write=min(10.0, self.config.timeout_seconds),
            pool=min(5.0, self.config.timeout_seconds),
        )
        self.client = OpenAI(
            base_url=self.config.base_url,
            api_key=self.config.api_key,
            timeout=timeout,
            max_retries=0,
        )

    def _request_json(self, request_kwargs: dict[str, Any], *, fallback_to_text: bool = False) -> Any:
        response = self.client.chat.completions.create(**request_kwargs)
        content = self._extract_message_content(response)
        try:
            return parse_json_text(content)
        except ValueError:
            if fallback_to_text:
                return content
            raise

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
