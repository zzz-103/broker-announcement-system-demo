"""Analysis boundary that can later use an LLM client."""

from broker_app_watch.llm.client import LlmClient
from broker_app_watch.llm.schemas import ReleaseAnalysis
from broker_app_watch.storage.models import ReleaseRecord


def analyze_release(record: ReleaseRecord, client: LlmClient) -> ReleaseAnalysis:
    """Delegate one normalized record to the configured analysis client."""

    return client.analyze(record)
