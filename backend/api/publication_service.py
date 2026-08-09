from __future__ import annotations

from datetime import datetime, timezone

from .config import PROJECT_ROOT, settings
from .contracts import PublishPlan
from .dashboard_data import (
    backup_csv_atomically,
    count_csv_records,
    prune_old_announcement_backups,
    publish_csv_atomically,
)
from .supplemental_seed import CANONICAL_FIELDS, merge_for_publication, supplemental_data_dir


class PublicationError(RuntimeError):
    """A candidate dataset cannot safely replace the formal dashboard data."""


def build_publish_plan() -> PublishPlan:
    merged_path = settings.merged_announcement_csv_path
    target_path = settings.announcement_csv_path
    if not merged_path.exists():
        raise FileNotFoundError("final merged announcement CSV not found; run the matching pipeline first")

    previous_count = count_csv_records(target_path)
    merge_result = merge_for_publication(merged_path, supplemental_data_dir(PROJECT_ROOT))
    published_count = len(merge_result.records)
    if published_count <= 0:
        raise PublicationError("publication rejected: candidate dataset is empty")

    retain_ratio = published_count / previous_count if previous_count > 0 else 1.0
    minimum_ratio = settings.publish_min_retain_ratio
    if previous_count > 0 and retain_ratio < minimum_ratio:
        raise PublicationError(
            "publication rejected: candidate retains "
            f"{retain_ratio:.1%} of the previous dataset; minimum is {minimum_ratio:.1%}"
        )

    return PublishPlan(
        fieldnames=CANONICAL_FIELDS,
        records=merge_result.records,
        meta={
            **merge_result.meta,
            "previous_count": previous_count,
            "source_count": merge_result.meta["staging_count"],
            "retain_ratio": retain_ratio,
            "minimum_retain_ratio": minimum_ratio,
        },
    )


def publish_merged_announcements() -> dict[str, object]:
    """Validate, back up and atomically publish the merged candidate dataset."""
    target_path = settings.announcement_csv_path
    publish_plan = build_publish_plan()
    backup_name = backup_csv_atomically(target_path)
    publish_csv_atomically(publish_plan.fieldnames, publish_plan.records, target_path)
    prune_old_announcement_backups(target_path)

    published_at = datetime.now(timezone.utc).isoformat()
    updated_at = datetime.fromtimestamp(target_path.stat().st_mtime, timezone.utc).isoformat()
    return {
        **publish_plan.meta,
        "count": len(publish_plan.records),
        "published_count": len(publish_plan.records),
        "published_at": published_at,
        "updated_at": updated_at,
        "backup_file": backup_name,
    }
