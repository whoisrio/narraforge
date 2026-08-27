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
