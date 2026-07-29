"""Fast checks for the project skeleton's critical paths."""

from pathlib import Path

import broker_app_watch
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from broker_app_watch.api.main import app
from broker_app_watch.core.config import load_broker_catalog
from broker_app_watch.core.paths import PROJECT_ROOT, project_path


def test_package_imports() -> None:
    assert broker_app_watch.__version__


def test_project_paths_are_root_relative(monkeypatch: MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.chdir(tmp_path)
    assert project_path("config", "brokers.yaml") == PROJECT_ROOT / "config" / "brokers.yaml"
    assert project_path("config", "brokers.yaml").is_file()
    assert load_broker_catalog().brokers


def test_broker_catalog_loads() -> None:
    catalog = load_broker_catalog()
    assert catalog.brokers
    assert catalog.enabled_sources


def test_health_endpoint() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
