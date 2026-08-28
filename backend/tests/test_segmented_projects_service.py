from datetime import datetime, timezone
from pathlib import Path

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


def test_save_project_keeps_audio_file_dropped_by_payload(db_session, tmp_path, monkeypatch):
    """A PUT whose payload drops a kept segment's audio must NOT delete the
    file. The big PUT is a state save, not a file GC: a stale payload racing
    synthesis (batch autosave snapshot predating a just-committed segment
    audio) must never destroy the file the DB points at (2026-08-27 batch
    synthesis → 409 audio_missing incident). Dropped/orphaned files are
    reclaimed by an explicit sweep, never by a save."""
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
    # 服务端自产字段：payload 的清空被忽略，DB 保留合成结果（Phase 1）
    assert seg.audio["current"]["path"] == "p1/chapters/c-p1/audio/s-p1.mp3"
    assert audio_file.exists()


def test_save_project_keeps_orphan_segment_audio_files(db_session, tmp_path, monkeypatch):
    """A PUT that drops a whole segment (e.g. stale snapshot from before a
    re-split) deletes the DB row but must leave the audio file on disk."""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    project = _seed_project()
    project.chapters[0].segments = [
        *project.chapters[0].segments,
        type(project.chapters[0].segments[0])(
            id="s-p1-b", position=1, text="world", voice={"source": "chapter"},
        ),
    ]
    save_project(db_session, project)
    db_session.commit()

    audio_file = tmp_path / "p1/chapters/c-p1/audio/s-p1-b.mp3"
    audio_file.parent.mkdir(parents=True, exist_ok=True)
    audio_file.write_bytes(b"fake-mp3")
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p1-b").one()
    seg.audio = {"current": {"path": "p1/chapters/c-p1/audio/s-p1-b.mp3", "format": "mp3"}}
    db_session.commit()

    save_project(db_session, _seed_project())  # payload without s-p1-b
    db_session.commit()

    assert db_session.query(SegmentedProjectSegment).filter_by(id="s-p1-b").first() is None
    assert audio_file.exists()


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


# ── 乐观锁与服务端自产字段保护（2026-08-27 粒度重构 Phase 1）──


def test_save_project_rejects_stale_base_updated_at(db_session, tmp_path, monkeypatch):
    """base_updated_at 与 DB 当前 updated_at 不符 → StalePayloadError。"""
    from app.core import config
    from app.schemas.segmented_project import StalePayloadError
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()

    stale = _seed_project()
    stale.base_updated_at = "2000-01-01T00:00:00"
    with pytest.raises(StalePayloadError):
        save_project(db_session, stale)
    db_session.rollback()


