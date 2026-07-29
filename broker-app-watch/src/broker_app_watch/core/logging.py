"""Minimal application logging configuration."""

import logging
from pathlib import Path


def configure_logging(level: str = "INFO", log_file: Path | None = None) -> None:
    """Configure console logging and an optional UTF-8 file handler."""

    handlers: list[logging.Handler] = [logging.StreamHandler()]
    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))

    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=handlers,
        force=True,
    )
