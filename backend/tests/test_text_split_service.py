"""Tests for text_split_service."""
import pytest


# ------- rule_split -------

def test_rule_split_all_delimiters():
    from app.services.text_split_service import rule_split
    text = "你好，世界。今天是个好日子！我们一起出去玩？"
    # "你好，"(3<5) 下一段 "世界。"(3<15) → 合并为 "你好，世界。"(6)
    # 合并后长度 6 不小于 5，不再吸并后续段
    result = rule_split(text, ["，", "。", "！", "？"])
    assert result == ["你好，世界。", "今天是个好日子！", "我们一起出去玩？"]


def test_rule_split_only_period():
    from app.services.text_split_service import rule_split
    text = "你好，世界。今天好。"
    # 仅按。切：["你好，世界。"(6), "今天好。"(4)]，首段>=5 不触发合并
    result = rule_split(text, ["。"])
    assert result == ["你好，世界。", "今天好。"]


def test_rule_split_no_delimiter_returns_single():
    from app.services.text_split_service import rule_split
    result = rule_split("一段没有标点的文字", [])
    assert result == ["一段没有标点的文字"]


def test_rule_split_filters_empty_and_pure_punct():
    from app.services.text_split_service import rule_split
    text = "你好。。。世界。"
    # 先过滤得 ["你好。", "世界。"]，两段都 < 5 且下一段 < 15，合并
    result = rule_split(text, ["。"])
    assert result == ["你好。世界。"]


def test_rule_split_strips_whitespace_around_segments():
    from app.services.text_split_service import rule_split
    text = "  你好。  世界。  "
    # 两段都短，合并
    result = rule_split(text, ["。"])
    assert result == ["你好。世界。"]


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


# ------- rule_split 短段合并 (逗号密集场景) -------

def test_rule_split_merges_short_segments():
    """逗号密集时，短段 <5 且下一段 <15 → 合并到同一行。"""
    from app.services.text_split_service import rule_split
    # 往前看，又而无际，都是短段
    text = "往前看，又而无际，他继续前行。"
    result = rule_split(text, ["，", "。"])
    # "往前看，"(4<5) + "又而无际，"(5) → 合并 → "往前看，又而无际，"(9)
    # 9 不<5，不再吸并 "他继续前行。"
    assert result == ["往前看，又而无际，", "他继续前行。"]


def test_rule_split_merges_multiple_consecutive_shorts():
    """连续多个极短段都合并到同一行，直到长度达阈。"""
    from app.services.text_split_service import rule_split
    # 3 个短段 + 1 个尾段
    text = "啊，啊，啊，他开口了。"
    result = rule_split(text, ["，", "。"])
    # "啊，"(2)+"啊，"(2) → "啊，啊，"(4)
    # 4<5 且 "啊，"(2)<15 → 继续 → "啊，啊，啊，"(6)
    # 6 不<5 → 停。尾段独立
    assert result == ["啊，啊，啊，", "他开口了。"]


def test_rule_split_does_not_merge_when_next_too_long():
    """下一段 >= next_max_len_to_merge 时不合并，避免产生过长行。"""
    from app.services.text_split_service import rule_split
    # 首段 3 字，下一段 15 字（含标点） → 不合并
    text = "你好，今天天气非常非常好。。。。。。。。。。。。。"
    # 构造一个確定>=15 的下一段，直接手写更清楚：
    text = "你好，" + "天气非常好今天阳光充足不错啦。"
    # 首段 = "你好，"(3)，下一段长度 15 (14 字 + 。) => 共 15
    assert len("天气非常好今天阳光充足不错啦。") == 15
    result = rule_split(text, ["，", "。"])
    # 下一段 15 不 < 15 → 不合并
    assert result == ["你好，", "天气非常好今天阳光充足不错啦。"]


def test_rule_split_disable_merge_with_zero_threshold():
    """min_len_to_merge=0 → 关闭合并，保留原先细粒度拆分。"""
    from app.services.text_split_service import rule_split
    text = "你好，世界。"
    result = rule_split(text, ["，", "。"], min_len_to_merge=0)
    assert result == ["你好，", "世界。"]


def test_rule_split_custom_thresholds():
    """自定义阈值：min_len_to_merge=3 时，长度怼为 3 的段不再合并。"""
    from app.services.text_split_service import rule_split
    text = "你好，世界。"  # ["你好，"(3), "世界。"(3)]
    result = rule_split(text, ["，", "。"], min_len_to_merge=3)
    # 3 不 < 3 → 不合并
    assert result == ["你好，", "世界。"]


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