from datetime import datetime, timezone

import pytest

from app.core.segmented_assets import project_dir, read_manifest
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
from app.schemas.segmented_project import ProjectIn
from app.services.segmented_project_service import (
    list_projects,
    get_project_detail,
    save_project,
    delete_project,
    _to_iso,
)


def _seed_project(pid: str = "p1", name: str = "Test") -> ProjectIn:
    return ProjectIn(
        id=pid, name=name, schema_version=2, layout="vertical",
        original_text="全文",
        chapters=[
            {
                "id": f"c-{pid}", "position": 0, "name": "第一章", "engine": "edge_tts",
                "voice": {"engine": "edge_tts"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "segments": [
                    {
                        "id": f"s-{pid}", "position": 0, "text": "hello",
                        "voice": {"source": "chapter"},
                    }
                ],
            }
        ],
    )


def test_save_project_inserts_rows(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    p = db_session.query(SegmentedProject).filter_by(id="p1").one()
    assert p.name == "Test"
    assert len(p.chapters) == 1
    assert len(p.chapters[0].segments) == 1
    assert p.chapters[0].segments[0].text == "hello"
    assert (project_dir("p1", "Test") / "original.txt").read_text(encoding="utf-8") == "全文"
    m = read_manifest("p1", "Test")
    assert m is not None
    assert m["id"] == "p1"


def test_save_project_removes_orphan_segments(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    p = _seed_project()
    p.chapters[0].segments = []
    save_project(db_session, p)
    db_session.commit()
    segs = db_session.query(SegmentedProjectSegment).all()
    assert segs == []


def _seed_two_chapter_project(pid: str = "p1") -> ProjectIn:
    """Project with two chapters (each with two segments) for reorder tests."""
    return ProjectIn(
        id=pid, name="Test", schema_version=2, layout="vertical",
        chapters=[
            {
                "id": f"c-a-{pid}", "position": 0, "name": "A", "engine": "edge_tts",
                "voice": {"engine": "edge_tts"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "segments": [
                    {"id": f"s-a1-{pid}", "position": 0, "text": "a1", "voice": {"source": "chapter"}},
                    {"id": f"s-a2-{pid}", "position": 1, "text": "a2", "voice": {"source": "chapter"}},
                ],
            },
            {
                "id": f"c-b-{pid}", "position": 1, "name": "B", "engine": "edge_tts",
                "voice": {"engine": "edge_tts"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "segments": [
                    {"id": f"s-b1-{pid}", "position": 0, "text": "b1", "voice": {"source": "chapter"}},
                    {"id": f"s-b2-{pid}", "position": 1, "text": "b2", "voice": {"source": "chapter"}},
                ],
            },
        ],
    )


def test_save_project_persists_reordered_chapter_positions(db_session, tmp_path, monkeypatch):
    """Reorder contract: a PUT sending chapters in a new order with renumbered
    `position` must persist that order. The frontend reducer renumbers before
    saving; this test guards the backend half of that contract."""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_two_chapter_project())
    db_session.commit()

    # Reorder: B first (position 0), A second (position 1).
    reordered = _seed_two_chapter_project()
    reordered.chapters = [
        reordered.chapters[1].model_copy(update={"position": 0}),
        reordered.chapters[0].model_copy(update={"position": 1}),
    ]
    save_project(db_session, reordered)
    db_session.commit()

    detail = get_project_detail(db_session, "p1")
    assert [c.id for c in detail.chapters] == ["c-b-p1", "c-a-p1"]
    assert [c.position for c in detail.chapters] == [0, 1]


def test_save_project_persists_reordered_segment_positions(db_session, tmp_path, monkeypatch):
    """Reorder contract: a PUT sending a chapter's segments in a new order with
    renumbered `position` must persist that order within the chapter."""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_two_chapter_project())
    db_session.commit()

    reordered = _seed_two_chapter_project()
    ch_a = reordered.chapters[0]
    ch_a.segments = [
        ch_a.segments[1].model_copy(update={"position": 0}),
        ch_a.segments[0].model_copy(update={"position": 1}),
    ]
    save_project(db_session, reordered)
    db_session.commit()

    detail = get_project_detail(db_session, "p1")
    ch = next(c for c in detail.chapters if c.id == "c-a-p1")
    assert [s.id for s in ch.segments] == ["s-a2-p1", "s-a1-p1"]
    assert [s.position for s in ch.segments] == [0, 1]


def test_save_project_preserves_existing_backend_audio_when_payload_omits_path(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p1").one()
    seg.audio = {
        "current": {"path": "p1/chapters/c-p1/audio/s-p1.mp3", "format": "mp3", "duration_sec": 1.23},
        "previous": {"path": "p1/chapters/c-p1/audio/s-p1-old.mp3"},
    }
    seg.generated_params = {"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"}
    db_session.commit()

    stale_frontend_payload = _seed_project()
    save_project(db_session, stale_frontend_payload)
    db_session.commit()

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p1").one()
    audio = seg.audio or {}
    assert audio["current"]["path"] == "p1/chapters/c-p1/audio/s-p1.mp3"
    assert audio.get("previous", {}).get("path") == "p1/chapters/c-p1/audio/s-p1-old.mp3"
    assert audio["current"]["format"] == "mp3"
    assert audio["current"]["duration_sec"] == 1.23
    assert seg.generated_params == {"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"}


def test_save_project_deletes_audio_file_dropped_by_payload(db_session, tmp_path, monkeypatch):
    """Merge clears a kept segment's audio -> the old file must not be orphaned."""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()

    audio_file = tmp_path / "p1/chapters/c-p1/audio/s-p1.mp3"
    audio_file.parent.mkdir(parents=True, exist_ok=True)
    audio_file.write_bytes(b"fake-mp3")
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p1").one()
    seg.audio = {"current": {"path": "p1/chapters/c-p1/audio/s-p1.mp3", "format": "mp3"}}
    db_session.commit()

    payload = _seed_project()
    payload.chapters[0].segments[0].audio = {"format": "mp3"}
    save_project(db_session, payload)
    db_session.commit()

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p1").one()
    assert (seg.audio or {}).get("current") is None
    assert not audio_file.exists()


def test_save_project_keeps_audio_file_still_referenced_as_previous(db_session, tmp_path, monkeypatch):
    """Regenerate moves old current -> previous; the file must survive the PUT."""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()

    old_file = tmp_path / "p1/chapters/c-p1/audio/s-p1-old.mp3"
    old_file.parent.mkdir(parents=True, exist_ok=True)
    old_file.write_bytes(b"fake-mp3")
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p1").one()
    seg.audio = {"current": {"path": "p1/chapters/c-p1/audio/s-p1-old.mp3", "format": "mp3"}}
    db_session.commit()

    payload = _seed_project()
    payload.chapters[0].segments[0].audio = {
        "current": {"path": "p1/chapters/c-p1/audio/s-p1.mp3", "format": "mp3"},
        "previous": {"path": "p1/chapters/c-p1/audio/s-p1-old.mp3", "format": "mp3"},
    }
    save_project(db_session, payload)
    db_session.commit()

    assert old_file.exists()


def test_save_project_removes_orphan_chapters(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    p = _seed_project()
    p.chapters = []
    save_project(db_session, p)
    db_session.commit()
    assert db_session.query(SegmentedProjectChapter).count() == 0


def test_list_projects_returns_summaries(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project("p1"))
    db_session.commit()
    save_project(db_session, _seed_project("p2", "Two"))
    db_session.commit()
    summaries = list_projects(db_session)
    assert {s.id for s in summaries} == {"p1", "p2"}
    assert all(s.schema_version == 2 for s in summaries)


def test_get_project_detail_round_trip(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    detail = get_project_detail(db_session, "p1")
    assert detail is not None
    assert detail.chapters[0].segments[0].text == "hello"


def test_delete_project_removes_rows_and_dir(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    assert project_dir("p1", "Test").exists()
    delete_project(db_session, "p1")
    db_session.commit()
    assert db_session.query(SegmentedProject).count() == 0
    assert not project_dir("p1", "Test").exists()


def test_to_iso_handles_naive_and_aware():
    assert _to_iso(datetime(2026, 6, 9, 12, 0, 0)) == "2026-06-09T12:00:00"
    assert _to_iso(datetime(2026, 6, 9, 12, 0, 0, tzinfo=timezone.utc)) == "2026-06-09T12:00:00+00:00"


def test_save_project_persists_role_and_segment_kind(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)

    project = _seed_project("p-role")
    project.default_narrator_role_id = "role-narrator"
    project.chapters[0].segments[0].role_id = "role-linxia"
    project.chapters[0].segments[0].segment_kind = "dialogue"
    project.chapters[0].segments[0].voice = {
        "source": "role",
        "role_id": "role-linxia",
        "engine": "edge_tts",
        "name": "林夏",
    }

    save_project(db_session, project)
    db_session.commit()

    detail = get_project_detail(db_session, "p-role")
    assert detail is not None
    assert detail.default_narrator_role_id == "role-narrator"
    segment = detail.chapters[0].segments[0]
    assert segment.role_id == "role-linxia"
    assert segment.segment_kind == "dialogue"
    assert segment.voice["source"] == "role"
    assert segment.voice["name"] == "林夏"


def test_save_project_persists_voice(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)

    project = _seed_project("p-voice")
    project.chapters[0].segments[0].voice = {
        "name": "旁白",
        "source": "role",
        "voice_id": "zh-CN-YunxiNeural",
        "engine": "edge_tts",
        "role_id": "role-narrator",
    }

    save_project(db_session, project)
    db_session.commit()

    detail = get_project_detail(db_session, "p-voice")
    assert detail is not None
    seg = detail.chapters[0].segments[0]
    assert seg.voice is not None
    assert seg.voice["name"] == "旁白"
    assert seg.voice["source"] == "role"
    assert seg.voice["voice_id"] == "zh-CN-YunxiNeural"
    assert seg.voice["engine"] == "edge_tts"
    assert seg.voice["role_id"] == "role-narrator"


def test_project_rename_relocates_assets_and_rewrites_paths(db_session, tmp_path, monkeypatch):
    from app.core import config
    from app.core import segmented_assets as assets
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()

    # plant an audio file under the old slug dir
    old_dir = assets.project_dir("p1", "Test")
    audio_file = old_dir / "chapters" / "c-p1" / "segments" / "s-p1.mp3"
    audio_file.parent.mkdir(parents=True, exist_ok=True)
    audio_file.write_bytes(b"fake")
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p1").one()
    seg.audio = {"current": {"path": f"{old_dir.name}/chapters/c-p1/segments/s-p1.mp3", "format": "mp3"}}
    db_session.commit()

    payload = _seed_project()
    payload.name = "Renamed项目"
    payload.chapters[0].segments[0].audio = {"current": {"path": f"{old_dir.name}/chapters/c-p1/segments/s-p1.mp3", "format": "mp3"}}
    save_project(db_session, payload)
    db_session.commit()

    new_dir = tmp_path / "renamed-xiang-mu"
    assert not old_dir.exists()
    assert (new_dir / "chapters" / "c-p1" / "segments" / "s-p1.mp3").exists()
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p1").one()
    assert seg.audio["current"]["path"] == "renamed-xiang-mu/chapters/c-p1/segments/s-p1.mp3"


def test_project_rename_without_assets_is_noop(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    payload = _seed_project()
    payload.name = "另一个名字"
    save_project(db_session, payload)
    db_session.commit()
    assert db_session.query(SegmentedProject).filter_by(id="p1").one().name == "另一个名字"


# ── D6: Unique constraint on (parent_id, position) ──

def test_save_project_rejects_duplicate_chapter_positions(db_session, tmp_path, monkeypatch):
    """Two chapters at the same position must violate the unique constraint."""
    from app.core import config
    from sqlalchemy.exc import IntegrityError
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)

    project = ProjectIn(
        id="p-dup-ch", name="DupCh", schema_version=2, layout="vertical",
        chapters=[
            {
                "id": "c-dup-1", "position": 0, "name": "A",
                "voice": {"engine": "edge_tts"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "segments": [
                    {"id": "s-dup-1a", "position": 0, "text": "a", "voice": {"source": "chapter"}},
                ],
            },
            {
                "id": "c-dup-2", "position": 0, "name": "B",
                "voice": {"engine": "edge_tts"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "segments": [
                    {"id": "s-dup-2a", "position": 0, "text": "b", "voice": {"source": "chapter"}},
                ],
            },
        ],
    )
    # IntegrityError fires on flush (inside save_project), not on commit.
    # SQLite omits constraint names from error messages; match on column names.
    with pytest.raises(IntegrityError, match="project_id.*position"):
        save_project(db_session, project)
        db_session.commit()


def test_save_project_rejects_duplicate_segment_positions(db_session, tmp_path, monkeypatch):
    """Two segments in the same chapter at the same position must violate the unique constraint."""
    from app.core import config
    from sqlalchemy.exc import IntegrityError
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)

    project = ProjectIn(
        id="p-dup-seg", name="DupSeg", schema_version=2, layout="vertical",
        chapters=[
            {
                "id": "c-dup-seg", "position": 0, "name": "Ch",
                "voice": {"engine": "edge_tts"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "segments": [
                    {"id": "s-dup-a", "position": 0, "text": "a", "voice": {"source": "chapter"}},
                    {"id": "s-dup-b", "position": 0, "text": "b", "voice": {"source": "chapter"}},
                ],
            },
        ],
    )
    with pytest.raises(IntegrityError, match="chapter_id.*position"):
        save_project(db_session, project)
        db_session.commit()
