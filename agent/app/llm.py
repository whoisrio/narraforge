"""LLM layer: instructor for structured nodes, raw streaming for gen_script.

Provider-aware (DashScope/Qwen -> JSON mode; MiMo -> MD_JSON + api-key header).
Credentials come from ``AGENT_LLM_*`` env only (see ``app.config``).
"""
from __future__ import annotations

from typing import Awaitable, Callable

import instructor
from instructor import Mode
from openai import AsyncOpenAI

from app.config import get_agent_llm_config


def get_instructor_client() -> tuple[instructor.AsyncInstructor, str]:
    """Build a provider-aware instructor async client.

    Returns ``(client, model)``. DashScope/Qwen (OpenAI-compatible, supports
    ``response_format``) uses ``Mode.JSON``; MiMo (no ``response_format``,
    custom ``api-key`` header) uses ``Mode.MD_JSON``.
    """
    api_key, base_url, model = get_agent_llm_config()
    if "xiaomimimo" in base_url:
        raw = AsyncOpenAI(
            base_url=base_url, api_key=api_key, default_headers={"api-key": api_key}
        )
        mode = Mode.MD_JSON
    else:
        raw = AsyncOpenAI(base_url=base_url, api_key=api_key)
        mode = Mode.JSON
    return instructor.from_openai(raw, mode=mode), model


async def stream_llm(
    messages: list[dict],
    on_chunk: Callable[[str], Awaitable[None]] | None = None,
    *,
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 8192,
    timeout: float = 300.0,
) -> str:
    """Stream a plain-text LLM response; call ``on_chunk`` per token.

    Returns the full accumulated text. Used by the gen_script node for live
    token streaming (the ``messages`` channel forwards these chunks).
    """
    api_key, base_url, default_model = get_agent_llm_config()
    model = model or default_model
    client = AsyncOpenAI(base_url=base_url, api_key=api_key)
    acc = ""
    stream = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
        timeout=timeout,
    )
    async for event in stream:
        if not event.choices:
            continue
        delta = event.choices[0].delta
        content = getattr(delta, "content", None) or ""
        if content:
            acc += content
            if on_chunk is not None:
                await on_chunk(content)
    return acc
