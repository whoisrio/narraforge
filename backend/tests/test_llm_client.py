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


# ---------------------------------------------------------------------------
# extract_json_object
# ---------------------------------------------------------------------------

def test_extract_json_object_pure():
    from app.services.llm_client import extract_json_object
    assert extract_json_object('{"x": 1}') == '{"x": 1}'


def test_extract_json_object_markdown_block():
    from app.services.llm_client import extract_json_object
    raw = '```json\n{"index": 1}\n```'
    assert extract_json_object(raw) == '{"index": 1}'


def test_extract_json_object_with_surrounding_text():
    from app.services.llm_client import extract_json_object
    raw = 'result: {"a": 2} done.'
    assert extract_json_object(raw) == '{"a": 2}'


def test_extract_json_object_returns_none_on_invalid():
    from app.services.llm_client import extract_json_object
    assert extract_json_object('not json') is None
    assert extract_json_object('') is None
    assert extract_json_object(None) is None


# ---------------------------------------------------------------------------
# _supports_response_format
# ---------------------------------------------------------------------------

def test_supports_response_format_qwen():
    from app.services.llm_client import _supports_response_format
    assert _supports_response_format("https://dashscope.aliyuncs.com/compatible-mode/v1") is True


def test_supports_response_format_mimo():
    from app.services.llm_client import _supports_response_format
    assert _supports_response_format("https://api.xiaomimimo.com/v1") is False


def test_supports_response_format_unknown_defaults_false():
    from app.services.llm_client import _supports_response_format
    assert _supports_response_format("https://random.example.com/v1") is False


# ---------------------------------------------------------------------------
# call_llm_structured
# ---------------------------------------------------------------------------
from pydantic import BaseModel as _BM


class _SampleItem(_BM):
    name: str
    score: int


class _SampleResp(_BM):
    items: list[_SampleItem]


def test_call_llm_structured_success(monkeypatch):
    """LLM 一次返回合法 JSON → 直接通过校验。"""
    from app.services import llm_client

    monkeypatch.setattr(llm_client, "get_llm_config",
                        lambda db=None: ("k", "https://random.example.com/v1", "m"))

    calls = []

    def fake_call_llm(messages, **kw):
        calls.append((messages, kw))
        return '{"items": [{"name": "a", "score": 1}]}'

    monkeypatch.setattr(llm_client, "call_llm", fake_call_llm)

    result = llm_client.call_llm_structured(
        [{"role": "user", "content": "go"}],
        schema=_SampleResp,
    )
    assert isinstance(result, _SampleResp)
    assert result.items[0].name == "a"
    assert len(calls) == 1
    # response_format 默认按 base_url 自动决定；unknown provider → 不带
    assert calls[0][1].get("response_format") is None
    # schema 应被注入到 system message
    sent = calls[0][0]
    assert sent[0]["role"] == "system"
    assert "JSON Schema" in sent[0]["content"]


def test_call_llm_structured_qwen_uses_response_format(monkeypatch):
    """Qwen base_url → 自动带 response_format=json_object。"""
    from app.services import llm_client

    monkeypatch.setattr(llm_client, "get_llm_config",
                        lambda db=None: ("k", "https://dashscope.aliyuncs.com/v1", "m"))

    captured = {}

    def fake_call_llm(messages, **kw):
        captured.update(kw)
        return '{"items": []}'

    monkeypatch.setattr(llm_client, "call_llm", fake_call_llm)
    llm_client.call_llm_structured(
        [{"role": "user", "content": "go"}], schema=_SampleResp,
    )
    assert captured["response_format"] == {"type": "json_object"}


def test_call_llm_structured_retries_on_validation_fail(monkeypatch):
    """首次返回缺字段 → 重试一次，第二次合法。"""
    from app.services import llm_client

    monkeypatch.setattr(llm_client, "get_llm_config",
                        lambda db=None: ("k", "https://random.example.com/v1", "m"))

    responses = iter([
        '{"items": [{"name": "a"}]}',                       # 缺 score → 校验失败
        '{"items": [{"name": "a", "score": 7}]}',           # 合法
    ])
    sent_messages = []

    def fake_call_llm(messages, **kw):
        sent_messages.append(messages)
        return next(responses)

    monkeypatch.setattr(llm_client, "call_llm", fake_call_llm)
    result = llm_client.call_llm_structured(
        [{"role": "user", "content": "go"}], schema=_SampleResp, max_retries=2,
    )
    assert result.items[0].score == 7
    assert len(sent_messages) == 2
    # 第二轮应该带上修正反馈（assistant 上一轮返回 + user 错误说明）
    second = sent_messages[1]
    roles = [m["role"] for m in second]
    assert "assistant" in roles
    assert roles.count("user") >= 2


def test_call_llm_structured_raises_after_retries(monkeypatch):
    """多次都不合法 → 抛 LLMValidationError，含 last_raw。"""
    from app.services import llm_client

    monkeypatch.setattr(llm_client, "get_llm_config",
                        lambda db=None: ("k", "https://random.example.com/v1", "m"))
    monkeypatch.setattr(llm_client, "call_llm",
                        lambda *a, **kw: '{"items": [{"name": "a"}]}')

    with pytest.raises(llm_client.LLMValidationError) as exc_info:
        llm_client.call_llm_structured(
            [{"role": "user", "content": "go"}], schema=_SampleResp, max_retries=1,
        )
    assert exc_info.value.last_raw == '{"items": [{"name": "a"}]}'


def test_call_llm_structured_explicit_response_format_override(monkeypatch):
    """use_response_format=False 应覆盖 provider 自动判断（即使是 Qwen）。"""
    from app.services import llm_client

    monkeypatch.setattr(llm_client, "get_llm_config",
                        lambda db=None: ("k", "https://dashscope.aliyuncs.com/v1", "m"))

    captured = {}

    def fake_call_llm(messages, **kw):
        captured.update(kw)
        return '{"items": []}'

    monkeypatch.setattr(llm_client, "call_llm", fake_call_llm)
    llm_client.call_llm_structured(
        [{"role": "user", "content": "go"}], schema=_SampleResp,
        use_response_format=False,
    )
    assert captured["response_format"] is None


def test_call_llm_structured_strips_markdown_fence(monkeypatch):
    """带 ```json ... ``` 包裹的返回应能解析。"""
    from app.services import llm_client

    monkeypatch.setattr(llm_client, "get_llm_config",
                        lambda db=None: ("k", "https://random.example.com/v1", "m"))
    monkeypatch.setattr(llm_client, "call_llm",
                        lambda *a, **kw: '```json\n{"items": [{"name": "a", "score": 1}]}\n```')

    result = llm_client.call_llm_structured(
        [{"role": "user", "content": "go"}], schema=_SampleResp,
    )
    assert result.items[0].name == "a"