def test_save_project_accepts_matching_base_updated_at(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    detail = save_project(db_session, _seed_project())
    db_session.commit()

    payload = _seed_project()
    payload.name = "Renamed"
    payload.base_updated_at = detail.updated_at
    out = save_project(db_session, payload)
    db_session.commit()
    assert out.name == "Renamed"


def test_save_project_without_base_updated_at_is_accepted(db_session, tmp_path, monkeypatch):
    """老客户端/agent 不带 base_updated_at → 放行（向后兼容）。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()

    payload = _seed_project()
    payload.name = "Legacy Save"
    out = save_project(db_session, payload)
    db_session.commit()
    assert out.name == "Legacy Save"


def test_save_project_ignores_server_owned_fields_for_existing_segments(db_session, tmp_path, monkeypatch):
    """已存在的段：payload 的 audio/generated_params/generated_at 一律忽略，
    保留 DB 现值（服务端自产字段）。陈旧 autosave 不得回退合成结果。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p1").one()
    seg.audio = {"current": {"path": "p1/chapters/c-p1/audio/s-p1.mp3", "format": "mp3"}}
    seg.generated_params = {"engine": "edge_tts", "edge_voice": "zh-CN-YunxiNeural"}
    seg.generated_at = datetime(2026, 8, 27, 1, 11, 0)
    db_session.commit()

    payload = _seed_project()
    payload.chapters[0].segments[0].text = "edited text"  # 客户端字段照常生效
    payload.chapters[0].segments[0].audio = {"format": "mp3"}  # 被清空（陈旧快照）
    payload.chapters[0].segments[0].generated_params = {"engine": "evil"}
    payload.chapters[0].segments[0].generated_at = None
    save_project(db_session, payload)
    db_session.commit()

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p1").one()
    assert seg.text == "edited text"
    assert seg.audio["current"]["path"] == "p1/chapters/c-p1/audio/s-p1.mp3"
    assert seg.generated_params == {"engine": "edge_tts", "edge_voice": "zh-CN-YunxiNeural"}
    assert seg.generated_at == datetime(2026, 8, 27, 1, 11, 0)


def test_save_project_accepts_server_owned_fields_for_new_segments(db_session, tmp_path, monkeypatch):
    """新建的段（create/import 播种场景）：payload 的 audio 等字段照常接收。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()

    payload = _seed_project()
    seg_in_cls = type(payload.chapters[0].segments[0])
    payload.chapters[0].segments.append(seg_in_cls(
        id="s-p1-new", position=1, text="new",
        voice={"source": "chapter"},
        audio={"current": {"path": "p1/chapters/c-p1/audio/s-p1-new.mp3", "format": "mp3"}},
        generated_params={"engine": "edge_tts"},
    ))
    save_project(db_session, payload)
    db_session.commit()

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p1-new").one()
    assert seg.audio["current"]["path"] == "p1/chapters/c-p1/audio/s-p1-new.mp3"
    assert seg.generated_params == {"engine": "edge_tts"}


def test_patch_segment_voice_change_writes_sql_null_not_json_null_text(db_session, tmp_path, monkeypatch):
    """回归（2026-08-27 e2e 全灭）：voice 变更把 generated_params 置空时，
    列里必须是 SQL NULL，不是文本 'null'。JSON 列 none_as_null=False 的默认
    行为会把 None 序列化成 'null' 字符串，ORM 读回无感，但裸 SQL 读者
    （e2e dbReader、迁移脚本）会看到 'null'。"""
    from sqlalchemy import text as sql_text
    from app.core import config
    from app.schemas.segmented_project import SegmentPatchIn
    from app.services.segmented_project_service import patch_segment

    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p1").one()
    seg.generated_params = {"engine": "edge_tts"}
    db_session.commit()

    patch_segment(db_session, "p1", "c-p1", "s-p1",
                  SegmentPatchIn(voice={"source": "custom", "engine": "edge_tts"}))

    raw = db_session.execute(
        sql_text("SELECT generated_params FROM segmented_project_segments WHERE id = 's-p1'")
    ).scalar()
    assert raw is None


# ── 段结构端点 service（2026-08-27 粒度重构 Phase 3）──

from app.schemas.segmented_project import StructureSegmentIn
from app.services.segmented_project_service import (
    create_segment,
    reconcile_chapter_structure,
)


def _seed_three_segment_project(pid: str = "p-struct") -> ProjectIn:
    """单章三段（s1/s2/s3，position 0/1/2），用于结构端点测试。"""
    return ProjectIn(
        id=pid, name="Struct", schema_version=2, layout="vertical",
        chapters=[
            {
                "id": f"c-{pid}", "position": 0, "name": "第一章",
                "voice": {"engine": "edge_tts"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "segments": [
                    {"id": f"{pid}-s1", "position": 0, "text": "一", "voice": {"source": "chapter"}},
                    {"id": f"{pid}-s2", "position": 1, "text": "二", "voice": {"source": "chapter"}},
                    {"id": f"{pid}-s3", "position": 2, "text": "三", "voice": {"source": "chapter"}},
                ],
            }
        ],
    )


def test_create_segment_appends_to_chapter_end(db_session, tmp_path, monkeypatch):
    """after_id 缺省/None → 追加到章末。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    detail = save_project(db_session, _seed_three_segment_project())
    db_session.commit()

    result = create_segment(db_session, "p-struct", "c-p-struct", text="新段")
    assert result is not None
    seg_in, positions, project_updated_at = result
    assert seg_in.text == "新段"
    assert seg_in.position == 3
    assert seg_in.id  # 服务端 uuid4
    assert [p["id"] for p in positions] == [
        "p-struct-s1", "p-struct-s2", "p-struct-s3", seg_in.id,
    ]
    assert [p["position"] for p in positions] == [0, 1, 2, 3]
    assert project_updated_at != detail.updated_at  # 项目 updated_at 推进

    # DB 回读一致
    segs = (
        db_session.query(SegmentedProjectSegment)
        .filter_by(chapter_id="c-p-struct").order_by(SegmentedProjectSegment.position).all()
    )
    assert [s.id for s in segs] == ["p-struct-s1", "p-struct-s2", "p-struct-s3", seg_in.id]
    assert segs[-1].segment_kind == "narration"
    assert segs[-1].voice == {"source": "chapter"}


def test_create_segment_empty_text_is_legal(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_three_segment_project())
    db_session.commit()
    seg_in, _, _ = create_segment(db_session, "p-struct", "c-p-struct")
    assert seg_in.text == ""


def test_create_segment_inserts_after_anchor_and_shifts(db_session, tmp_path, monkeypatch):
    """after_id 命中章内段 → 插到它后面，后续段 position 平移（两阶段防 UNIQUE 冲突）。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_three_segment_project())
    db_session.commit()

    seg_in, positions, _ = create_segment(
        db_session, "p-struct", "c-p-struct", text="插队", after_id="p-struct-s1",
    )
    assert seg_in.position == 1
    assert [p["id"] for p in positions] == [
        "p-struct-s1", seg_in.id, "p-struct-s2", "p-struct-s3",
    ]
    assert [p["position"] for p in positions] == [0, 1, 2, 3]

    segs = (
        db_session.query(SegmentedProjectSegment)
        .filter_by(chapter_id="c-p-struct").order_by(SegmentedProjectSegment.position).all()
    )
    assert [s.id for s in segs] == ["p-struct-s1", seg_in.id, "p-struct-s2", "p-struct-s3"]
    # 最终 position 唯一且连续
    assert [s.position for s in segs] == [0, 1, 2, 3]


def test_create_segment_missing_chapter_returns_none(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_three_segment_project())
    db_session.commit()
    assert create_segment(db_session, "p-struct", "c-nope", text="x") is None
    assert create_segment(db_session, "p-nope", "c-p-struct", text="x") is None


def test_create_segment_unknown_after_id_raises(db_session, tmp_path, monkeypatch):
    """after_id 在章内无对应段 → ValueError（路由映射 404 segment_not_found）。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_three_segment_project())
    db_session.commit()
    with pytest.raises(ValueError, match="after_segment_not_found"):
        create_segment(db_session, "p-struct", "c-p-struct", text="x", after_id="s-ghost")
    db_session.rollback()


