"""plan_batch_reuse 纯匹配规划器单元测试（A1）。

规划器输入「旧章节结构快照 + 已解析好 segments 的新章节 payload」，输出
沿承决策（voice/split_config）、逐段匹配结果（章节内 / 全局兜底）与
诚实 discard 明细。纯函数、无 IO——本文件不碰数据库与文件系统。
"""
from __future__ import annotations

from app.services.batch_reuse import (
    DEFAULT_SPLIT_DELIMITERS,
    plan_batch_reuse,
    resolve_split_delimiters,
    snapshot_has_segments,
)


def _seg(text, *, audio=True, origin="tts", emotion=None, role_id=None, voice=None):
    return {
        "text": text,
        "emotion": emotion,
        "role_id": role_id,
        "voice": voice,
        "audio": (
            {
                "format": "mp3",
                "current": {"path": f"old/{abs(hash(text))}.mp3", "format": "mp3", "origin": origin},
            }
            if audio
            else None
        ),
        "generated_params": {"engine": "edge_tts"} if audio else None,
        "generated_at": "2026-08-17T00:00:00" if audio else None,
    }


def _old_chapter(name, segments, *, voice=None, split_config=None):
    return {"name": name, "voice": voice, "split_config": split_config, "segments": segments}


def _new_chapter(title, texts, **kw):
    return {
        "chapter_title": title,
        "segments": [{"text": t} for t in texts],
        **kw,
    }


# ---------------------------------------------------------------------------
# 章节内精确匹配（现行为迁移）
# ---------------------------------------------------------------------------


def test_chapter_exact_match_basic():
    old = [_old_chapter("01. 介绍", [_seg("不变的一段。"), _seg("旧的一段。")])]
    new = [_new_chapter("01. 介绍", ["不变的一段。", "新的一段。"])]
    plan = plan_batch_reuse(old, new, preserve_audio=True)

    ch = plan["chapters"][0]
    assert ch["chapter_matched"] is True
    assert ch["segments"][0]["match"] is not None
    assert ch["segments"][0]["source"] == "chapter"
    assert ch["segments"][1]["match"] is None

    report = plan["report"]
    assert report["chapters_matched"] == 1
    assert report["segments_matched"] == 1
    assert report["segments_reused"] == 1
    assert report["segments_new"] == 1
    assert report["discard"] == {"text_changed": 1, "boundary_changed": 0, "no_audio": 0}


def test_duplicate_text_consumed_once():
    old = [_old_chapter("01. 章", [_seg("重复。"), _seg("重复。")])]
    new = [_new_chapter("01. 章", ["重复。", "重复。", "重复。"])]
    plan = plan_batch_reuse(old, new, preserve_audio=True)

    matches = [s["match"] for s in plan["chapters"][0]["segments"]]
    assert matches[0] is not None and matches[1] is not None
    assert matches[2] is None  # 每条旧 segment 只消费一次
    assert plan["report"]["segments_reused"] == 2
    assert plan["report"]["discard"]["text_changed"] == 1


def test_title_match_ignores_number_prefix():
    old = [_old_chapter("01. 介绍", [_seg("内容不变。")])]
    new = [_new_chapter("02. 介绍", ["内容不变。"])]
    plan = plan_batch_reuse(old, new, preserve_audio=True)
    assert plan["chapters"][0]["segments"][0]["source"] == "chapter"
    assert plan["report"]["chapters_matched"] == 1


# ---------------------------------------------------------------------------
# 全局兜底（S3：章节重组 / 文本跨章移动）
# ---------------------------------------------------------------------------


def test_global_fallback_restructure():
    """一章拆成两章（新标题），文本逐字未动 -> 全局兜底复用。"""
    old = [_old_chapter("01. 大章", [_seg("前半段内容。"), _seg("后半段内容。")])]
    new = [
        _new_chapter("01. 大章(上)", ["前半段内容。"]),
        _new_chapter("02. 大章(下)", ["后半段内容。"]),
    ]
    plan = plan_batch_reuse(old, new, preserve_audio=True)

    assert plan["report"]["chapters_matched"] == 0  # 标题都没对上
    assert plan["report"]["segments_reused"] == 2
    for ch in plan["chapters"]:
        assert ch["segments"][0]["source"] == "global"
    # 全部消费，无遗留待 GC
    assert plan["unconsumed"] == []
    assert plan["report"]["recorded_discard"] == 0


