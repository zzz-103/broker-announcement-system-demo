"""Project paths derived from the installed source location."""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]
CONFIG_DIR = PROJECT_ROOT / "config"
DATA_DIR = PROJECT_ROOT / "data"
RAW_DATA_DIR = DATA_DIR / "raw"
PROCESSED_DATA_DIR = DATA_DIR / "processed"
RELEASES_DATA_DIR = PROCESSED_DATA_DIR / "releases"
LLM_DATA_DIR = PROCESSED_DATA_DIR / "llm"
EXPORTS_DATA_DIR = DATA_DIR / "exports"
LOGS_DIR = PROJECT_ROOT / "logs"


def project_path(*parts: str) -> Path:
    """Build a path below the project root without using the current directory."""

    return PROJECT_ROOT.joinpath(*parts)
