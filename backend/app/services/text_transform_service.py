"""合成时文本变换（发音映射 + 大写转小写）— 纯函数，无 ORM 依赖。

前端镜像：frontend/src/services/textTransforms.ts —— 修改任一侧的规则时
必须同步另一侧（两侧测试用例一一对应）。

只影响送给 TTS 引擎的文本；segment.text 原文、字幕、SRT 导出不受影响。
本模块被 workers bundle 引用（segmented_synth_workers），不得 import
sqlalchemy / app.models。
"""
from __future__ import annotations

import re
from typing import Any, Iterable

# 全大写拉丁词：至少 2 个连续大写字母，前后不紧邻 ASCII 字母/数字。
# 排除 I（单字母）、Http（首字母大写）、HTTP2（尾随数字标识符）。
# 与前端 UPPERCASE_WORD_RE 同规则。
_UPPERCASE_WORD_RE = re.compile(r"(?<![A-Za-z0-9])[A-Z]{2,}(?![A-Za-z0-9])")


def merge_maps(
    global_map: list[dict[str, Any]] | None,
    project_map: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """全局 ∪ 项目，以 source 为键；同 source 项目条目整体覆盖全局条目（含 id）。"""
    merged: dict[str, dict[str, Any]] = {}
    for entry in global_map or []:
        source = entry.get("source")
        if source:
            merged[source] = entry
    for entry in project_map or []:
        source = entry.get("source")
        if source:
            merged[source] = entry
    return list(merged.values())


def apply_pronunciation_map(text: str, entries: Iterable[dict[str, Any]]) -> str:
    """按 source 长度降序做单次全量替换（不递归：target 含 source 也不循环）。

    长度降序保证重叠 source（如「调动」与「调动工作」）行为确定。
    """
    ordered = sorted(entries, key=lambda e: len(e.get("source") or ""), reverse=True)
    for entry in ordered:
        source = entry.get("source") or ""
        if source:
            text = text.replace(source, entry.get("target") or "")
    return text


def lowercase_latin_words(text: str) -> str:
    """全大写拉丁词 [A-Z]{2,} 转小写（REST API 接口 → rest api 接口）。"""
    return _UPPERCASE_WORD_RE.sub(lambda m: m.group(0).lower(), text)


def resolve_lowercase_latin(
    segment_value: bool | None,
    project_value: bool | None,
) -> bool:
    """段级覆盖（非 None 优先）→ 项目默认 → False。"""
    if segment_value is not None:
        return bool(segment_value)
    return bool(project_value)


def apply_text_transforms(
    text: str,
    *,
    merged_map: list[dict[str, Any]],
    apply_all: bool = False,
    applied_map_ids: Iterable[str] | None = None,
    lowercase_latin: bool = False,
) -> str:
    """发音映射替换 → 大写词小写化（顺序固定，先于 prepare_text_for_engine）。

    - apply_all=True：整个生效字典对所有段生效（项目级无脑开关）。
    - 否则只应用段级 applied_map_ids 引用的条目；悬空 id（被覆盖/已删除）
      在 merged_map 里查不到，天然忽略。
    - 小写化在映射之后：映射 target 中的全大写词也会被小写化（预期行为）。
    """
    if not text:
        return text
    if apply_all:
        effective = list(merged_map)
    else:
        ids = set(applied_map_ids or [])
        effective = [e for e in merged_map if e.get("id") in ids]
    text = apply_pronunciation_map(text, effective)
    if lowercase_latin:
        text = lowercase_latin_words(text)
    return text
