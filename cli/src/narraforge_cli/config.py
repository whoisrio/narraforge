"""CLI configuration resolved from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_API_URL = "http://127.0.0.1:8002"


@dataclass(frozen=True)
class Config:
    """Backend connection settings."""

    api_url: str
    token: str | None


def load_config(api_url_override: str | None = None) -> Config:
    """Resolve the backend URL (`--api-url` > env > default) and optional bearer token."""
    url = api_url_override or os.environ.get("NARRAFORGE_API_URL") or DEFAULT_API_URL
    return Config(
        api_url=url.rstrip("/"),
        token=os.environ.get("NARRAFORGE_API_TOKEN") or None,
    )
