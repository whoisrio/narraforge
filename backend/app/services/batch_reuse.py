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
    }
