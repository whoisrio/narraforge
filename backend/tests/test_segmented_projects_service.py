from datetime import datetime, timezone

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
                "default_params": {"engine": "edge_tts"},
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
    assert (project_dir("p1") / "original.txt").read_text(encoding="utf-8") == "全文"
    m = read_manifest("p1")
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
    assert project_dir("p1").exists()
    delete_project(db_session, "p1")
    db_session.commit()
    assert db_session.query(SegmentedProject).count() == 0
    assert not project_dir("p1").exists()


def test_to_iso_handles_naive_and_aware():
    assert _to_iso(datetime(2026, 6, 9, 12, 0, 0)) == "2026-06-09T12:00:00"
    assert _to_iso(datetime(2026, 6, 9, 12, 0, 0, tzinfo=timezone.utc)) == "2026-06-09T12:00:00+00:00"


def test_save_project_persists_role_and_segment_kind(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)

    project = _seed_project("p-role")
    project.default_narrator_role_id = "role-narrator"
    project.default_narrator_snapshot = {
        "id": "role-narrator",
        "name": "旁白",
    }
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
    assert detail.default_narrator_snapshot["name"] == "旁白"
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
