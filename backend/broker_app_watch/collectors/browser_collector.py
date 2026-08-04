"""Optional placeholder for pages that require a browser."""

from backend.broker_app_watch.collectors.base import CollectedContent, Collector
from backend.broker_app_watch.core.config import BrokerSource


class BrowserCollector(Collector):
    """Browser collection is intentionally unavailable unless implemented later."""

    def __init__(self, enabled: bool = False) -> None:
        self.enabled = enabled

    def collect(self, source: BrokerSource) -> CollectedContent:
        if not self.enabled:
            raise RuntimeError("Browser Collector is disabled by configuration")
        raise NotImplementedError("Browser automation is not implemented in the project skeleton")