def test_chapter_match_has_priority_over_global():
    """同文本在多个旧章节出现时，章节内命中优先；其余进全局池按章序消费。"""
    old = [
        _old_chapter("01. 甲", [_seg("同文。")]),
        _old_chapter("02. 乙", [_seg("同文。")]),
    ]
    new = [
        _new_chapter("01. 甲", ["同文。"]),   # 章节内命中甲
        _new_chapter("03. 丙", ["同文。"]),   # 全局兜底命中乙
    ]
    plan = plan_batch_reuse(old, new, preserve_audio=True)

    assert plan["chapters"][0]["segments"][0]["source"] == "chapter"
    assert plan["chapters"][1]["segments"][0]["source"] == "global"
    assert plan["report"]["segments_reused"] == 2
    assert plan["unconsumed"] == []


# ---------------------------------------------------------------------------
# 边界变化识别（S2 诚实化）
# ---------------------------------------------------------------------------


def test_boundary_changed_detection():
    """新文本 == 同一旧章节内连续多段旧文本的连接 -> boundary_changed。"""
    old = [_old_chapter("01. 章", [_seg("这是一句很长的话，", audio=True), _seg("后面还有半句。")])]
    new = [_new_chapter("01. 章", ["这是一句很长的话，后面还有半句。"])]
    plan = plan_batch_reuse(old, new, preserve_audio=True)

    seg = plan["chapters"][0]["segments"][0]
    assert seg["match"] is None
    report = plan["report"]
    assert report["segments_reused"] == 0
    assert report["discard"]["boundary_changed"] == 1
    assert report["discard"]["text_changed"] == 0


def test_boundary_concat_ignores_whitespace():
    """连接比较忽略空白（旧段尾部换行/空格不影响识别）。"""
    old = [_old_chapter("01. 章", [_seg("甲。\n", audio=False), _seg("  乙。")])]
    new = [_new_chapter("01. 章", ["甲。乙。"])]
    plan = plan_batch_reuse(old, new, preserve_audio=True)
    assert plan["report"]["discard"]["boundary_changed"] == 1


def test_boundary_finer_new_segments_are_text_changed():
    """v1 范围 pin：旧段更粗（LLM 合并段）、新段更细（rule 重拆）时，
    新段不是旧段的连接 -> 计 text_changed 而非 boundary_changed。"""
    old = [_old_chapter("01. 章", [_seg("这是一句很长的话，后面还有半句。")])]
    new = [_new_chapter("01. 章", ["这是一句很长的话，", "后面还有半句。"])]
    plan = plan_batch_reuse(old, new, preserve_audio=True)
    assert plan["report"]["discard"]["boundary_changed"] == 0
    assert plan["report"]["discard"]["text_changed"] == 2


def test_boundary_cross_chapter_not_recognized():
    """跨章连接不识别（v1 范围）：来自两个旧章的文本拼接算 text_changed。"""
    old = [
        _old_chapter("01. 甲", [_seg("甲。")]),
        _old_chapter("02. 乙", [_seg("乙。")]),
    ]
    new = [_new_chapter("03. 丙", ["甲。乙。"])]
    plan = plan_batch_reuse(old, new, preserve_audio=True)
    assert plan["report"]["discard"]["boundary_changed"] == 0
    assert plan["report"]["discard"]["text_changed"] == 1


# ---------------------------------------------------------------------------
# discard 分类
# ---------------------------------------------------------------------------


def test_no_audio_counts_matched_without_audio_record():
    """文本命中但旧段无音频记录（从未合成）-> matched 但不 reused，计 no_audio。"""
    old = [_old_chapter("01. 章", [_seg("没合成过。", audio=False)])]
    new = [_new_chapter("01. 章", ["没合成过。"])]
    plan = plan_batch_reuse(old, new, preserve_audio=True)

    report = plan["report"]
    assert report["segments_matched"] == 1
    assert report["segments_reused"] == 0
    assert report["segments_new"] == 1
    assert report["discard"]["no_audio"] == 1


