"""Repository protocol for a future file or PostgreSQL implementation."""

from typing import Protocol

from backend.broker_app_watch.storage.models import ReleaseRecord


class ReleaseRepository(Protocol):
    """Persistence operations required by the pipeline."""

    def save(self, release: ReleaseRecord) -> None: ...

    def list_recent(self, limit: int = 100) -> list[ReleaseRecord]: ...
