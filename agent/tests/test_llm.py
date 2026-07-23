"""Tests for the LLM layer (langchain-openai ChatOpenAI)."""
import pytest
from langchain_core.messages import AIMessageChunk
from langchain_openai import ChatOpenAI

from app.llm import ReasoningChatOpenAI, _usage_dict, get_chat_model, stream_llm, structured_llm
from app.schemas import Preference


def _set_env(monkeypatch, base_url):
    monkeypatch.setenv("AGENT_LLM_API_KEY", "k")
    monkeypatch.setenv("AGENT_LLM_BASE_URL", base_url)
    monkeypatch.setenv("AGENT_LLM_MODEL", "m1")


DASHSCOPE = "https://dashscope.aliyuncs.com/compatible-mode/v1"
MIMO = "https://api.xiaomimimo.com/v1"


def test_get_chat_model_dashscope(monkeypatch):
    _set_env(monkeypatch, DASHSCOPE)
    m = get_chat_model()
    assert isinstance(m, ChatOpenAI)
    assert isinstance(m, ReasoningChatOpenAI)
    assert m.model_name == "m1"
    assert m.stream_usage is True
    assert not m.default_headers


def test_reasoning_delta_injected_into_additional_kwargs(monkeypatch):
    """Qwen thinking-mode deltas carry reasoning_content; it must survive."""
    _set_env(monkeypatch, DASHSCOPE)
    m = get_chat_model()
    chunk = {
        "id": "chatcmpl-1",
        "choices": [
            {"delta": {"role": "assistant", "reasoning_content": "思考一下"}, "index": 0}
        ],
    }
    gen = m._convert_chunk_to_generation_chunk(chunk, AIMessageChunk, None)
    assert gen is not None
    assert gen.message.additional_kwargs["reasoning_content"] == "思考一下"


def test_usage_dict_includes_reasoning_tokens():
    usage = _usage_dict(
        {
            "input_tokens": 10,
            "output_tokens": 20,
            "total_tokens": 30,
            "output_token_details": {"reasoning": 15},
        }
    )
    assert usage == {
        "input_tokens": 10,
        "output_tokens": 20,
        "total_tokens": 30,
        "reasoning_tokens": 15,
    }


def test_get_chat_model_mimo_carries_api_key_header(monkeypatch):
    _set_env(monkeypatch, MIMO)
    m = get_chat_model()
    assert isinstance(m, ChatOpenAI)
    assert m.default_headers == {"api-key": "k"}


def test_get_chat_model_overrides(monkeypatch):
    _set_env(monkeypatch, DASHSCOPE)
    m = get_chat_model(model="other", temperature=0.9)
    assert m.model_name == "other"
    assert m.temperature == 0.9


class _FakeStreamModel:
    def __init__(self, chunks):
        self._chunks = chunks

    async def astream(self, messages):
        for c in self._chunks:
            yield c


USAGE = {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}


@pytest.mark.asyncio
async def test_structured_llm_parses_streamed_json_and_returns_usage(monkeypatch):
    _set_env(monkeypatch, DASHSCOPE)
    chunks = [
        AIMessageChunk(content='{"preference": "句子要短", '),
        AIMessageChunk(content='"category": "style"}', usage_metadata=USAGE),
    ]
    monkeypatch.setattr("app.llm.get_chat_model", lambda **kw: _FakeStreamModel(chunks))

    parsed, usage = await structured_llm(Preference, [{"role": "user", "content": "x"}])

    assert parsed == Preference(preference="句子要短", category="style")
    assert usage == USAGE


@pytest.mark.asyncio
async def test_structured_llm_tolerates_markdown_fences(monkeypatch):
    _set_env(monkeypatch, MIMO)
    chunks = [
        AIMessageChunk(content='```json\n{"preference": "短句", "category": "style"}\n```'),
    ]
    monkeypatch.setattr("app.llm.get_chat_model", lambda **kw: _FakeStreamModel(chunks))

    parsed, usage = await structured_llm(Preference, [{"role": "user", "content": "x"}])

    assert parsed is not None
    assert parsed.preference == "短句"
    assert usage is None  # provider did not report usage


@pytest.mark.asyncio
async def test_structured_llm_retries_once_then_raises(monkeypatch):
    _set_env(monkeypatch, DASHSCOPE)
    monkeypatch.setattr(
        "app.llm.get_chat_model",
        lambda **kw: _FakeStreamModel([AIMessageChunk(content="不是 JSON")]),
    )

    with pytest.raises(ValueError, match="structured output parse failed"):
        await structured_llm(Preference, [{"role": "user", "content": "x"}])


@pytest.mark.asyncio
async def test_stream_llm_accumulates_text_and_usage(monkeypatch):
    _set_env(monkeypatch, DASHSCOPE)
    chunks = [
        AIMessageChunk(content="hello "),
        AIMessageChunk(content="world", usage_metadata=USAGE),
    ]
    monkeypatch.setattr("app.llm.get_chat_model", lambda **kw: _FakeStreamModel(chunks))

    seen = []

    async def on_chunk(t):
        seen.append(t)

    text, usage = await stream_llm([{"role": "user", "content": "x"}], on_chunk=on_chunk)

    assert text == "hello world"
    assert seen == ["hello ", "world"]
    assert usage == USAGE


@pytest.mark.asyncio
async def test_stream_llm_without_usage_returns_none(monkeypatch):
    _set_env(monkeypatch, DASHSCOPE)
    monkeypatch.setattr(
        "app.llm.get_chat_model",
        lambda **kw: _FakeStreamModel([AIMessageChunk(content="hi")]),
    )
    text, usage = await stream_llm([{"role": "user", "content": "x"}])
    assert text == "hi"
    assert usage is None
