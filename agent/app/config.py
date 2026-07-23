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


def get_animation_root_folder() -> str:
    """Return the root directory for scaffolded Remotion projects.

    Reads ``ANIMATION_ROOT_FOLDER``. Every knowledge_video run's Remotion
    project is materialised at ``{ANIMATION_ROOT_FOLDER}/{safe_project_name}``.
    Raises ``ValueError`` when unset (the scaffold node halts the workflow
    so runs never silently fall back to some ad-hoc default).
    """
    value = (os.getenv("ANIMATION_ROOT_FOLDER") or "").strip()
    if not value:
        raise ValueError(
            "ANIMATION_ROOT_FOLDER must be set in agent/.env (root dir for "
            "scaffolded Remotion projects)"
        )
    return value


def get_voxcpm_default_role_id() -> str | None:
    """Return the default VoxCPM clone role id, or ``None`` when unset.

    kv-synthesis uses this when the selected engine is ``voxcpm`` (no other
    default is meaningful for cloned voices). ``None`` -> synthesis halts.
    """
    value = (os.getenv("VOXCPM_DEFAULT_ROLE_ID") or "").strip()
    return value or None
