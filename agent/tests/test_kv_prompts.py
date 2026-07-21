import pytest

from app.prompts import knowledge_video
from app.prompts.knowledge_video import KV_GEN_NARRATION_SYSTEM_PROMPT, get_prompt


def test_kv_get_prompt_falls_back_to_default(monkeypatch):
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    assert get_prompt("kv_gen_narration") == KV_GEN_NARRATION_SYSTEM_PROMPT


def test_kv_get_prompt_unknown_name_raises():
    with pytest.raises(KeyError):
        get_prompt("nope")


def test_narration_get_prompt_still_works_after_refactor(monkeypatch):
    """narration.get_prompt 公共 API 在 loader 抽取后保持不变。"""
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    from app.prompts.narration import GEN_SCRIPT_SYSTEM_PROMPT
    from app.prompts import narration

    assert narration.get_prompt("gen_script") == GEN_SCRIPT_SYSTEM_PROMPT
    out = narration.get_prompt("preference_extract", feedback="fix intro")
    assert "fix intro" in out
