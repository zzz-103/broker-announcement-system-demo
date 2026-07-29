"""Protocol for plugging in an LLM provider later."""

from typing import Protocol

from broker_app_watch.llm.schemas import ReleaseAnalysis
from broker_app_watch.storage.models import ReleaseRecord


class LlmClient(Protocol):
    """Analyze one release without coupling the project to a model SDK."""

    def analyze(self, release: ReleaseRecord) -> ReleaseAnalysis: ...
