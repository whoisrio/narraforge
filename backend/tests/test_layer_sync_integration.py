"""Integration tests for layer-sync Phase A hooks + sync-status endpoint."""
from app.core import config
from app.models.segmented_project import SegmentedProject, SegmentedProjectChapter
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc
from app.services.layer_sync_service import sync_status


def _seed(pid: str = "p1") -> ProjectIn:
    return ProjectIn(
        id=pid, name="Sync测试", schema_version=2, layout="vertical", original_text="原文",
        chapters=[{
            "id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
            "voice": {"engine": "edge_tts"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "narration_script": "第一句。第二句。",
            "segments": [
                {"id": "s1", "position": 0, "text": "第一句。", "voice": {"source": "chapter"}},
                {"id": "s2", "position": 0, "text": "第二句。", "voice": {"source": "chapter"}},
            ],
        }],
    )


def _chapter(db, pid="p1", cid="c1") -> SegmentedProjectChapter:
    return db.query(SegmentedProjectChapter).filter_by(id=cid, project_id=pid).one()


# ── batch_create_structure hook (agent write path) ──


def test_batch_create_marks_chapter_consistent(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    # empty project shell
    db_session.add(SegmentedProject(id="p1", name="Sync测试", schema_version=2, layout="vertical"))
    db_session.commit()

    svc.batch_create_structure(
        db_session, "p1",
        [{"chapter_title": "第一章", "narration_script": "稿一。稿二。",
          "segments": [{"text": "稿一。"}, {"text": "稿二。"}]}],
    )

    ch = db_session.query(SegmentedProjectChapter).filter_by(project_id="p1").one()
    assert ch.sync_state is not None
    assert set(ch.sync_state.keys()) == {"l1_hash", "l2_hash", "segments_hash"}
    assert sync_status(ch) == {"l1_dirty": False, "l2_dirty": False, "l3_dirty": False}


# ── split endpoint hook ──


def test_split_endpoint_rebaselines_l2_and_l3(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db_session, _seed())
    db_session.commit()
    # establish a consistent baseline, then dirty L3 by editing a segment
    ch = _chapter(db_session)
    from app.services.layer_sync_service import mark_consistent
    mark_consistent(ch)
    db_session.commit()
    ch.segments[0].text = "已编辑"
    db_session.commit()
    cid = ch.id

    resp_before = client.get(f"/api/segmented-projects/p1/chapters/{cid}/sync-status")
    assert resp_before.json()["l3_dirty"] is True

    # re-split from the narration script -> L2/L3 re-baselined, l3 dirty clears
    resp = client.post(
        f"/api/segmented-projects/p1/chapters/{cid}/split",
        json={"text": "第一句。第二句。", "mode": "rule", "replace_strategy": "replace_chapter_segments"},
    )
    assert resp.status_code == 200

    resp_after = client.get(f"/api/segmented-projects/p1/chapters/{cid}/sync-status")
    body = resp_after.json()
    assert body["l2_dirty"] is False
    assert body["l3_dirty"] is False


# ── generic save_project does NOT touch sync_state ──


def test_save_project_does_not_rebaseline_on_plain_edit(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db_session, _seed())
    db_session.commit()
    # simulate a prior consistent baseline
    ch = _chapter(db_session)
    from app.services.layer_sync_service import mark_consistent
    mark_consistent(ch)
    db_session.commit()
    baseline = dict(ch.sync_state)

    # edit a segment text via save_project (full reconcile) - L3 should become dirty
    edited = _seed()
    edited.chapters[0].segments[0].text = "第一句改了。"
    svc.save_project(db_session, edited)
    db_session.commit()

    ch = _chapter(db_session)
    # sync_state NOT rebaselined (still the old baseline) -> l3 dirty detectable
    assert ch.sync_state == baseline
    assert sync_status(ch)["l3_dirty"] is True


# ── sync-status endpoint ──


def test_sync_status_endpoint_reflects_dirty_layers(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db_session, _seed())
    db_session.commit()
    ch = _chapter(db_session)
    from app.services.layer_sync_service import mark_consistent
    mark_consistent(ch)
    db_session.commit()
    cid = ch.id

    # consistent
    assert client.get(f"/api/segmented-projects/p1/chapters/{cid}/sync-status").json() == \
        {"l1_dirty": False, "l2_dirty": False, "l3_dirty": False}

    # edit L2 + L3
    ch.narration_script = "改写稿变了"
    ch.segments[0].text = "段也变了"
    db_session.commit()

    body = client.get(f"/api/segmented-projects/p1/chapters/{cid}/sync-status").json()
    assert body["l2_dirty"] is True
    assert body["l3_dirty"] is True
    assert body["l1_dirty"] is False


def test_sync_status_endpoint_unsplit_chapter_all_false(client, db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db_session, _seed())
    db_session.commit()
    ch = _chapter(db_session)
    # no sync_state ever set
    ch.sync_state = None
    db_session.commit()
    assert client.get(f"/api/segmented-projects/p1/chapters/{ch.id}/sync-status").json() == \
        {"l1_dirty": False, "l2_dirty": False, "l3_dirty": False}
