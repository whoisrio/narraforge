"""Shared LangSmith-first prompt loader factory.

Each prompt module builds its own ``get_prompt`` via ``make_get_prompt``:
LangSmith prompt hub is tried first (hot-reload); any failure (missing
``LANGSMITH_API_KEY``, unpublished prompt, network error) falls back to the
code-default constant.
"""
from __future__ import annotations

from langsmith import Client
from langsmith.client import convert_prompt_to_openai_format


def make_get_prompt(defaults: dict[str, str], langsmith_names: dict[str, str]):
    client = None

    def get_prompt(name: str, **vars) -> str:
        if name not in defaults:
            raise KeyError(name)
        default = defaults[name]
        ls_name = langsmith_names.get(name)
        if ls_name:
            try:
                nonlocal client
                if client is None:
                    client = Client()  # reads LANGSMITH_API_KEY; may raise if absent
                pt = client.pull_prompt(ls_name)
                msgs = convert_prompt_to_openai_format(pt.invoke(vars))
                for m in msgs:
                    if m.get("role") == "system" and m.get("content"):
                        return m["content"]
                if msgs and msgs[0].get("content"):
                    return msgs[0]["content"]
            except Exception:
                pass  # fall through to code default
        return default.format(**vars) if vars else default

    return get_prompt
