from __future__ import annotations

import csv
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, status

from .config import settings


def read_announcement_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as file:
            reader = csv.DictReader(file)
            return list(reader.fieldnames or []), list(reader)
    except csv.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to parse announcement CSV",
        ) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to read announcement data",
        ) from exc


def count_csv_records(path: Path) -> int:
    if not path.exists():
        return 0
    _, records = read_announcement_csv(path)
    return sum(any(str(value or "").strip() for value in row.values()) for row in records)


def publish_csv_atomically(
    fieldnames: list[str],
    records: list[dict[str, str]],
    target_path: Path,
) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.with_name(
        f".{target_path.stem}.{os.getpid()}.publish.tmp{target_path.suffix}"
    )
    try:
        with temp_path.open("w", encoding="utf-8-sig", newline="") as temp_file:
            writer = csv.DictWriter(temp_file, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(records)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_path, target_path)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to publish announcement CSV",
        ) from exc
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def backup_csv_atomically(target_path: Path) -> str | None:
    if not target_path.exists():
        return None

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = target_path.with_name(f"{target_path.stem}-{timestamp}.backup{target_path.suffix}")
    temp_path = target_path.with_name(
        f".{target_path.stem}.{os.getpid()}.backup.tmp{target_path.suffix}"
    )
    try:
        with target_path.open("rb") as source, temp_path.open("wb") as temp_file:
            shutil.copyfileobj(source, temp_file)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_path, backup_path)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="failed to backup announcement CSV",
        ) from exc
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass
    return backup_path.name


def announcement_backup_retention() -> int:
    return settings.announcement_backup_retention


def prune_old_announcement_backups(
    target_path: Path,
    retention: int | None = None,
) -> list[str]:
    keep_count = retention if retention is not None else announcement_backup_retention()
    pattern = re.compile(
        rf"^{re.escape(target_path.stem)}-(\d{{8}}-\d{{6}})"
        rf"\.backup{re.escape(target_path.suffix)}$"
    )
    candidates: list[tuple[datetime, Path]] = []
    try:
        directory_entries = list(target_path.parent.iterdir())
    except OSError:
        return []

    for path in directory_entries:
        if not path.is_file():
            continue
        match = pattern.fullmatch(path.name)
        if match is None:
            continue
        try:
            timestamp = datetime.strptime(match.group(1), "%Y%m%d-%H%M%S")
        except ValueError:
            continue
        candidates.append((timestamp, path))

    candidates.sort(key=lambda item: (item[0], item[1].name), reverse=True)
    removed: list[str] = []
    for _, path in candidates[max(0, keep_count) :]:
        try:
            path.unlink()
        except OSError:
            print("Warning: failed to prune an old announcement backup.")
        else:
            removed.append(path.name)
    return removed