def test_structure_reconcile_add_update_delete_reorder(db_session, tmp_path, monkeypatch):
    """一次 reconcile 混合：更新 s2 文本、删 s1、s3 提到最前、新建一段。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_three_segment_project())
    db_session.commit()

    result = reconcile_chapter_structure(
        db_session, "p-struct", "c-p-struct",
        [
            StructureSegmentIn(id="p-struct-s3", text="三", position=0),
            StructureSegmentIn(id=None, text="新段", position=1),
            StructureSegmentIn(id="p-struct-s2", text="二（改）", position=2),
        ],
    )
    assert result is not None
    segments, _ = result
    assert [s.id for s in segments][:1] == ["p-struct-s3"]
    assert [s.position for s in segments] == [0, 1, 2]
    assert segments[1].id and segments[1].text == "新段"
    assert segments[2].text == "二（改）"

    db_session.expire_all()
    segs = (
        db_session.query(SegmentedProjectSegment)
        .filter_by(chapter_id="c-p-struct").order_by(SegmentedProjectSegment.position).all()
    )
    assert [s.id for s in segs] == [s.id for s in segments]
    assert [s.position for s in segs] == [0, 1, 2]  # 唯一且连续
    # s1 的 DB 行已删
    assert db_session.query(SegmentedProjectSegment).filter_by(id="p-struct-s1").first() is None
    # 其余章节不受影响（这里是单章项目，验证项目本身还在）
    assert db_session.query(SegmentedProject).filter_by(id="p-struct").one().name == "Struct"


def test_structure_reconcile_keeps_dropped_segment_audio_file(db_session, tmp_path, monkeypatch):
    """被 payload 丢弃的段：DB 行删除，但盘上音频文件保留（原则 2，待 sweep）。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_three_segment_project())
    db_session.commit()

    audio_file = tmp_path / "p-struct/chapters/c-p-struct/audio/p-struct-s2.mp3"
    audio_file.parent.mkdir(parents=True, exist_ok=True)
    audio_file.write_bytes(b"fake-mp3")
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="p-struct-s2").one()
    seg.audio = {"current": {"path": "p-struct/chapters/c-p-struct/audio/p-struct-s2.mp3", "format": "mp3"}}
    db_session.commit()

    reconcile_chapter_structure(
        db_session, "p-struct", "c-p-struct",
        [
            StructureSegmentIn(id="p-struct-s1", text="一", position=0),
            StructureSegmentIn(id="p-struct-s3", text="三", position=1),
        ],
    )
    assert db_session.query(SegmentedProjectSegment).filter_by(id="p-struct-s2").first() is None
    assert audio_file.exists()