def test_recorded_discard_counts_unconsumed_recordings():
    """未消费的旧录音段（origin=recorded）计入 recorded_discard 特别警示。"""
    old = [
        _old_chapter("01. 章", [
            _seg("保留的录音。", origin="recorded"),
            _seg("将被丢弃的录音。", origin="recorded"),
            _seg("将被丢弃的合成音。", origin="tts"),
        ])
    ]
    new = [_new_chapter("01. 章", ["保留的录音。"])]
    plan = plan_batch_reuse(old, new, preserve_audio=True)

    assert plan["report"]["recorded_discard"] == 1
    # 未消费的两条进入 GC 清单
    assert len(plan["unconsumed"]) == 2


# ---------------------------------------------------------------------------
# 沿承决策（voice / split_config）
# ---------------------------------------------------------------------------


def test_voice_and_split_config_resolution():
    """payload > 标题匹配快照 > 默认；payload engine 覆盖 voice.engine。"""
    old = [
        _old_chapter(
            "01. 旧章",
            [_seg("内容。")],
            voice={"engine": "voxcpm", "voice_id": "voice-x", "mode": "clone"},
            split_config={"delimiters": ["。"], "mode": "rule"},
        )
    ]
    new = [
        # 快照沿承
        _new_chapter("01. 旧章", ["内容。"]),
        # payload split_config 优先；engine 覆盖
        _new_chapter(
            "02. 新章", ["全新。"],
            split_config={"delimiters": ["！"], "mode": "rule"},
            engine="mimo_tts",
        ),
    ]
    plan = plan_batch_reuse(old, new, preserve_audio=True)

    ch1, ch2 = plan["chapters"]
    assert ch1["voice"] == {"engine": "voxcpm", "voice_id": "voice-x", "mode": "clone"}
    assert ch1["split_config"] == {"delimiters": ["。"], "mode": "rule"}
    assert ch2["split_config"] == {"delimiters": ["！"], "mode": "rule"}
    assert ch2["voice"]["engine"] == "mimo_tts"


def test_default_voice_from_first_old_chapter():
    """默认 voice 取第一个旧章节的有效 voice，否则 edge_tts 默认。"""
    old = [
        _old_chapter("01. 旧", [], voice={"engine": "edge_tts", "voice": "zh-CN-XiaoxiaoNeural"}),
    ]
    new = [_new_chapter("02. 新", ["新内容。"])]
    plan = plan_batch_reuse(old, new, preserve_audio=True)
    assert plan["chapters"][0]["voice"]["voice"] == "zh-CN-XiaoxiaoNeural"

    plan2 = plan_batch_reuse([], new, preserve_audio=True)
    assert plan2["chapters"][0]["voice"]["engine"] == "edge_tts"
    assert plan2["chapters"][0]["voice"]["voice"] == "zh-CN-YunxiNeural"


# ---------------------------------------------------------------------------
# preserve_audio=False：全量替换语义
# ---------------------------------------------------------------------------


def test_preserve_false_does_not_match():
    old = [_old_chapter("01. 章", [_seg("一样的文本。", origin="recorded")])]
    new = [_new_chapter("01. 章", ["一样的文本。"])]
    plan = plan_batch_reuse(old, new, preserve_audio=False)

    assert plan["chapters"][0]["segments"][0]["match"] is None
    report = plan["report"]
    assert report["segments_reused"] == 0
    assert report["discard"] == {"text_changed": 0, "boundary_changed": 0, "no_audio": 0}
    # 全部旧段都会被销毁：录音段数如实统计
    assert report["recorded_discard"] == 1
    assert len(plan["unconsumed"]) == 1


# ---------------------------------------------------------------------------
# A2 辅助：自动拆分判定与分隔符解析
# ---------------------------------------------------------------------------


def test_snapshot_has_segments():
    assert snapshot_has_segments(None) is False
    assert snapshot_has_segments({"segments": {}}) is False
    from collections import deque
    assert snapshot_has_segments({"segments": {"文本": deque([{}])}}) is True


def test_resolve_split_delimiters():
    snapshot = {"split_config": {"delimiters": ["。"], "mode": "rule"}}
    assert resolve_split_delimiters({"delimiters": ["！"]}, snapshot) == ["！"]  # payload 优先
    assert resolve_split_delimiters(None, snapshot) == ["。"]                   # 快照次之
    assert resolve_split_delimiters(None, None) == DEFAULT_SPLIT_DELIMITERS     # 默认兜底
