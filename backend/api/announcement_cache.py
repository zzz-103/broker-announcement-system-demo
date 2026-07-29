from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import threading
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


Projection = tuple[str, ...] | None
CacheKey = tuple[str, Projection]


@dataclass(frozen=True, slots=True)
class CachedAnnouncementResponse:
    version: tuple[str, int, int]
    gzip_body: bytes
    etag: str
    count: int
    updated_at: str

    @property
    def raw_body(self) -> bytes:
        """Compatibility accessor; raw JSON is not retained in memory."""

        return gzip.decompress(self.gzip_body)


class AnnouncementResponseCache:
    """Bounded streaming CSV-to-JSON cache shared by dashboard datasets."""

    def __init__(self, max_entries: int = 2) -> None:
        self._lock = threading.Lock()
        self._entries: OrderedDict[CacheKey, CachedAnnouncementResponse] = OrderedDict()
        self._max_entries = max(1, max_entries)
        self._build_count = 0

    @staticmethod
    def _version(path: Path) -> tuple[str, int, int]:
        stat_result = path.stat()
        return (str(path.resolve()), stat_result.st_mtime_ns, stat_result.st_size)

    @staticmethod
    def _build(
        path: Path,
        version: tuple[str, int, int],
        projection: Projection,
    ) -> CachedAnnouncementResponse:
        updated_at = datetime.fromtimestamp(
            version[1] / 1_000_000_000,
            timezone.utc,
        ).isoformat()
        compressed = io.BytesIO()
        digest = hashlib.sha256()
        count = 0

        with gzip.GzipFile(
            fileobj=compressed,
            mode="wb",
            compresslevel=3,
            mtime=0,
        ) as output:
            def write_json_bytes(value: bytes) -> None:
                digest.update(value)
                output.write(value)

            write_json_bytes(b'{"records":[')
            with path.open("r", encoding="utf-8-sig", newline="") as source:
                reader = csv.DictReader(source)
                fieldnames = tuple(reader.fieldnames or ())
                selected = (
                    tuple(field for field in projection if field in fieldnames)
                    if projection is not None
                    else fieldnames
                )
                for row in reader:
                    if count:
                        write_json_bytes(b",")
                    payload = {field: row.get(field, "") or "" for field in selected}
                    write_json_bytes(
                        json.dumps(
                            payload,
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ).encode("utf-8")
                    )
                    count += 1

            suffix = json.dumps(
                {"count": count, "updated_at": updated_at},
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
            write_json_bytes(b'],"meta":')
            write_json_bytes(suffix)
            write_json_bytes(b"}")

        return CachedAnnouncementResponse(
            version=version,
            gzip_body=compressed.getvalue(),
            etag=f'W/"{digest.hexdigest()}"',
            count=count,
            updated_at=updated_at,
        )

    def get(
        self,
        path: Path,
        projection: Projection = None,
    ) -> CachedAnnouncementResponse:
        normalized_projection = tuple(projection) if projection is not None else None
        key: CacheKey = (str(path.resolve()), normalized_projection)
        version = self._version(path)
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and entry.version == version:
                self._entries.move_to_end(key)
                return entry

        with self._lock:
            version = self._version(path)
            entry = self._entries.get(key)
            if entry is not None and entry.version == version:
                self._entries.move_to_end(key)
                return entry

            for _ in range(2):
                entry = self._build(path, version, normalized_projection)
                final_version = self._version(path)
                if final_version == version:
                    break
                version = final_version
            else:  # pragma: no cover - requires continuous external replacement
                entry = self._build(path, version, normalized_projection)

            self._entries[key] = entry
            self._entries.move_to_end(key)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)
            self._build_count += 1
            return entry

    def invalidate(self, path: Path | None = None) -> None:
        with self._lock:
            if path is None:
                self._entries.clear()
                return
            resolved = str(path.resolve())
            for key in [key for key in self._entries if key[0] == resolved]:
                self._entries.pop(key, None)

    @property
    def build_count(self) -> int:
        with self._lock:
            return self._build_count

    @property
    def entry_count(self) -> int:
        with self._lock:
            return len(self._entries)


def accepts_gzip(value: str | None) -> bool:
    if not value:
        return False
    explicit_gzip: bool | None = None
    wildcard = False
    for part in value.split(","):
        tokens = [token.strip() for token in part.split(";")]
        encoding = tokens[0].lower()
        quality = 1.0
        for parameter in tokens[1:]:
            if parameter.lower().startswith("q="):
                try:
                    quality = float(parameter[2:])
                except ValueError:
                    quality = 0.0
        if encoding == "gzip":
            explicit_gzip = quality > 0
        elif encoding == "*" and quality > 0:
            wildcard = True
    return explicit_gzip if explicit_gzip is not None else wildcard


def etag_matches(value: str | None, etag: str) -> bool:
    if not value:
        return False
    normalized_etag = etag.removeprefix("W/")
    for candidate in value.split(","):
        normalized = candidate.strip()
        if normalized == "*" or normalized.removeprefix("W/") == normalized_etag:
            return True
    return False
