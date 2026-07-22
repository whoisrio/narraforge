"""Runtime configuration for narration versioning.

Values are read from environment variables. Kept in a module (not
app.core.config.Settings) so tests can monkeypatch cleanly without
touching global settings, and so the feature can be disabled via env
without a schema change.
"""
from __future__ import annotations

import os
from pathlib import Path


def repo_path() -> Path:
    """Absolute path to the narration meta-repo.

    Default: `<repo-root>/backend/data/narration-repo/`.
    """
    default = Path(__file__).resolve().parents[4] / "backend" / "data" / "narration-repo"
    return Path(os.getenv("NARRATION_REPO_PATH", str(default))).expanduser().resolve()


def snapshot_enabled() -> bool:
    return os.getenv("NARRATION_SNAPSHOT_ENABLED", "1").lower() not in ("0", "false", "no", "")


def snapshot_cron() -> str:
    """APScheduler CronTrigger string. Default: every day at 03:00 local time."""
    return os.getenv("NARRATION_SNAPSHOT_CRON", "0 3 * * *")


def author_name() -> str:
    return os.getenv("NARRATION_GIT_AUTHOR_NAME", "NarraForge Bot")


def author_email() -> str:
    return os.getenv("NARRATION_GIT_AUTHOR_EMAIL", "bot@narraforge.local")
