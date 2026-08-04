"""Repository paths derived from the backend package location."""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
CONFIG_DIR = PROJECT_ROOT / "backend" / "config" / "broker_app_watch"
DATA_DIR = PROJECT_ROOT / "backend" / "data" / "broker_app_watch"
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
RELEASES_DATA_DIR = PROCESSED_DATA_DIR / "releases"
LLM_DATA_DIR = PROCESSED_DATA_DIR / "llm"
EXPORTS_DATA_DIR = DATA_DIR / "exports"


def project_path(*parts: str) -> Path:
    """Build a path below the project root without using the current directory."""

    return PROJECT_ROOT.joinpath(*parts)
