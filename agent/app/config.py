"""Agent configuration - reads env vars for backend URL + LLM credentials."""
from __future__ import annotations

import os


def get_backend_url() -> str:
    """Return the NarraForge backend base URL (default localhost:8002)."""
    return os.getenv("BACKEND_API_URL", "http://127.0.0.1:8002").rstrip("/")


def get_agent_llm_config() -> tuple[str, str, str]:
    """Return ``(api_key, base_url, model)`` for the agent LLM.

    Reads only ``AGENT_LLM_*`` env vars. Raises ``ValueError`` if any are
    missing -- there is no multi-layer fallback (the agent uses its own
    dedicated config, distinct from the backend's llm_*/mimo_*).
    """
    api_key = os.getenv("AGENT_LLM_API_KEY")
    base_url = (os.getenv("AGENT_LLM_BASE_URL") or "").rstrip("/")
    model = os.getenv("AGENT_LLM_MODEL")
    if not api_key or not base_url or not model:
        raise ValueError(
            "AGENT_LLM_API_KEY / AGENT_LLM_BASE_URL / AGENT_LLM_MODEL must all "
            "be set in agent/.env"
        )
    return api_key, base_url, model
