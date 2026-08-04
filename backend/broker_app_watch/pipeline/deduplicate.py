"""Small deterministic duplicate filter."""

from backend.broker_app_watch.storage.models import ReleaseRecord


def deduplicate_releases(records: list[ReleaseRecord]) -> list[ReleaseRecord]:
    """Keep the first record for each broker, App, version, and title key."""

    unique: list[ReleaseRecord] = []
    seen: set[tuple[str, str, str | None, str]] = set()
    for record in records:
        key = (record.broker_code, record.app_name, record.version, record.title)
        if key not in seen:
            seen.add(key)
            unique.append(record)
    return unique
