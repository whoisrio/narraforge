import pytest
from app.config import get_agent_llm_config, get_backend_url


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
