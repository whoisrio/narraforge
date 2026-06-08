"""Tests for text_split_service."""
import pytest


# ------- rule_split -------

def test_rule_split_all_delimiters():
    from app.services.text_split_service import rule_split
    text = "你好，世界。今天是个好日子！我们一起出去玩？"
    result = rule_split(text, ["，", "。", "！", "？"])
    assert result == ["你好，", "世界。", "今天是个好日子！", "我们一起出去玩？"]


def test_rule_split_only_period():
    from app.services.text_split_service import rule_split
    text = "你好，世界。今天好。"
    result = rule_split(text, ["。"])
    assert result == ["你好，世界。", "今天好。"]


def test_rule_split_no_delimiter_returns_single():
    from app.services.text_split_service import rule_split
    result = rule_split("一段没有标点的文字", [])
    assert result == ["一段没有标点的文字"]


def test_rule_split_filters_empty_and_pure_punct():
    from app.services.text_split_service import rule_split
    text = "你好。。。世界。"
    result = rule_split(text, ["。"])
    # 连续 "。" 产生的空段 / 纯标点段被过滤
    assert result == ["你好。", "世界。"]


def test_rule_split_strips_whitespace_around_segments():
    from app.services.text_split_service import rule_split
    text = "  你好。  世界。  "
    result = rule_split(text, ["。"])
    assert result == ["你好。", "世界。"]


def test_rule_split_handles_leading_punct():
    from app.services.text_split_service import rule_split
    text = "。开头是标点。"
    result = rule_split(text, ["。"])
    assert result == ["开头是标点。"]


def test_rule_split_mixed_chinese_english():
    from app.services.text_split_service import rule_split
    text = "Hello world，今天 weather is good。"
    result = rule_split(text, ["，", "。"])
    assert result == ["Hello world，", "今天 weather is good。"]


def test_rule_split_empty_text_returns_empty_list():
    from app.services.text_split_service import rule_split
    assert rule_split("", ["，", "。"]) == []
    assert rule_split("   ", ["，", "。"]) == []


# ------- llm_split -------


def _make_split_response(segments: list[dict]) -> object:
    """快速构造 _SplitResponse 以便 monkeypatch 直接返回。"""
    from app.services.text_split_service import _SplitResponse
    return _SplitResponse(segments=segments)


def test_llm_split_returns_segments(monkeypatch):
    from app.services import text_split_service
    fake_resp = _make_split_response([
        {"text": "你好，", "reason": "招呼", "emotion": "neutral"},
        {"text": "再见。", "reason": "告别", "emotion": "neutral"},
    ])
    monkeypatch.setattr(text_split_service, "call_llm_structured",
                        lambda *a, **kw: fake_resp)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "test-model"))

    result = text_split_service.llm_split("你好，再见。")
    assert result.model == "test-model"
    assert [s["text"] for s in result.segments] == ["你好，", "再见。"]
    assert result.segments[0]["reason"] == "招呼"


def test_llm_split_empty_after_filter_raises(monkeypatch):
    """LLM 返回全部为空段 → raise ValueError。"""
    from app.services import text_split_service
    fake_resp = _make_split_response([
        {"text": "", "reason": "", "emotion": "neutral"},
        {"text": "  ", "reason": "", "emotion": "neutral"},
    ])
    monkeypatch.setattr(text_split_service, "call_llm_structured",
                        lambda *a, **kw: fake_resp)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    with pytest.raises(ValueError, match="空的拆分"):
        text_split_service.llm_split("你好")


def test_llm_split_raises_on_empty_text():
    from app.services.text_split_service import llm_split
    with pytest.raises(ValueError, match="文本"):
        llm_split("")
    with pytest.raises(ValueError, match="文本"):
        llm_split("   ")


# ------- ssml_annotate -------


def _make_ssml_response(annotations: list[dict]) -> object:
    from app.services.text_split_service import _SSMLAnnotateResponse
    return _SSMLAnnotateResponse(annotations=annotations)


def test_ssml_annotate_basic(monkeypatch):
    from app.services import text_split_service
    fake_resp = _make_ssml_response([
        {"text": "你好世界",
         "ssml": '<speak>你好<break time="200ms"/>世界</speak>',
         "rationale": "在停顿点加 break"},
    ])
    monkeypatch.setattr(text_split_service, "call_llm_structured",
                        lambda *a, **kw: fake_resp)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    result = text_split_service.ssml_annotate(["你好世界"])
    assert len(result.annotations) == 1
    assert result.annotations[0]["ssml"] == '<speak>你好<break time="200ms"/>世界</speak>'
    assert result.annotations[0]["rationale"] == "在停顿点加 break"


def test_ssml_annotate_strips_non_whitelist_tags(monkeypatch):
    """非白名单标签 (<unknown>) 应被剥除，保留纯文本。"""
    from app.services import text_split_service
    fake_resp = _make_ssml_response([
        {"text": "你好",
         "ssml": "<speak><unknown>你好</unknown></speak>",
         "rationale": "x"},
    ])
    monkeypatch.setattr(text_split_service, "call_llm_structured",
                        lambda *a, **kw: fake_resp)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    result = text_split_service.ssml_annotate(["你好"])
    # <unknown> 剥除后 = "<speak>你好</speak>"
    assert result.annotations[0]["ssml"] == "<speak>你好</speak>"


def test_ssml_annotate_falls_back_when_text_modified(monkeypatch):
    """LLM 修改了原文 → 退化为 <speak>原文</speak>。"""
    from app.services import text_split_service
    fake_resp = _make_ssml_response([
        {"text": "你好",
         "ssml": "<speak>你好啊朋友</speak>",
         "rationale": "x"},
    ])
    monkeypatch.setattr(text_split_service, "call_llm_structured",
                        lambda *a, **kw: fake_resp)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    result = text_split_service.ssml_annotate(["你好"])
    assert result.annotations[0]["ssml"] == "<speak>你好</speak>"


def test_ssml_annotate_style_hint_in_prompt(monkeypatch):
    """style_hint 必须传到 prompt 里。"""
    from app.services import text_split_service
    captured = {}

    def fake_structured(messages, **kw):
        captured["prompt"] = messages[0]["content"]
        return _make_ssml_response([{"text": "x", "ssml": "<speak>x</speak>", "rationale": ""}])

    monkeypatch.setattr(text_split_service, "call_llm_structured", fake_structured)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    text_split_service.ssml_annotate(["x"], style_hint="播音腔")
    assert "播音腔" in captured["prompt"]


def test_ssml_annotate_empty_texts_raises():
    from app.services.text_split_service import ssml_annotate
    with pytest.raises(ValueError, match="texts"):
        ssml_annotate([])


def test_ssml_annotate_allows_whitelisted_tags(monkeypatch):
    from app.services import text_split_service
    fake_resp = _make_ssml_response([
        {"text": "你好",
         "ssml": '<speak><prosody rate="slow"><emphasis level="strong">你好</emphasis></prosody></speak>',
         "rationale": "x"},
    ])
    monkeypatch.setattr(text_split_service, "call_llm_structured",
                        lambda *a, **kw: fake_resp)
    monkeypatch.setattr(text_split_service, "get_llm_config",
                        lambda db=None: ("k", "u", "m"))

    result = text_split_service.ssml_annotate(["你好"])
    assert "<prosody" in result.annotations[0]["ssml"]
    assert "<emphasis" in result.annotations[0]["ssml"]