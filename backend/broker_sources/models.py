from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class StandardNotice:
    """Unified record emitted by every announcement source."""

    broker_key: str
    broker_name: str
    source_kind: str
    source_name: str
    notice_id: str
    notice_type: str
    title: str
    publish_date: str
    source_url: str
    collected_at: str
    collection_status: str
    content_text: str
    content_html: str = ""
    raw_list_path: str = ""
    raw_detail_path: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CollectionManifest:
    broker_key: str
    broker_name: str
    source_kind: str
    source_name: str
    started_at: str
    finished_at: str
    status: str
    quality_passed: bool
    requested_pages: int
    successful_pages: int
    listed_count: int
    detail_success_count: int
    detail_failure_count: int
    valid_count: int
    completeness_ratio: float
    output_dir: str
    raw_dir: str
    errors: list[str] = field(default_factory=list)
    since_date: str | None = None
    scanned_pages: int = 0
    skipped_count: int = 0
    new_count: int = 0
    stop_reason: str = ""
    checkpoint_path: str = ""
    resumed: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
