"""Unit tests for app.services.engine_capabilities (style tag engine adaptation)."""
from app.services.engine_capabilities import (
    EMOTION_LEADING_TAG,
    ENGINE_CAPABILITIES,
    VOXCPM_MODE_CAPS,
    apply_leading_tag,
    prepare_text_for_engine,
    strip_inline_tags,
    strip_leading_style_tag,
    voxcpm_supports,
)


# ----- capability matrices -----

def test_engine_capabilities_matrix():
    assert ENGINE_CAPABILITIES["mimo_tts"].inline_tags is False
    assert ENGINE_CAPABILITIES["mimo_tts"].leading_style_tag is True
    assert ENGINE_CAPABILITIES["mimo_tts"].instruction is True

    assert ENGINE_CAPABILITIES["voxcpm"].inline_tags is True
    assert ENGINE_CAPABILITIES["voxcpm"].leading_style_tag is True
    assert ENGINE_CAPABILITIES["voxcpm"].instruction is True

    assert ENGINE_CAPABILITIES["cosyvoice"].inline_tags is False
    assert ENGINE_CAPABILITIES["cosyvoice"].leading_style_tag is False
    assert ENGINE_CAPABILITIES["cosyvoice"].instruction is True

    assert ENGINE_CAPABILITIES["edge_tts"].inline_tags is False
    assert ENGINE_CAPABILITIES["edge_tts"].leading_style_tag is False
    assert ENGINE_CAPABILITIES["edge_tts"].instruction is False


def test_voxcpm_supports_by_mode():
    for feature in ("inline_tags", "leading_style_tag", "instruction"):
        assert voxcpm_supports("clone", feature) is True
        assert voxcpm_supports("design", feature) is True
        assert voxcpm_supports("ultimate", feature) is False
    # 别名/历史 mode 归一化为 design（全支持）
    assert voxcpm_supports("tts", "inline_tags") is True
    assert voxcpm_supports("tts_design", "leading_style_tag") is True
    # 未知 mode 按全支持
    assert voxcpm_supports("whatever", "inline_tags") is True
    assert voxcpm_supports(None, "inline_tags") is True


# ----- strip_inline_tags -----

def test_strip_inline_tags_basic():
    assert strip_inline_tags("你好[笑]世界") == "你好世界"
    assert strip_inline_tags("[叹气]唉，[停顿]没办法") == "唉，没办法"


def test_strip_inline_tags_whitespace_cleanup():
    assert strip_inline_tags("hello [laugh]  world") == "hello world"
    assert strip_inline_tags("你好 [笑] ，世界") == "你好，世界"
    assert strip_inline_tags("  [笑] 你好  ") == "你好"


def test_strip_inline_tags_no_tag_unchanged():
    assert strip_inline_tags("没有标签的文本。") == "没有标签的文本。"
    assert strip_inline_tags("") == ""


# ----- strip_leading_style_tag -----

def test_strip_leading_style_tag_halfwidth():
    assert strip_leading_style_tag("(开心)你好世界") == "你好世界"
    assert strip_leading_style_tag("(开心,磁性) 你好") == "你好"


def test_strip_leading_style_tag_fullwidth():
    assert strip_leading_style_tag("（悲伤）他走了。") == "他走了。"


def test_strip_leading_style_tag_only_leading():
    # 只去开头标签，文中括号保留
    assert strip_leading_style_tag("你好（注释）世界") == "你好（注释）世界"
    assert strip_leading_style_tag("没有标签") == "没有标签"
    assert strip_leading_style_tag("") == ""


# ----- apply_leading_tag -----

def test_apply_leading_tag_emotion_only():
    assert apply_leading_tag("你好", emotion="happy") == "(开心)你好"


def test_apply_leading_tag_style_only():
    assert apply_leading_tag("你好", style="磁性") == "(磁性)你好"


def test_apply_leading_tag_emotion_and_style_same_paren():
    assert apply_leading_tag("你好", emotion="happy", style="磁性") == "(开心,磁性)你好"


def test_apply_leading_tag_neutral_or_empty_returns_as_is():
    assert apply_leading_tag("你好", emotion="neutral") == "你好"
    assert apply_leading_tag("你好", emotion="unknown_emotion") == "你好"
    assert apply_leading_tag("你好") == "你好"
    assert apply_leading_tag("你好", emotion=None, style="  ") == "你好"


def test_apply_leading_tag_idempotent_replaces_existing():
    once = apply_leading_tag("你好", emotion="happy", style="磁性")
    twice = apply_leading_tag(once, emotion="happy", style="磁性")
    assert twice == once
    # 已有（全角）开头标签时先 strip 再加
    assert apply_leading_tag("（旧风格）你好", emotion="sad") == "(悲伤)你好"


def test_emotion_leading_tag_mapping():
    assert EMOTION_LEADING_TAG == {
        "happy": "开心",
        "sad": "悲伤",
        "angry": "愤怒",
        "calm": "平静",
        "excited": "兴奋",
    }
    assert "neutral" not in EMOTION_LEADING_TAG


# ----- prepare_text_for_engine -----

def test_prepare_edge_tts_strips_everything():
    out = prepare_text_for_engine(
        "(开心)你好[笑]世界", engine="edge_tts", emotion="happy", style="磁性"
    )
    assert out == "你好世界"


def test_prepare_cosyvoice_strips_tags_no_leading():
    out = prepare_text_for_engine(
        "你好[笑]世界", engine="cosyvoice", emotion="happy", style="温柔"
    )
    assert out == "你好世界"


def test_prepare_mimo_adds_leading_strips_inline():
    out = prepare_text_for_engine(
        "你好[笑]世界", engine="mimo_tts", emotion="happy", style="声音沙哑"
    )
    assert out == "(开心,声音沙哑)你好世界"


def test_prepare_voxcpm_clone_keeps_inline_adds_leading():
    out = prepare_text_for_engine(
        "你好[笑]世界", engine="voxcpm", emotion="happy",
        style="磁性", voxcpm_mode="clone",
    )
    assert out == "(开心,磁性)你好[笑]世界"


def test_prepare_voxcpm_ultimate_strips_everything():
    out = prepare_text_for_engine(
        "(开心)你好[笑]世界", engine="voxcpm", emotion="happy",
        style="磁性", voxcpm_mode="ultimate",
    )
    assert out == "你好世界"


def test_prepare_mute_tags_overrides_supporting_engine():
    out = prepare_text_for_engine(
        "(开心)你好[笑]世界", engine="voxcpm", emotion="happy",
        style="磁性", voxcpm_mode="clone", mute_tags=True,
    )
    assert out == "你好世界"


def test_prepare_unknown_engine_strips_everything():
    out = prepare_text_for_engine(
        "(开心)你好[笑]世界", engine="not_a_real_engine", emotion="happy"
    )
    assert out == "你好世界"


def test_prepare_no_emotion_no_style_keeps_text_for_leading_engine():
    out = prepare_text_for_engine("你好世界", engine="mimo_tts")
    assert out == "你好世界"
