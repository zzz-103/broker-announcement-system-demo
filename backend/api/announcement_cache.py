from __future__ import annotations

import gzip
import hashlib
import json
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


CsvLoader = Callable[[Path], tuple[list[str], list[dict[str, str]]]]


@dataclass(frozen=True, slots=True)
class CachedAnnouncementResponse:
    version: tuple[str, int, int]
    raw_body: bytes
    gzip_body: bytes
    etag: str


class AnnouncementResponseCache:
    """Single-process cache for the published dashboard CSV response."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entry: CachedAnnouncementResponse | None = None
        self._build_count = 0

    @staticmethod
    def _version(path: Path) -> tuple[str, int, int]:
        stat_result = path.stat()
        return (str(path.resolve()), stat_result.st_mtime_ns, stat_result.st_size)

    def get(self, path: Path, loader: CsvLoader) -> CachedAnnouncementResponse:
        version = self._version(path)
        entry = self._entry
        if entry is not None and entry.version == version:
            return entry

        with self._lock:
            version = self._version(path)
            entry = self._entry
            if entry is not None and entry.version == version:
                return entry

            for _ in range(2):
                _, records = loader(path)
                final_version = self._version(path)
                if final_version == version:
                    break
                version = final_version
            else:  # pragma: no cover - requires continuous external replacement
                _, records = loader(path)
                final_version = self._version(path)

            updated_at = datetime.fromtimestamp(
                final_version[1] / 1_000_000_000,
                timezone.utc,
            ).isoformat()
            payload = {
                "records": records,
                "meta": {
                    "count": len(records),
                    "updated_at": updated_at,
                },
            }
            raw_body = json.dumps(
                payload,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
            digest = hashlib.sha256(raw_body).hexdigest()
            entry = CachedAnnouncementResponse(
                version=final_version,
                raw_body=raw_body,
                gzip_body=gzip.compress(raw_body, compresslevel=3, mtime=0),
                etag=f'W/"{digest}"',
            )
            self._entry = entry
            self._build_count += 1
            return entry

    def invalidate(self, path: Path | None = None) -> None:
        with self._lock:
            if path is None or self._entry is None:
                self._entry = None
                return
            if self._entry.version[0] == str(path.resolve()):
                self._entry = None

    @property
    def build_count(self) -> int:
        with self._lock:
            return self._build_count


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
