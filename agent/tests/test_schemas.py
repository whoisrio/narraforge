import pytest
from pydantic import ValidationError

from app.schemas import (
    ChapterStructure,
    ChapterWithSegmentIds,
    Preference,
    ReviewDimension,
    ReviewResult,
    Segment,
    SegmentChapters,
    SynthResult,
)


def test_review_result_valid():
    r = ReviewResult(
        dimensions=[ReviewDimension(name="x", status="pass", comment="ok")],
        overall_score=4,
        overall_comment="good",
        has_critical_issue=False,
    )
    assert r.overall_score == 4


def test_review_dimension_bad_status():
    with pytest.raises(ValidationError):
        ReviewDimension(name="x", status="bad", comment="ok")


def test_review_result_score_range():
    with pytest.raises(ValidationError):
        ReviewResult(
            dimensions=[],
            overall_score=6,
            overall_comment="c",
            has_critical_issue=False,
        )


def test_segment_defaults():
    s = Segment(text="hi")
    assert s.role == "narration" and s.segment_kind == "narration"


def test_segment_chapters_wraps_list():
    sc = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    assert sc.chapters[0].segments[0].text == "t"


def test_preference_category_enum():
    p = Preference(preference="short", category="pacing")
    assert p.category == "pacing"
    with pytest.raises(ValidationError):
        Preference(preference="x", category="nope")


def test_chapter_with_segment_ids():
    c = ChapterWithSegmentIds(id="ch1", segments=[{"id": "s1"}])
    assert c.segments[0].id == "s1"


def test_synth_result_defaults():
    s = SynthResult(chapter_id="c", segment_id="s")
    assert s.audio_path is None and s.duration_sec is None
