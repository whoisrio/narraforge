"""LLM layer: ChatOpenAI (langchain-openai) for structured + streaming nodes.

Structured output goes through prompt-constrained streaming + JSON
extraction (``structured_llm``) rather than ``with_structured_output``:
langchain-openai routes any ``response_format`` request through the beta
parse stream, which drops ``reasoning_content`` deltas, and Qwen thinking
mode rejects ``tool_choice=required``. Credentials come from ``AGENT_LLM_*``
env only (see ``app.config``).

Usage contract: every helper returns the call's token usage as
``{"input_tokens", "output_tokens", "total_tokens", "reasoning_tokens"?}``
(or ``None`` when the provider does not report it); nodes fold it into the
``stage_complete`` custom event's ``data.usage`` field.

Reasoning contract: ``ReasoningChatOpenAI`` maps the provider's streamed
``reasoning_content`` deltas into ``additional_kwargs`` (stock langchain-openai
deliberately drops them), so thinking-mode providers (Qwen) stream their
thought process over the LangGraph ``messages`` channel for the UI to render.
"""
from __future__ import annotations

import json
import re
from typing import Any, Awaitable, Callable, TypeVar

from langchain_core.messages import AIMessageChunk
from langchain_core.outputs import ChatGenerationChunk
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from app.config import get_agent_llm_config

T = TypeVar("T", bound=BaseModel)


class ReasoningChatOpenAI(ChatOpenAI):
    """ChatOpenAI that preserves streamed ``reasoning_content`` deltas.

    Stock langchain-openai's ``_convert_delta_to_message_chunk`` deliberately
    ignores provider-specific reasoning fields; thinking-mode endpoints
    (Qwen on Aliyun) stream them as ``delta.reasoning_content``. We re-inject
    the delta into ``additional_kwargs`` so it flows through LangGraph's
    ``messages`` channel to the frontend.
    """

    def _convert_chunk_to_generation_chunk(
        self, chunk: dict, default_chunk_class: type, base_generation_info: dict | None
    ) -> ChatGenerationChunk | None:
        generation_chunk = super()._convert_chunk_to_generation_chunk(
            chunk, default_chunk_class, base_generation_info
        )
        choices = chunk.get("choices") or []
        if (
            generation_chunk is not None
            and choices
            and isinstance(generation_chunk.message, AIMessageChunk)
        ):
            reasoning = (choices[0].get("delta") or {}).get("reasoning_content")
            if reasoning:
                generation_chunk.message.additional_kwargs["reasoning_content"] = reasoning
        return generation_chunk


def _is_mimo(base_url: str) -> bool:
    return "xiaomimimo" in base_url


def get_chat_model(**overrides: Any) -> ChatOpenAI:
    """Build a provider-aware ChatOpenAI from ``AGENT_LLM_*`` env config.

    ``stream_usage=True`` so streaming responses also carry token usage on
    the final chunk. MiMo additionally needs the custom ``api-key`` header.
    """
    api_key, base_url, model = get_agent_llm_config()
    kwargs: dict[str, Any] = {
        "model": model,
        "api_key": api_key,
        "base_url": base_url,
        "stream_usage": True,
        "temperature": 0.3,
        "max_tokens": 8192,
        "timeout": 600.0,
        # thinking 模型可能在推理中出现 >120s 的静默间隙，默认的
        # stream_chunk_timeout(120s) 会误杀流；总超时由 timeout 兜底。
        "stream_chunk_timeout": None,
    }
    if _is_mimo(base_url):
        kwargs["default_headers"] = {"api-key": api_key}
    kwargs.update(overrides)
    return ReasoningChatOpenAI(**kwargs)


def _usage_dict(usage_metadata: Any) -> dict | None:
    """Normalize a langchain ``UsageMetadata`` into a plain dict (or None).

    Includes ``reasoning_tokens`` when the provider reports thinking-mode
    reasoning usage (Qwen), so the UI can show how much of the output went
    to the model's thought process.
    """
    if not usage_metadata:
        return None
    usage = {
        "input_tokens": usage_metadata.get("input_tokens", 0),
        "output_tokens": usage_metadata.get("output_tokens", 0),
        "total_tokens": usage_metadata.get("total_tokens", 0),
    }
    details = usage_metadata.get("output_token_details") or {}
    reasoning = details.get("reasoning")
    if reasoning:
        usage["reasoning_tokens"] = reasoning
    return usage


async def structured_llm(
    schema: type[T], messages: list[dict], **overrides: Any
) -> tuple[T, dict | None]:
    """Structured-output call via prompt-constrained streaming + JSON parse.

    Deliberately NOT ``with_structured_output``: langchain-openai routes any
    ``response_format`` request through the beta parse stream, which drops
    ``reasoning_content`` deltas (and Qwen thinking mode rejects the
    ``tool_choice=required`` that function calling sets). Prompts already
    demand JSON-only output (as did instructor's MD_JSON mode), so we stream
    plainly -- reasoning flows over the messages channel -- then extract and
    validate the JSON. One retry on validation failure (mirrors instructor's
    old max_retries).
    """
    model = get_chat_model(**overrides)
    for _attempt in range(2):
        acc = ""
        usage: dict | None = None
        async for chunk in model.astream(messages):
            if isinstance(chunk.content, str):
                acc += chunk.content
            if chunk.usage_metadata:
                usage = _usage_dict(chunk.usage_metadata)
        parsed = _parse_structured(acc, schema)
        if parsed is not None:
            return parsed, usage
    raise ValueError(
        f"structured output parse failed for {schema.__name__}: "
        "LLM output did not validate against the schema"
    )


def _parse_structured(text: str, schema: type[T]) -> T | None:
    """Extract the outermost JSON object from LLM output and validate it.

    Tolerates markdown fences (```json ... ```) and stray prose around the
    object; returns ``None`` when extraction or schema validation fails.
    """
    candidate = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", candidate, re.DOTALL)
    if fence:
        candidate = fence.group(1)
    else:
        start, end = candidate.find("{"), candidate.rfind("}")
        if start == -1 or end <= start:
            return None
        candidate = candidate[start : end + 1]
    try:
        return schema.model_validate(json.loads(candidate))
    except (json.JSONDecodeError, ValueError):
        return None


async def stream_llm(
    messages: list[dict],
    on_chunk: Callable[[str], Awaitable[None]] | None = None,
    *,
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 8192,
    timeout: float = 600.0,
) -> tuple[str, dict | None]:
    """Stream a plain-text LLM response; call ``on_chunk`` per token.

    Returns ``(full_text, usage)`` -- usage comes from the final chunk's
    ``usage_metadata`` (``stream_usage=True``). The LangGraph ``messages``
    channel forwards the streamed tokens to the frontend automatically.
    """
    overrides: dict[str, Any] = {"temperature": temperature, "max_tokens": max_tokens, "timeout": timeout}
    if model:
        overrides["model"] = model
    chat = get_chat_model(**overrides)
    acc = ""
    usage: dict | None = None
    async for chunk in chat.astream(messages):
        text = chunk.text
        if text:
            acc += text
            if on_chunk is not None:
                await on_chunk(text)
        if chunk.usage_metadata:
            usage = _usage_dict(chunk.usage_metadata)
    return acc, usage
