"""Unit tests for app.services.engine_capabilities (style tag engine adaptation)."""
from app.services.engine_capabilities import (
    EMOTION_LEADING_TAG,
    EMOTION_TO_EMO_VECTOR,
    ENGINE_CAPABILITIES,
    VOXCPM_MODE_CAPS,
    apply_leading_tag,
    emo_vector_for_emotion,
    prepare_text_for_engine,
    strip_inline_tags,
    strip_leading_style_tag,
    strip_parenthesized,
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

    assert ENGINE_CAPABILITIES["indextts"].inline_tags is False
    assert ENGINE_CAPABILITIES["indextts"].leading_style_tag is False
    assert ENGINE_CAPABILITIES["indextts"].instruction is False


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


# ----- IndexTTS emo_vector 映射 -----

def test_emo_vector_for_emotion_known():
    # 维度顺序：[happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]
    assert emo_vector_for_emotion("happy") == [1, 0, 0, 0, 0, 0, 0, 0]
    assert emo_vector_for_emotion("angry") == [0, 1, 0, 0, 0, 0, 0, 0]
    assert emo_vector_for_emotion("sad") == [0, 0, 1, 0, 0, 0, 0, 0]
    assert emo_vector_for_emotion("calm") == [0, 0, 0, 0, 0, 0, 0, 1]
    assert emo_vector_for_emotion("excited") == [0.6, 0, 0, 0, 0, 0, 0.6, 0]


def test_emo_vector_for_emotion_neutral_and_unknown():
    assert emo_vector_for_emotion("neutral") is None
    assert emo_vector_for_emotion("unknown_emotion") is None
    assert emo_vector_for_emotion(None) is None
    assert emo_vector_for_emotion("") is None


def test_emo_vector_mapping_covers_exactly_five():
    assert set(EMOTION_TO_EMO_VECTOR) == {"happy", "angry", "sad", "calm", "excited"}
    for vec in EMOTION_TO_EMO_VECTOR.values():
        assert len(vec) == 8


def test_prepare_indextts_strips_everything():
    # indextts 能力全 False：任何文本 tag 都被清洗，情绪由 emo_vector 单独传递
    out = prepare_text_for_engine(
        "(开心)你好[笑]世界", engine="indextts", emotion="happy", style="磁性"
    )
    assert out == "你好世界"


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


# ----- underscore_to_space -----

def test_prepare_underscore_to_space():
    out = prepare_text_for_engine(
        "你好_世界_测试", engine="edge_tts", underscore_to_space=True
    )
    assert out == "你好 世界 测试"


def test_prepare_underscore_kept_by_default():
    out = prepare_text_for_engine("你好_世界", engine="edge_tts")
    assert out == "你好_世界"


def test_prepare_underscore_to_space_applies_after_leading_tag():
    out = prepare_text_for_engine(
        "你好_世界", engine="mimo_tts", emotion="happy", underscore_to_space=True
    )
    assert out == "(开心)你好 世界"


# ----- skip_parenthesized -----

def test_strip_parenthesized_half_width():
    assert strip_parenthesized("你好(注释)世界") == "你好世界"


def test_strip_parenthesized_full_width():
    assert strip_parenthesized("你好（注释）世界") == "你好世界"


def test_strip_parenthesized_multiple_pairs():
    assert strip_parenthesized("他(真的)来了（很快）") == "他来了"


def test_strip_parenthesized_unmatched_kept():
    assert strip_parenthesized("你好(世界") == "你好(世界"
    assert strip_parenthesized("你好)世界(") == "你好)世界("


def test_strip_parenthesized_collapses_whitespace():
    # 与 strip_inline_tags 同款空白清理：双空格合并、标点前空格去掉
    assert strip_parenthesized("alpha (note) beta") == "alpha beta"
    assert strip_parenthesized("你好 (注释)，世界") == "你好，世界"


def test_strip_parenthesized_empty():
    assert strip_parenthesized("") == ""


def test_prepare_skip_parenthesized():
    out = prepare_text_for_engine(
        "你好(注释)世界（再注）", engine="edge_tts", skip_parenthesized=True
    )
    assert out == "你好世界"


def test_prepare_parenthesized_kept_by_default():
    out = prepare_text_for_engine("你好(注释)世界", engine="edge_tts")
    assert out == "你好(注释)世界"


def test_prepare_skip_parenthesized_before_underscore_to_space():
    out = prepare_text_for_engine(
        "你好(_)世界_测试", engine="edge_tts",
        skip_parenthesized=True, underscore_to_space=True,
    )
    assert out == "你好世界 测试"


def test_prepare_skip_parenthesized_keeps_applied_leading_tag():
    # 先移除原文括号内容，再加开头风格标签——新加的标签不被误删
    out = prepare_text_for_engine(
        "你好(注释)世界", engine="mimo_tts", emotion="happy", skip_parenthesized=True
    )
    assert out == "(开心)你好世界"


def test_prepare_skip_parenthesized_with_mute_tags():
    out = prepare_text_for_engine(
        "(旧风格)你好[笑]世界(注释)", engine="voxcpm", emotion="happy",
        style="磁性", voxcpm_mode="clone", mute_tags=True, skip_parenthesized=True,
    )
    assert out == "你好世界"
