"""Tests for the extracted LLM client helpers."""
from unittest.mock import patch, MagicMock
import pytest


def test_extract_json_array_pure_json():
    from app.services.llm_client import extract_json_array
    result = extract_json_array('[{"x": 1}, {"x": 2}]')
    assert result == '[{"x": 1}, {"x": 2}]'


def test_extract_json_array_markdown_block():
    from app.services.llm_client import extract_json_array
    raw = '```json\n[{"index": 1}]\n```'
    result = extract_json_array(raw)
    assert result == '[{"index": 1}]'


def test_extract_json_array_with_surrounding_text():
    from app.services.llm_client import extract_json_array
    raw = 'Here is the result:\n[{"index": 1}]\nDone.'
    result = extract_json_array(raw)
    assert result == '[{"index": 1}]'


def test_extract_json_array_returns_none_on_invalid():
    from app.services.llm_client import extract_json_array
    assert extract_json_array('not json at all') is None
    assert extract_json_array('') is None
    assert extract_json_array(None) is None


def test_get_llm_config_raises_when_no_key():
    """When neither LLM nor MiMo api_key is configured, should raise."""
    from app.core.config import settings
    from app.services.llm_client import get_llm_config

    original_llm = settings.llm_api_key
    original_mimo = settings.mimo_api_key
    try:
        settings.llm_api_key = ""
        settings.mimo_api_key = ""
        with pytest.raises(ValueError, match="LLM API Key 未配置"):
            get_llm_config()
    finally:
        settings.llm_api_key = original_llm
        settings.mimo_api_key = original_mimo


def test_get_llm_config_uses_env_fallback_to_mimo():
    """When LLM not configured but MiMo is, use MiMo."""
    from app.core.config import settings
    from app.services.llm_client import get_llm_config

    originals = (settings.llm_api_key, settings.llm_base_url, settings.mimo_api_key, settings.mimo_base_url)
    try:
        settings.llm_api_key = ""
        settings.llm_base_url = ""
        settings.mimo_api_key = "mk_test"
        settings.mimo_base_url = "https://mimo.example.com/v1/"
        key, base, model = get_llm_config()
        assert key == "mk_test"
        assert base == "https://mimo.example.com/v1"  # rstripped
    finally:
        settings.llm_api_key, settings.llm_base_url, settings.mimo_api_key, settings.mimo_base_url = originals


def test_call_llm_success(monkeypatch):
    """call_llm parses choices[0].message.content."""
    from app.services import llm_client

    fake_response = {
        "choices": [{"message": {"content": "hello world", "reasoning_content": ""}, "finish_reason": "stop"}],
        "usage": {"completion_tokens": 5},
    }

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def read(self): return __import__('json').dumps(fake_response).encode()

    monkeypatch.setattr(llm_client, "get_llm_config", lambda db=None: ("k", "https://api.example.com/v1", "test-model"))
    monkeypatch.setattr(llm_client.urllib.request, "urlopen", lambda *a, **kw: FakeResp())

    result = llm_client.call_llm([{"role": "user", "content": "hi"}])
    assert result == "hello world"


def test_call_llm_raises_on_token_exhaustion(monkeypatch):
    """When content empty but reasoning present → raises about token exhaustion."""
    from app.services import llm_client

    fake_response = {
        "choices": [{"message": {"content": "", "reasoning_content": "thinking..."}, "finish_reason": "length"}],
        "usage": {"completion_tokens_details": {"reasoning_tokens": 8000}},
    }

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def read(self): return __import__('json').dumps(fake_response).encode()

    monkeypatch.setattr(llm_client, "get_llm_config", lambda db=None: ("k", "https://api.example.com/v1", "m"))
    monkeypatch.setattr(llm_client.urllib.request, "urlopen", lambda *a, **kw: FakeResp())

    with pytest.raises(RuntimeError, match="token"):
        llm_client.call_llm([{"role": "user", "content": "hi"}])
