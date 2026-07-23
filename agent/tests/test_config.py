import pytest
from app.config import (
    get_agent_llm_config,
    get_animation_root_folder,
    get_backend_url,
    get_voxcpm_default_role_id,
)


def test_get_backend_url_default(monkeypatch):
    monkeypatch.delenv("BACKEND_API_URL", raising=False)
    assert get_backend_url() == "http://127.0.0.1:8002"


def test_get_backend_url_from_env(monkeypatch):
    monkeypatch.setenv("BACKEND_API_URL", "http://example:9999")
    assert get_backend_url() == "http://example:9999"


def test_get_agent_llm_config_reads_env(monkeypatch):
    monkeypatch.setenv("AGENT_LLM_API_KEY", "k1")
    monkeypatch.setenv("AGENT_LLM_BASE_URL", "http://dashscope")
    monkeypatch.setenv("AGENT_LLM_MODEL", "qwen-plus")
    key, base, model = get_agent_llm_config()
    assert key == "k1" and base == "http://dashscope" and model == "qwen-plus"


def test_get_agent_llm_config_missing_raises(monkeypatch):
    monkeypatch.delenv("AGENT_LLM_API_KEY", raising=False)
    monkeypatch.delenv("AGENT_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("AGENT_LLM_MODEL", raising=False)
    with pytest.raises(ValueError):
        get_agent_llm_config()


def test_animation_root_folder_reads_env(monkeypatch):
    monkeypatch.setenv("ANIMATION_ROOT_FOLDER", "/tmp/remotion-root")
    assert get_animation_root_folder() == "/tmp/remotion-root"


def test_animation_root_folder_missing_raises(monkeypatch):
    monkeypatch.delenv("ANIMATION_ROOT_FOLDER", raising=False)
    with pytest.raises(ValueError):
        get_animation_root_folder()


def test_animation_root_folder_blank_raises(monkeypatch):
    monkeypatch.setenv("ANIMATION_ROOT_FOLDER", "   ")
    with pytest.raises(ValueError):
        get_animation_root_folder()


def test_voxcpm_default_role_id_returns_none_when_unset(monkeypatch):
    monkeypatch.delenv("VOXCPM_DEFAULT_ROLE_ID", raising=False)
    assert get_voxcpm_default_role_id() is None


def test_voxcpm_default_role_id_returns_value(monkeypatch):
    monkeypatch.setenv("VOXCPM_DEFAULT_ROLE_ID", "role-abc")
    assert get_voxcpm_default_role_id() == "role-abc"


def test_voxcpm_default_role_id_blank_treated_as_none(monkeypatch):
    monkeypatch.setenv("VOXCPM_DEFAULT_ROLE_ID", "   ")
    assert get_voxcpm_default_role_id() is None
