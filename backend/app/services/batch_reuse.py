"""chapters:batch 的复用匹配纯逻辑（local / workers 两种模式共用）。

本模块不得引入 sqlalchemy 或文件系统依赖——workers bundle 也会导入它。
文件搬运/GC 属于 local 模式，留在 segmented_project_service。
"""
from __future__ import annotations

import copy
import re
from collections import defaultdict, deque
from typing import Any

_CHAPTER_NUM_PREFIX_RE = re.compile(r"^\s*\d+\s*[.、．]\s*")


def normalize_chapter_title(name: str | None) -> str:
    """标题匹配键：strip 并去掉前导序号（"01. xxx" -> "xxx"）。

    文本库拆分弹窗给章节名加零填充序号前缀；文档中间插入章节会让序号平移，
    匹配时必须忽略它。
    """
    return _CHAPTER_NUM_PREFIX_RE.sub("", (name or "").strip()).strip()


def build_reuse_index(chapters: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """把旧章节结构建成复用索引：规范化标题 -> {voice, split_config, segments}.

    ``segments`` 是 {strip 后文本: deque([segment 快照, ...])}；每条旧 segment
    只能被消费一次（重复文本按出现顺序一一对应）。输入 dict 的 JSON 字段
    （voice/split_config/audio/generated_params）会被深拷贝，调用方之后可以
    安全地删除原行。
    """
    index: dict[str, dict[str, Any]] = {}
    for ch in chapters:
        key = normalize_chapter_title(ch.get("name"))
        if not key or key in index:
            continue  # 重名章节：先出现者生效
        segs: dict[str, Any] = defaultdict(deque)
        for s in ch.get("segments") or []:
            text_key = (s.get("text") or "").strip()
            segs[text_key].append(
                {
                    "emotion": s.get("emotion"),
                    "role_id": s.get("role_id"),
                    "voice": copy.deepcopy(s.get("voice")) if s.get("voice") else None,
                    "audio": copy.deepcopy(s.get("audio")) if s.get("audio") else None,
                    "generated_params": (
                        copy.deepcopy(s.get("generated_params")) if s.get("generated_params") else None
                    ),
                    "generated_at": s.get("generated_at"),
                }
            )
        index[key] = {
            "voice": copy.deepcopy(ch.get("voice")) if ch.get("voice") else None,
            "split_config": copy.deepcopy(ch.get("split_config")) if ch.get("split_config") else None,
            "segments": segs,
        }
    return index


def new_reuse_report() -> dict[str, Any]:
    """reuse 报告的初始结构（两模式字段保持一致）。"""
    return {
        "chapters_matched": 0,
        "segments_matched": 0,
        "segments_reused": 0,
        "segments_new": 0,
        "per_chapter": [],
        "discard": {"text_changed": 0, "boundary_changed": 0, "no_audio": 0},
        "recorded_discard": 0,
    }


# ---------------------------------------------------------------------------
# plan_batch_reuse：重拆保留的纯匹配规划器（A1）
# ---------------------------------------------------------------------------

DEFAULT_SPLIT_DELIMITERS = ["，", "。", "！", "？", "；"]

_DEFAULT_VOICE = {"engine": "edge_tts", "voice": "zh-CN-YunxiNeural", "rate": "+0%", "volume": "+0%"}

_WHITESPACE_RE = re.compile(r"\s+")
_CONSUMED_FLAG = "_consumed"


def _squash(text: str | None) -> str:
    """去全部空白的比较键（边界连接识别忽略空白）。"""
    return _WHITESPACE_RE.sub("", text or "")


def snapshot_has_segments(snapshot: dict[str, Any] | None) -> bool:
    """快照（build_reuse_index 的 value）里是否还有旧 segment——A2 自动拆分判定用。"""
    if not snapshot:
        return False
    return any(snapshot.get("segments", {}).values())


def resolve_split_delimiters(
    payload_config: dict[str, Any] | None,
    snapshot: dict[str, Any] | None = None,
) -> list[str]:
    """拆分分隔符沿承：payload split_config > 匹配快照 > 默认。"""
    cfg = payload_config or (snapshot or {}).get("split_config") or {}
    return cfg.get("delimiters") or list(DEFAULT_SPLIT_DELIMITERS)


def _is_recorded(audio: dict[str, Any] | None) -> bool:
    current = (audio or {}).get("current")
    return isinstance(current, dict) and current.get("origin") == "recorded"


def _build_boundary_keys(old_chapters: list[dict[str, Any]]) -> set[str]:
    """边界变化识别键集：每个旧章节内连续 ≥2 段文本连接（忽略空白）。

    跨章连接不识别（v1 范围）。
    """
    keys: set[str] = set()
    for ch in old_chapters:
        seq = [_squash(s.get("text")) for s in ch.get("segments") or []]
        for i in range(len(seq)):
            acc = seq[i]
            for j in range(i + 1, len(seq)):
                acc += seq[j]
                if acc:
                    keys.add(acc)
    return keys


def _derive_default_voice(old_chapters: list[dict[str, Any]]) -> dict[str, Any]:
    """默认 voice：第一个旧章节的有效 voice，否则 edge_tts 默认（两模式一致）。"""
    if old_chapters:
        ch_voice = old_chapters[0].get("voice") or {}
        if ch_voice.get("voice") and ch_voice.get("engine") == "edge_tts":
            return copy.deepcopy(ch_voice)
        if ch_voice.get("voice_id") and ch_voice.get("engine") in ("cosyvoice", "mimo_tts", "voxcpm"):
            return copy.deepcopy(ch_voice)
    return copy.deepcopy(_DEFAULT_VOICE)


def plan_batch_reuse(
    old_chapters: list[dict[str, Any]],
    new_chapters: list[dict[str, Any]],
    *,
    preserve_audio: bool,
) -> dict[str, Any]:
    """重拆保留的纯匹配规划：旧结构快照 × 新章节 payload -> 沿承/复用计划。

    ``new_chapters`` 的 segments 由调用方预先解析好（payload 自带或
    rule_split 结果），规划器不碰拆分、不碰磁盘。

    匹配顺序：

    1. 章节内精确匹配（标题忽略前导序号，池消费一次）；
    2. 全部章节完成第 1 步后，剩余新段进全局兜底池（所有旧章节未消费段，
       按章序 + 段序），解决章节重组/文本跨章移动的复用（S3）；
    3. 未命中新段分类：同一旧章节内连续 ≥2 段连接等于新文本（忽略空白）记
       ``boundary_changed``，否则记 ``text_changed``。

    返回 ``{"chapters": [...], "report": {...}, "unconsumed": [...]}``：

    - chapters[].voice / split_config 为沿承决策（payload > 快照 > 默认）；
    - chapters[].segments[].match 为命中的旧 segment 快照（深拷贝，含
      audio/emotion/role_id/voice/generated_params/generated_at），source
      标记 ``chapter`` / ``global``；
    - report 含 discard 明细（text_changed / boundary_changed / no_audio）
      与 recorded_discard（将丢弃的用户录音段数）；``segments_reused`` 是
      按计划口径（旧段有 audio 记录即计），应用层磁盘探测可能降级；
    - unconsumed 为未被消费的旧 segment 快照（local 模式 GC 清单）。
    """
    index = build_reuse_index(old_chapters)
    boundary_keys = _build_boundary_keys(old_chapters) if preserve_audio else set()
    default_voice = _derive_default_voice(old_chapters)

    plan_chapters: list[dict[str, Any]] = []
    pending_global: list[dict[str, Any]] = []

    for position, ch_data in enumerate(new_chapters):
        title = ch_data.get("chapter_title") or f"Chapter {position + 1}"
        snapshot = index.get(normalize_chapter_title(title))

        voice = (
            copy.deepcopy(snapshot["voice"])
            if snapshot and snapshot["voice"]
            else copy.deepcopy(default_voice)
        )
        engine = ch_data.get("engine")
        if engine:
            voice["engine"] = engine
        if ch_data.get("split_config"):
            split_config = copy.deepcopy(ch_data["split_config"])
        elif snapshot and snapshot["split_config"]:
            split_config = copy.deepcopy(snapshot["split_config"])
        else:
            split_config = None

        plan_segments: list[dict[str, Any]] = []
        for seg_data in ch_data.get("segments") or []:
            match = None
            if preserve_audio and snapshot is not None:
                pool = snapshot["segments"].get((seg_data.get("text") or "").strip())
                if pool:
                    match = pool.popleft()
                    match[_CONSUMED_FLAG] = True
            plan_seg = {
                "text": seg_data.get("text"),
                "emotion": seg_data.get("emotion"),
                "role": seg_data.get("role"),
                "segment_kind": seg_data.get("segment_kind", "narration"),
                "match": match,
                "source": "chapter" if match is not None else None,
            }
            if match is None:
                pending_global.append(plan_seg)
            plan_segments.append(plan_seg)

        plan_chapters.append(
            {
                "title": title,
                "narration_script": ch_data.get("narration_script"),
                "original_text": ch_data.get("original_text"),
                "voice": voice,
                "split_config": split_config,
                "chapter_matched": snapshot is not None,
                "segments": plan_segments,
            }
        )

    # 第 2 步：全局兜底池（所有旧章节未消费段，章序 + 段序）
    if preserve_audio and pending_global:
        global_pool: dict[str, deque] = defaultdict(deque)
        for snap in index.values():
            for text_key, pool in snap["segments"].items():
                for entry in pool:
                    if not entry.get(_CONSUMED_FLAG):
                        global_pool[text_key].append(entry)
        for plan_seg in pending_global:
            pool = global_pool.get((plan_seg["text"] or "").strip())
            if pool:
                match = pool.popleft()
                match[_CONSUMED_FLAG] = True
                plan_seg["match"] = match
                plan_seg["source"] = "global"

    # 未消费旧段（local 模式 GC 清单；recorded_discard 统计来源）
    unconsumed: list[dict[str, Any]] = []
    for snap in index.values():
        for pool in snap["segments"].values():
            for entry in pool:
                if not entry.get(_CONSUMED_FLAG):
                    unconsumed.append(entry)

    report = new_reuse_report()
    for plan_ch in plan_chapters:
        ch_matched = 0
        ch_reused = 0
        for plan_seg in plan_ch["segments"]:
            match = plan_seg["match"]
            if match is not None:
                ch_matched += 1
                if match.get("audio"):
                    ch_reused += 1
                else:
                    report["discard"]["no_audio"] += 1
            elif preserve_audio:
                if _squash(plan_seg["text"]) in boundary_keys:
                    report["discard"]["boundary_changed"] += 1
                else:
                    report["discard"]["text_changed"] += 1
        if plan_ch["chapter_matched"]:
            report["chapters_matched"] += 1
        report["segments_matched"] += ch_matched
        report["segments_reused"] += ch_reused
        ch_new = len(plan_ch["segments"]) - ch_reused
        report["segments_new"] += ch_new
        report["per_chapter"].append(
            {
                "title": plan_ch["title"],
                "matched": ch_matched,
                "reused": ch_reused,
                "new": ch_new,
            }
        )
    report["recorded_discard"] = sum(1 for entry in unconsumed if _is_recorded(entry.get("audio")))

    return {"chapters": plan_chapters, "report": report, "unconsumed": unconsumed}
