"""全局内容约束（local + workers 两种部署模式都生效）。

与计费配额（workers-only）不同，这里是内容质量约束：segment 文本长度上限。
"""
from __future__ import annotations

from typing import Any, Iterable

from fastapi import HTTPException

from app.core.config import settings


def validate_segment_lengths(chapters: Iterable[Any]) -> None:
    """校验 payload 各章节 segment 文本不超过 settings.max_segment_chars。

    兼容两种 payload 形状：ProjectIn.chapters（ChapterIn/SegmentIn，带 id）与
    chapters:batch 的 BatchChapterIn（chapter_title，segment 无 id）。
    max_segment_chars <= 0 时不限制。

    已知取舍：存量项目若已有超长段，下次全量保存（PUT / chapters:batch）
    会被拒，需由 UI 先触发重拆把长段截断。
    """
    max_chars = settings.max_segment_chars
    if max_chars <= 0:
        return
    for ch in chapters:
        chapter_id = getattr(ch, "id", None) or getattr(ch, "chapter_title", None)
        for seg in getattr(ch, "segments", None) or []:
            if len(getattr(seg, "text", "") or "") > max_chars:
                raise HTTPException(
                    status_code=422,
                    detail={
                        "code": "segment_too_long",
                        "max": max_chars,
                        "chapter_id": chapter_id,
                        "segment_id": getattr(seg, "id", None),
                    },
                )


def validate_synthesis_text(text: str | None, *, chapter_id: str, segment_id: str) -> None:
    """合成端点的 text 覆盖同样受长度约束（与 validate_segment_lengths 同 422 码）。"""
    max_chars = settings.max_segment_chars
    if max_chars <= 0 or not text:
        return
    if len(text) > max_chars:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "segment_too_long",
                "max": max_chars,
                "chapter_id": chapter_id,
                "segment_id": segment_id,
            },
        )
