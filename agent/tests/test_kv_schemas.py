from app.schemas import (
    QualityReviewResult,
    SourceElement,
)
from app.state import KnowledgeVideoState


def test_quality_review_result_schema():
    r = QualityReviewResult(
        passed=False,
        dimensions=[{"name": "fidelity", "passed": False, "comment": "漏段"}],
        issues=["第二章缺失"],
    )
    assert r.passed is False
    assert r.dimensions[0].name == "fidelity"


def test_source_element_schema():
    e = SourceElement(kind="image", ref="docs/a.png", chapter_index=1, excerpt="示意图")
    assert e.kind == "image"


def test_knowledge_video_state_is_typed_dict():
    state: KnowledgeVideoState = {"project_id": "p1", "current_stage": "preflight_check"}
    assert state["project_id"] == "p1"