def test_structure_reconcile_preserves_server_owned_fields(db_session, tmp_path, monkeypatch):
    """已存在段的 audio/generated_params/generated_at 不被 structure payload 覆盖
    （文本未变、纯重排场景）。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_three_segment_project())
    db_session.commit()

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="p-struct-s1").one()
    seg.audio = {"current": {"path": "p-struct/c/audio/s1.mp3", "format": "mp3"}}
    seg.generated_params = {"engine": "edge_tts"}
    seg.generated_at = datetime(2026, 8, 27, 1, 11, 0)
    db_session.commit()

    reconcile_chapter_structure(
        db_session, "p-struct", "c-p-struct",
        [StructureSegmentIn(id="p-struct-s1", text="一", position=2)],
    )
    db_session.expire_all()
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="p-struct-s1").one()
    assert seg.text == "一"
    assert seg.position == 2
    assert seg.audio["current"]["path"] == "p-struct/c/audio/s1.mp3"
    assert seg.generated_params == {"engine": "edge_tts"}
    assert seg.generated_at == datetime(2026, 8, 27, 1, 11, 0)


def test_structure_reconcile_text_change_demotes_audio(db_session, tmp_path, monkeypatch):
    """结构性文本变更（合并等）使旧音频失效：current 降级 previous、文件保留、
    generated_params/generated_at 置空（原则 4，与 patch_segment 的 voice 变更同语义）。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_three_segment_project())
    db_session.commit()

    audio_file = tmp_path / "p-struct/c/audio/s1.mp3"
    audio_file.parent.mkdir(parents=True, exist_ok=True)
    audio_file.write_bytes(b"fake-mp3")
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="p-struct-s1").one()
    seg.audio = {
        "current": {"path": "p-struct/c/audio/s1.mp3", "format": "mp3", "duration_sec": 1.5},
        "duration_sec": 1.5,
    }
    seg.generated_params = {"engine": "edge_tts"}
    seg.generated_at = datetime(2026, 8, 27, 1, 11, 0)
    db_session.commit()

    result = reconcile_chapter_structure(
        db_session, "p-struct", "c-p-struct",
        [StructureSegmentIn(id="p-struct-s1", text="一（合并后）", position=0)],
    )
    assert result is not None
    merged = result[0][0]
    assert merged.audio is not None
    assert merged.audio.get("current") is None
    assert merged.audio["previous"]["path"] == "p-struct/c/audio/s1.mp3"
    assert merged.generated_params is None
    assert merged.generated_at is None
    assert audio_file.exists()  # 文件保留在盘上，可撤销


def test_structure_reconcile_seeds_unknown_id_as_new(db_session, tmp_path, monkeypatch):
    """payload 带 id 但该章无此行 → 按新建处理（用给定 id 播种，对齐 save_project）。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_three_segment_project())
    db_session.commit()

    segments, _ = reconcile_chapter_structure(
        db_session, "p-struct", "c-p-struct",
        [StructureSegmentIn(id="s-seeded", text="播种段", position=3)],
    )
    seeded = next(s for s in segments if s.id == "s-seeded")
    assert seeded.text == "播种段"
    row = db_session.query(SegmentedProjectSegment).filter_by(id="s-seeded").one()
    assert row.chapter_id == "c-p-struct"
    assert row.position == 3


def test_structure_reconcile_missing_chapter_returns_none(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_three_segment_project())
    db_session.commit()
    assert reconcile_chapter_structure(db_session, "p-struct", "c-nope", []) is None


def test_structure_reconcile_bumps_chapter_and_project_updated_at(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_three_segment_project())
    db_session.commit()
    ch_before = db_session.query(SegmentedProjectChapter).filter_by(id="c-p-struct").one().updated_at
    proj_before = db_session.query(SegmentedProject).filter_by(id="p-struct").one().updated_at

    _, project_updated_at = reconcile_chapter_structure(
        db_session, "p-struct", "c-p-struct",
        [StructureSegmentIn(id="p-struct-s1", text="一", position=0)],
    )
    db_session.expire_all()
    ch_after = db_session.query(SegmentedProjectChapter).filter_by(id="c-p-struct").one().updated_at
    proj_after = db_session.query(SegmentedProject).filter_by(id="p-struct").one().updated_at
    assert ch_after > ch_before
    assert proj_after > proj_before
    assert project_updated_at == _to_iso(proj_after)


# ── 章节操作端点 service（2026-08-27 粒度重构 Phase 4）──

from app.schemas.segmented_project import ChapterPatchIn
from app.services.segmented_project_service import (
    create_chapter,
    patch_chapter,
    delete_chapter,
    reorder_chapters,
)


def test_create_chapter_appends_position_and_defaults(db_session, tmp_path, monkeypatch):
    """建章追加到末尾（现有最大 position + 1），默认字段对齐建章惯例
    （voice={}、默认 split_config），项目 updated_at 推进。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    detail = save_project(db_session, _seed_two_chapter_project())
    db_session.commit()

    result = create_chapter(db_session, "p1", name="第三章")
    assert result is not None
    ch_in, project_updated_at = result
    assert ch_in.name == "第三章"
    assert ch_in.position == 2
    assert ch_in.id  # 服务端 uuid4
    assert ch_in.voice == {}
    assert ch_in.split_config == {"delimiters": ["，", "。", "！", "？", "；"], "mode": "rule"}
    assert ch_in.segments == []
    assert project_updated_at != detail.updated_at

    db_session.expire_all()
    rows = (
        db_session.query(SegmentedProjectChapter)
        .filter_by(project_id="p1").order_by(SegmentedProjectChapter.position).all()
    )
    assert [c.id for c in rows] == ["c-a-p1", "c-b-p1", ch_in.id]
    assert [c.position for c in rows] == [0, 1, 2]


