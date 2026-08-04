"""Normalization step placeholder."""

from backend.broker_app_watch.parsers.base import ReleaseCandidate
from backend.broker_app_watch.storage.models import ReleaseRecord


def normalize_candidate(candidate: ReleaseCandidate, broker_code: str, app_name: str) -> ReleaseRecord:
    """Convert a parsed candidate into the stable storage model."""

    return ReleaseRecord(
        broker_code=broker_code,
        app_name=app_name,
        version=candidate.version,
        title=candidate.title,
        content=candidate.content,
        published_at=candidate.published_at,
    )
