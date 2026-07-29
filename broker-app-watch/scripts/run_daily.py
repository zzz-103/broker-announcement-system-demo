"""Thin daily entry point; business logic remains inside the package."""

from broker_app_watch.cli import main


if __name__ == "__main__":
    raise SystemExit(main(["dry-run"]))