def test_create_chapter_missing_project_returns_none(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert create_chapter(db_session, "p-nope", name="x") is None


def test_patch_chapter_partial_update_leaves_others_untouched(db_session, tmp_path, monkeypatch):
    """tri-state：只更新出现的字段；缺省字段（voice/split_config/design_title）不动。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_two_chapter_project())
    db_session.commit()

    ch_in, project_updated_at = patch_chapter(
        db_session, "p1", "c-a-p1", ChapterPatchIn(name="甲章（改）"),
    )
    assert ch_in.name == "甲章（改）"
    assert ch_in.voice == {"engine": "edge_tts"}  # 缺省不动
    assert ch_in.split_config == {"delimiters": ["。"], "mode": "rule"}
    assert ch_in.design_title is None
    assert project_updated_at

    # voice / split_config / design_title 可各自独立更新；显式 null 清空 design_title
    ch_in, _ = patch_chapter(
        db_session, "p1", "c-a-p1",
        ChapterPatchIn(voice={"engine": "cosyvoice", "voice_id": "v9"},
                       design_title="分镜标题"),
    )
    assert ch_in.name == "甲章（改）"  # 上轮结果保持
    assert ch_in.voice == {"engine": "cosyvoice", "voice_id": "v9"}
    assert ch_in.design_title == "分镜标题"
    ch_in, _ = patch_chapter(db_session, "p1", "c-a-p1", ChapterPatchIn(design_title=None))
    assert ch_in.design_title is None

    db_session.expire_all()
    row = db_session.query(SegmentedProjectChapter).filter_by(id="c-a-p1").one()
    assert row.name == "甲章（改）"
    assert row.voice == {"engine": "cosyvoice", "voice_id": "v9"}
    assert row.design_title is None
    # 其他章节不受影响
    other = db_session.query(SegmentedProjectChapter).filter_by(id="c-b-p1").one()
    assert other.name == "B"


def test_patch_chapter_missing_returns_none(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_two_chapter_project())
    db_session.commit()
    assert patch_chapter(db_session, "p1", "c-nope", ChapterPatchIn(name="x")) is None
    assert patch_chapter(db_session, "p-nope", "c-a-p1", ChapterPatchIn(name="x")) is None


def test_delete_chapter_cascades_segments_but_keeps_audio_files(db_session, tmp_path, monkeypatch):
    """删章：段行级联删除，**音频文件保留在盘上**（Phase 6 sweep 回收），
    项目 updated_at 推进。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    detail = save_project(db_session, _seed_two_chapter_project())
    db_session.commit()

    audio_file = tmp_path / "p1/chapters/c-a-p1/audio/s-a1-p1.mp3"
    audio_file.parent.mkdir(parents=True, exist_ok=True)
    audio_file.write_bytes(b"fake-mp3")
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-a1-p1").one()
    seg.audio = {"current": {"path": "p1/chapters/c-a-p1/audio/s-a1-p1.mp3", "format": "mp3"}}
    db_session.commit()

    project_updated_at = delete_chapter(db_session, "p1", "c-a-p1")
    assert project_updated_at is not None
    assert project_updated_at != detail.updated_at

    db_session.expire_all()
    assert db_session.query(SegmentedProjectChapter).filter_by(id="c-a-p1").first() is None
    assert db_session.query(SegmentedProjectSegment).filter_by(chapter_id="c-a-p1").count() == 0
    assert audio_file.exists()  # 文件保留，绝不在这里删
    # 其余章节不受影响
    assert db_session.query(SegmentedProjectChapter).filter_by(id="c-b-p1").one().name == "B"
    assert db_session.query(SegmentedProjectSegment).filter_by(chapter_id="c-b-p1").count() == 2


def test_delete_chapter_missing_returns_none(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_two_chapter_project())
    db_session.commit()
    assert delete_chapter(db_session, "p1", "c-nope") is None
    assert delete_chapter(db_session, "p-nope", "c-a-p1") is None


def test_reorder_chapters_swaps_positions(db_session, tmp_path, monkeypatch):
    """交换重排：负哨兵两阶段防 uq_chapter_project_position 唯一约束冲突。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    detail = save_project(db_session, _seed_two_chapter_project())
    db_session.commit()

    result, project_updated_at = reorder_chapters(db_session, "p1", ["c-b-p1", "c-a-p1"])
    assert [(c["id"], c["position"]) for c in result] == [("c-b-p1", 0), ("c-a-p1", 1)]
    assert [c["name"] for c in result] == ["B", "A"]
    assert project_updated_at != detail.updated_at

    db_session.expire_all()
    rows = (
        db_session.query(SegmentedProjectChapter)
        .filter_by(project_id="p1").order_by(SegmentedProjectChapter.position).all()
    )
    assert [c.id for c in rows] == ["c-b-p1", "c-a-p1"]
    assert [c.position for c in rows] == [0, 1]
    # GET 回读一致
    assert [c.id for c in get_project_detail(db_session, "p1").chapters] == ["c-b-p1", "c-a-p1"]


def test_reorder_chapters_mismatch_raises(db_session, tmp_path, monkeypatch):
    """chapter_ids 缺/多/未知/重复 → ValueError（路由映射 422 chapter_ids_mismatch）。"""
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_two_chapter_project())
    db_session.commit()

    # 校验在任何写操作之前抛出，无需 rollback
    for bad in (["c-a-p1"], ["c-a-p1", "c-b-p1", "c-ghost"],
                ["c-a-p1", "c-a-p1"], ["c-a-p1", "c-ghost"], []):
        with pytest.raises(ValueError, match="chapter_ids_mismatch"):
            reorder_chapters(db_session, "p1", bad)

    # 校验失败后原序保持
    assert [c.id for c in get_project_detail(db_session, "p1").chapters] == ["c-a-p1", "c-b-p1"]


def test_reorder_chapters_missing_project_returns_none(db_session, tmp_path, monkeypatch):
    from app.core import config
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert reorder_chapters(db_session, "p-nope", []) is None


# ----- 项目元信息 + 文档层（D/E 类：粒度重构 Phase 5） -----


def _seed_meta_project(pid: str = "p-meta") -> ProjectIn:
    """带全部可 PATCH 元字段的种子项目。"""
    return ProjectIn(
        id=pid, name="元信息项目", schema_version=2, layout="vertical",
        configs={"description": "旧描述", "export_directory": "/tmp/old"},
        default_narrator_role_id="role-old",
        logo="old-logo.png",
        animation_theme="dark-gold",
        remotion_project_path="/tmp/old-remotion",
        chapters=[
            {
                "id": f"c-{pid}", "position": 0, "name": "第一章",
                "voice": {"engine": "edge_tts"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "segments": [
                    {"id": f"s-{pid}", "position": 0, "text": "hello",
                     "voice": {"source": "chapter"}},
                ],
            }
        ],
    )


def test_patch_project_partial_update_leaves_others_untouched(db_session, tmp_path, monkeypatch):
    """tri-state：只更新出现的字段；缺省字段不动；显式 null 清空。"""
    from app.core import config
    from app.schemas.segmented_project import ProjectPatchIn
    from app.services.segmented_project_service import patch_project
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    detail = save_project(db_session, _seed_meta_project())
    db_session.commit()

    # 只改 name：其余字段不动
    result = patch_project(db_session, "p-meta", ProjectPatchIn(name="新名字"))
    assert result is not None
    assert result.name == "新名字"
    assert result.layout == "vertical"
    assert result.configs == {"description": "旧描述", "export_directory": "/tmp/old"}
    assert result.default_narrator_role_id == "role-old"
    assert result.logo == "old-logo.png"
    assert result.animation_theme == "dark-gold"
    assert result.remotion_project_path == "/tmp/old-remotion"
    assert result.updated_at != detail.updated_at  # 项目版本推进

    # layout/configs 独立更新
    result = patch_project(
        db_session, "p-meta",
        ProjectPatchIn(layout="horizontal", configs={"description": "新描述"}),
    )
    assert result.layout == "horizontal"
    assert result.configs == {"description": "新描述"}
    assert result.name == "新名字"  # 上轮结果保持

    # 显式 null 清空可空字段
    result = patch_project(
        db_session, "p-meta",
        ProjectPatchIn(
            logo=None, default_narrator_role_id=None,
            animation_theme=None, remotion_project_path=None,
        ),
    )
    assert result.logo is None
    assert result.default_narrator_role_id is None
    assert result.animation_theme is None
    assert result.remotion_project_path is None

    db_session.expire_all()
    row = db_session.query(SegmentedProject).filter_by(id="p-meta").one()
    assert row.name == "新名字"
    assert row.layout == "horizontal"
    assert row.logo is None
    assert row.default_narrator_role_id is None


def test_patch_project_rename_relocates_assets_and_rewrites_paths(db_session, tmp_path, monkeypatch):
    """改名：资产目录搬迁、audio/文档路径前缀重写、manifest 随迁且内容刷新。"""
    from app.core import config
    from app.schemas.segmented_project import ProjectPatchIn
    from app.services.segmented_project_service import patch_project
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_meta_project())
    db_session.commit()

    # 造资产：段音频文件 + 源文档
    old_dir = project_dir("p-meta", "元信息项目")
    audio_file = old_dir / "chapters" / "c-p-meta" / "audio" / "s-p-meta.mp3"
    audio_file.parent.mkdir(parents=True, exist_ok=True)
    audio_file.write_bytes(b"fake-mp3")
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p-meta").one()
    old_prefix = old_dir.name
    seg.audio = {"current": {"path": f"{old_prefix}/chapters/c-p-meta/audio/s-p-meta.mp3",
                             "format": "mp3"}}
    db_session.commit()

    result = patch_project(db_session, "p-meta", ProjectPatchIn(name="搬迁后的项目"))
    assert result is not None
    assert result.name == "搬迁后的项目"

    new_dir = project_dir("p-meta", "搬迁后的项目")
    assert new_dir.exists() and not old_dir.exists()
    # 音频文件随目录搬迁，且仍可经新路径读到
    new_file = new_dir / "chapters" / "c-p-meta" / "audio" / "s-p-meta.mp3"
    assert new_file.read_bytes() == b"fake-mp3"
    # DB 内 audio 路径前缀已重写
    db_session.expire_all()
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s-p-meta").one()
    new_prefix = new_dir.name
    assert seg.audio["current"]["path"] == f"{new_prefix}/chapters/c-p-meta/audio/s-p-meta.mp3"
    # manifest 落在新目录且 name 已刷新
    m = read_manifest("p-meta", "搬迁后的项目")
    assert m is not None
    assert m["name"] == "搬迁后的项目"


def test_patch_project_missing_returns_none(db_session, tmp_path, monkeypatch):
    from app.core import config
    from app.schemas.segmented_project import ProjectPatchIn
    from app.services.segmented_project_service import patch_project
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert patch_project(db_session, "p-nope", ProjectPatchIn(name="x")) is None


def test_put_source_document_writes_file_and_updates_path(db_session, tmp_path, monkeypatch):
    """PUT source-document：写文件、更新 source_document_path、清空遗留文本列，
    detail 回读新内容，manifest 同步刷新。"""
    from app.core import config
    from app.services.segmented_project_service import (
        get_project_detail, put_source_document,
    )
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_meta_project())
    db_session.commit()

    path, project_updated_at = put_source_document(db_session, "p-meta", "# 新源文档\n正文。")
    assert path is not None
    assert project_updated_at
    p = Path(path)
    assert p.exists()
    assert p.read_text(encoding="utf-8") == "# 新源文档\n正文。"

    db_session.expire_all()
    row = db_session.query(SegmentedProject).filter_by(id="p-meta").one()
    assert row.source_document_path == path
    assert row.source_document is None  # 遗留列清空
    detail = get_project_detail(db_session, "p-meta")
    assert detail.source_document == "# 新源文档\n正文。"
    assert detail.updated_at == project_updated_at
    m = read_manifest("p-meta", "元信息项目")
    assert m is not None and m["source_document"] == "# 新源文档\n正文。"


def test_put_narration_script_writes_file_and_updates_path(db_session, tmp_path, monkeypatch):
    from app.core import config
    from app.services.segmented_project_service import (
        get_project_detail, put_narration_script,
    )
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    detail = save_project(db_session, _seed_meta_project())
    db_session.commit()

    path, project_updated_at = put_narration_script(db_session, "p-meta", "完整旁白稿 v2")
    assert path is not None
    assert Path(path).read_text(encoding="utf-8") == "完整旁白稿 v2"
    assert project_updated_at != detail.updated_at

    db_session.expire_all()
    row = db_session.query(SegmentedProject).filter_by(id="p-meta").one()
    assert row.narration_document_path == path
    assert get_project_detail(db_session, "p-meta").narration_script == "完整旁白稿 v2"


def test_put_project_document_missing_project_returns_none(db_session, tmp_path, monkeypatch):
    from app.core import config
    from app.services.segmented_project_service import (
        put_narration_script, put_source_document,
    )
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    assert put_source_document(db_session, "p-nope", "x") is None
    assert put_narration_script(db_session, "p-nope", "x") is None


# ----- 孤儿音频文件 sweep（粒度重构 Phase 6） -----


def _plant_segment_audio(
    db_session, pid: str, seg_id: str, *, prefix: str,
    current: str | None, previous: str | None = None,
) -> None:
    """把段行挂上音频引用（current/previous 为 segmented_dir 相对路径）。"""
    audio: dict = {}
    if current:
        audio["current"] = {"path": current, "format": "mp3"}
    if previous:
        audio["previous"] = {"path": previous, "format": "mp3"}
    seg = db_session.query(SegmentedProjectSegment).filter_by(id=seg_id).one()
    seg.audio = audio or None
    db_session.commit()


def test_sweep_orphan_audio_dry_run_reports_but_keeps_files(db_session, tmp_path, monkeypatch):
    """dry-run 默认：只报告，不删任何文件。引用文件（current/previous/.prev）
    绝不上报；孤儿 mp3/wav 上报；.txt 镜像等非音频不动。"""
    from app.core import config
    from app.services.segmented_project_service import sweep_orphan_audio
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    prefix = project_dir("p1", "Test").name

    segs_dir = project_dir("p1", "Test") / "chapters" / "c-p1" / "segments"
    segs_dir.mkdir(parents=True, exist_ok=True)
    # 被引用：current + previous（.prev.mp3 命名惯例）
    (segs_dir / "s-p1.mp3").write_bytes(b"cur")
    (segs_dir / "s-p1.prev.mp3").write_bytes(b"prev")
    _plant_segment_audio(
        db_session, "p1", "s-p1",
        prefix=prefix,
        current=f"{prefix}/chapters/c-p1/segments/s-p1.mp3",
        previous=f"{prefix}/chapters/c-p1/segments/s-p1.prev.mp3",
    )
    # 孤儿：段已删/无引用的音频 + 文本镜像
    (segs_dir / "s-ghost.mp3").write_bytes(b"orphan-1")
    (segs_dir / "s-ghost.wav").write_bytes(b"orphan-2")
    (segs_dir / "s-ghost.txt").write_text("text mirror", encoding="utf-8")
    # 别的章目录下的孤儿（删章遗留）
    other = project_dir("p1", "Test") / "chapters" / "c-deleted" / "segments"
    other.mkdir(parents=True, exist_ok=True)
    (other / "s-x.mp3").write_bytes(b"orphan-3")

    report = sweep_orphan_audio(db_session, execute=False)
    assert report["dry_run"] is True
    got = {o["path"] for o in report["orphans"]}
    assert got == {
        f"{prefix}/chapters/c-p1/segments/s-ghost.mp3",
        f"{prefix}/chapters/c-p1/segments/s-ghost.wav",
        f"{prefix}/chapters/c-deleted/segments/s-x.mp3",
    }
    assert report["total_count"] == 3
    assert report["total_size_bytes"] == len(b"orphan-1") + len(b"orphan-2") + len(b"orphan-3")
    # dry-run 不删文件
    assert (segs_dir / "s-ghost.mp3").exists()
    assert (other / "s-x.mp3").exists()
    assert "deleted_count" not in report or report["deleted_count"] == 0


def test_sweep_orphan_audio_execute_deletes_orphans_only(db_session, tmp_path, monkeypatch):
    """execute=True：删孤儿文件，引用文件（含 previous）与非音频文件保留。"""
    from app.core import config
    from app.services.segmented_project_service import sweep_orphan_audio
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()
    prefix = project_dir("p1", "Test").name

    segs_dir = project_dir("p1", "Test") / "chapters" / "c-p1" / "segments"
    segs_dir.mkdir(parents=True, exist_ok=True)
    (segs_dir / "s-p1.mp3").write_bytes(b"cur")
    (segs_dir / "s-p1.prev.mp3").write_bytes(b"prev")
    _plant_segment_audio(
        db_session, "p1", "s-p1", prefix=prefix,
        current=f"{prefix}/chapters/c-p1/segments/s-p1.mp3",
        previous=f"{prefix}/chapters/c-p1/segments/s-p1.prev.mp3",
    )
    (segs_dir / "s-ghost.mp3").write_bytes(b"orphan")
    (segs_dir / "s-ghost.txt").write_text("mirror", encoding="utf-8")

    report = sweep_orphan_audio(db_session, execute=True)
    assert report["dry_run"] is False
    assert report["deleted_count"] == 1
    # 孤儿已删；引用与非音频保留
    assert not (segs_dir / "s-ghost.mp3").exists()
    assert (segs_dir / "s-p1.mp3").exists()
    assert (segs_dir / "s-p1.prev.mp3").exists()
    assert (segs_dir / "s-ghost.txt").exists()


def test_sweep_orphan_audio_absolute_referenced_path_kept(db_session, tmp_path, monkeypatch):
    """引用路径为绝对路径（adjust-audio 等历史写入）时同样视为被引用。"""
    from app.core import config
    from app.services.segmented_project_service import sweep_orphan_audio
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()

    segs_dir = project_dir("p1", "Test") / "chapters" / "c-p1" / "segments"
    segs_dir.mkdir(parents=True, exist_ok=True)
    abs_path = segs_dir / "s-p1.mp3"
    abs_path.write_bytes(b"cur")
    _plant_segment_audio(db_session, "p1", "s-p1", prefix="", current=str(abs_path))

    report = sweep_orphan_audio(db_session, execute=True)
    assert report["deleted_count"] == 0
    assert abs_path.exists()


def test_sweep_orphan_audio_empty_and_missing_root(db_session, tmp_path, monkeypatch):
    """无孤儿时报告为空；segmented_dir 不存在时不炸。"""
    from app.core import config
    from app.services.segmented_project_service import sweep_orphan_audio
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    save_project(db_session, _seed_project())
    db_session.commit()

    report = sweep_orphan_audio(db_session, execute=True)
    assert report["total_count"] == 0
    assert report["orphans"] == []

    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path / "nope-root")
    report = sweep_orphan_audio(db_session, execute=False)
    assert report["total_count"] == 0
