"""Collector contracts shared by static and dynamic sources."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Mapping

from backend.broker_app_watch.core.config import BrokerSource


@dataclass(frozen=True, slots=True)
class CollectedContent:
    """Raw content returned by a collector."""

    source: BrokerSource
    body: str
    content_type: str | None = None
    status_code: int | None = None
    final_url: str | None = None
    crawl_time: str | None = None
    metadata: Mapping[str, str] = field(default_factory=dict)


class Collector(ABC):
    """Fetch content for one configured source."""

    @abstractmethod
    def collect(self, source: BrokerSource) -> CollectedContent:
        """Return raw source content."""
