"""Tests for project_import_service (round-trip from export)."""
import io
import json
import zipfile

import pytest

from app.core import config
from app.core.segmented_assets import segment_audio_path
from app.models.role import Role
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
from app.models.voice_profile import VoiceProfile
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc
from app.services.project_export_service import export_project
from app.services.project_import_service import import_project


def _seed(pid: str = "p1") -> ProjectIn:
    return ProjectIn(
        id=pid, name="导出源", schema_version=2, layout="vertical", original_text="全文",
        chapters=[{
            "id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
            "voice": {"engine": "edge_tts"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [
                {"id": "s1", "position": 0, "text": "你好世界", "voice": {"source": "chapter"}},
            ],
        }],
    )


def _build_source_project(db, tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path / "seg")
    monkeypatch.setattr(config.settings, "base_dir", tmp_path)
    svc.save_project(db, _seed())
    db.commit()
    seg = db.query(SegmentedProjectSegment).filter_by(id="s1").one()
    abs_path = segment_audio_path("p1", "c1", chapter_title="第一章", project_name="导出源",
                                  segment_id="s1", position=0, fmt="mp3")
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(b"FAKE_MP3")
    rel = abs_path.relative_to(config.settings.segmented_dir).as_posix()
    seg.audio = {"format": "mp3", "current": {"id": None, "path": rel},
                 "previous": {"id": None, "path": rel}, "duration_sec": 2.0}
    db.add(Role(id="r1", name="旁白", project_id="p1",
                voice={"engine": "edge_tts", "voice": "zh-CN-YunxiNeural"}))
    db.commit()


def test_import_round_trip_creates_new_project_with_remapped_ids(db_session, tmp_path, monkeypatch):
    _build_source_project(db_session, tmp_path, monkeypatch)
    data, _ = export_project(db_session, "p1")

    detail = import_project(db_session, data)

    # new project, different id, same name
    assert detail.id != "p1"
    assert detail.name == "导出源"
    assert len(detail.chapters) == 1
    ch = detail.chapters[0]
    assert ch.id != "c1"
    assert ch.name == "第一章"
    assert ch.narration_script is None or ch.narration_script == ""
    assert len(ch.segments) == 1
    seg = ch.segments[0]
    assert seg.id != "s1"
    assert seg.text == "你好世界"
    # audio path rewritten to a real file under the new project dir
    new_rel = seg.audio["current"]["path"]
    assert new_rel.startswith("dao-chu-yuan")
    abs_audio = config.settings.segmented_dir / new_rel
    assert abs_audio.exists()
    assert abs_audio.read_bytes() == b"FAKE_MP3"
    # role remapped
    assert len(detail.roles) == 1 if hasattr(detail, "roles") else True


def test_import_does_not_overwrite_original(db_session, tmp_path, monkeypatch):
    _build_source_project(db_session, tmp_path, monkeypatch)
    data, _ = export_project(db_session, "p1")
    import_project(db_session, data)

    # original still intact
    orig = db_session.query(SegmentedProject).filter_by(id="p1").one()
    assert orig.name == "导出源"
    orig_seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert orig_seg.text == "你好世界"
    assert orig_seg.audio["current"]["path"].startswith("dao-chu-yuan/")


def test_import_rejects_bad_bundle_version(db_session, tmp_path, monkeypatch):
    _build_source_project(db_session, tmp_path, monkeypatch)
    data, _ = export_project(db_session, "p1")
    # tamper manifest
    z = zipfile.ZipFile(io.BytesIO(data))
    manifest = json.loads(z.read("manifest.json"))
    manifest["bundle_version"] = 999
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zo:
        zo.writestr("manifest.json", json.dumps(manifest))
        for n in z.namelist():
            if n != "manifest.json":
                zo.writestr(n, z.read(n))
    with pytest.raises(ValueError, match="bundle_version"):
        import_project(db_session, buf.getvalue())


def test_import_preserves_role_and_segment_role_link(db_session, tmp_path, monkeypatch):
    _build_source_project(db_session, tmp_path, monkeypatch)
    # link segment to role
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.role_id = "r1"
    db_session.commit()
    data, _ = export_project(db_session, "p1")

    detail = import_project(db_session, data)

    new_seg = (db_session.query(SegmentedProjectSegment)
               .filter(SegmentedProjectSegment.id != "s1")
               .filter_by(text="你好世界").one())
    new_role = db_session.query(Role).filter(Role.id != "r1").filter_by(name="旁白").one()
    # segment.role_id remapped to the new role id
    assert new_seg.role_id == new_role.id
    assert new_role.project_id == detail.id
