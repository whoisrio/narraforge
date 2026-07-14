"""Integration test for the chapters:batch endpoint (used by split_segment node)."""
from app.models.segmented_project import SegmentedProject
from app.schemas.segmented_project import ProjectIn
from app.services.segmented_project_service import create_chapter_for_project, save_project


def test_batch_create_chapters_and_segments(client, db_session):
    """Create a project, batch POST chapters, assert DB rows created."""
    save_project(db_session, ProjectIn(id="p-batch-1", name="t", layout="vertical"))
    db_session.commit()

    payload = {
        "chapters": [
            {
                "chapter_title": "Ch1",
                "segments": [
                    {"text": "seg one", "emotion": "neutral", "role": "narration", "segment_kind": "narration"},
                    {"text": "seg two", "emotion": "happy", "role": "narration", "segment_kind": "narration"},
                ],
            },
            {
                "chapter_title": "Ch2",
                "segments": [
                    {"text": "seg three", "emotion": "calm", "role": "narration", "segment_kind": "narration"},
                ],
            },
        ]
    }
    r = client.post(f"/api/segmented-projects/p-batch-1/chapters:batch", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["chapters"]) == 2
    assert data["chapters"][0]["id"]
    assert len(data["chapters"][0]["segments"]) == 2
    assert data["chapters"][1]["segments"][0]["id"]

    db_session.expire_all()
    proj = db_session.query(SegmentedProject).get("p-batch-1")
    assert len(proj.chapters) == 2
    assert len(proj.chapters[0].segments) == 2


def test_batch_replaces_existing_chapters(client, db_session):
    """Second batch POST replaces (not duplicates) existing chapters."""
    save_project(db_session, ProjectIn(id="p-batch-2", name="t2", layout="vertical"))
    create_chapter_for_project(db_session, "p-batch-2", "old", 0)
    db_session.commit()

    payload = {"chapters": [{"chapter_title": "new", "segments": [{"text": "x", "emotion": "neutral"}]}]}
    r = client.post(f"/api/segmented-projects/p-batch-2/chapters:batch", json=payload)
    assert r.status_code == 200

    db_session.expire_all()
    proj = db_session.query(SegmentedProject).get("p-batch-2")
    assert len(proj.chapters) == 1  # replaced
    assert proj.chapters[0].name == "new"


def test_batch_404_unknown_project(client, db_session):
    r = client.post("/api/segmented-projects/nope/chapters:batch", json={"chapters": []})
    assert r.status_code == 404