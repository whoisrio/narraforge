"""validate_segment_lengths：segment 文本长度全局约束（local+workers 都生效）。"""
import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.core.limits import validate_segment_lengths, validate_synthesis_text


class _Seg:
    """chapters:batch 的 BatchSegmentIn 形状（无 id）。"""

    def __init__(self, text: str):
        self.text = text


class _BatchCh:
    """chapters:batch 的 BatchChapterIn 形状（chapter_title，无 id）。"""

    def __init__(self, title: str, segs: list):
        self.chapter_title = title
        self.segments = segs


def test_no_op_when_limit_disabled(monkeypatch):
    monkeypatch.setattr(settings, "max_segment_chars", 0)
    validate_segment_lengths([_BatchCh("t", [_Seg("x" * 1000)])])


def test_raises_422_with_detail(monkeypatch):
    monkeypatch.setattr(settings, "max_segment_chars", 80)
    with pytest.raises(HTTPException) as ei:
        validate_segment_lengths([_BatchCh("第一章", [_Seg("ok"), _Seg("x" * 81)])])
    assert ei.value.status_code == 422
    detail = ei.value.detail
    assert detail["code"] == "segment_too_long"
    assert detail["max"] == 80
    assert detail["chapter_id"] == "第一章"
    assert detail["segment_id"] is None


def test_project_in_shape_uses_ids(monkeypatch):
    """ProjectIn.chapters（ChapterIn/SegmentIn 带 id）→ detail 用真实 id。"""
    from app.schemas.segmented_project import ProjectIn

    monkeypatch.setattr(settings, "max_segment_chars", 80)
    project = ProjectIn(
        id="p", name="n",
        chapters=[{"id": "c1", "name": "c",
                   "segments": [{"id": "s1", "text": "x" * 81}]}],
    )
    with pytest.raises(HTTPException) as ei:
        validate_segment_lengths(project.chapters)
    assert ei.value.detail["chapter_id"] == "c1"
    assert ei.value.detail["segment_id"] == "s1"


def test_exact_limit_ok(monkeypatch):
    monkeypatch.setattr(settings, "max_segment_chars", 80)
    validate_segment_lengths([_BatchCh("t", [_Seg("x" * 80)])])


def test_synthesis_text_override(monkeypatch):
    monkeypatch.setattr(settings, "max_segment_chars", 80)
    validate_synthesis_text("x" * 80, chapter_id="c1", segment_id="s1")
    validate_synthesis_text(None, chapter_id="c1", segment_id="s1")
    with pytest.raises(HTTPException) as ei:
        validate_synthesis_text("x" * 81, chapter_id="c1", segment_id="s1")
    assert ei.value.status_code == 422
    assert ei.value.detail["code"] == "segment_too_long"
    assert ei.value.detail["chapter_id"] == "c1"
    assert ei.value.detail["segment_id"] == "s1"
