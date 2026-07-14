import pytest

from app.prompts.narration import GEN_SCRIPT_SYSTEM_PROMPT, get_prompt


def test_get_prompt_falls_back_to_default_when_langsmith_unconfigured(monkeypatch):
    """No LANGSMITH_API_KEY -> Client()/pull_prompt fails -> code default."""
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    assert get_prompt("gen_script") == GEN_SCRIPT_SYSTEM_PROMPT


def test_get_prompt_unknown_name_raises():
    with pytest.raises(KeyError):
        get_prompt("nope")


def test_get_prompt_formats_vars_on_default(monkeypatch):
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    out = get_prompt("preference_extract", feedback="fix intro")
    assert "fix intro" in out
