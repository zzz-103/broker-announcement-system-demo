"""Small parser contracts for turning fetched content into structured正文."""

from abc import ABC, abstractmethod
from dataclasses import dataclass

from broker_app_watch.collectors.base import CollectedContent
from broker_app_watch.core.config import BrokerSource


@dataclass(frozen=True, slots=True)
class ParsedSection:
    """One named正文 section."""

    heading: str
    content: str


@dataclass(frozen=True, slots=True)
class ParsedDocument:
    """Structured正文 returned by a parser."""

    title: str
    sections: list[ParsedSection]
    source_metadata: dict[str, str]


@dataclass(frozen=True, slots=True)
class ReleaseCandidate:
    """Legacy shape retained for the unused normalization skeleton."""

    title: str
    content: str
    version: str | None = None
    published_at: str | None = None


class Parser(ABC):
    """Parse one response body without writing or classifying it."""

    @abstractmethod
    def parse(
        self, body: str, source: BrokerSource, response: CollectedContent
    ) -> ParsedDocument:
        """Return structured正文 from the response body."""


def clean_text(value: str) -> str:
    """Apply only the whitespace cleanup allowed for saved正文."""

    import re

    value = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    return re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", value)
