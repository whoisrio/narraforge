"""Tests for project_export_service."""
import io
import json
import zipfile

import pytest

from app.core import config
from app.core.segmented_assets import segment_audio_path
from app.models.role import Role
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectSegment,
)
from app.schemas.segmented_project import ProjectIn
from app.services import segmented_project_service as svc
from app.services.project_export_service import export_project


def _seed() -> ProjectIn:
    return ProjectIn(
        id="p1", name="Test项目", schema_version=2, layout="vertical",
        original_text="全文",
        chapters=[
            {
                "id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
                "voice": {"engine": "edge_tts"},
                "split_config": {"delimiters": ["。"], "mode": "rule"},
                "segments": [
                    {"id": "s1", "position": 0, "text": "hello", "voice": {"source": "chapter"}},
                ],
            }
        ],
    )


def _add_segment_audio(db, monkeypatch, tmp_path) -> str:
    """Attach a fake mp3 to segment s1; return the relative path used."""
    seg = db.query(SegmentedProjectSegment).filter_by(id="s1").one()
    abs_path = segment_audio_path(
        "p1", "c1", chapter_title="第一章", project_name="Test项目",
        segment_id="s1", position=0, fmt="mp3",
    )
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(b"FAKE_MP3")
    rel = abs_path.relative_to(config.settings.segmented_dir).as_posix()
    seg.audio = {"format": "mp3", "current": {"id": None, "path": rel},
                 "previous": {"id": None, "path": rel}, "duration_sec": 1.5}
    db.commit()
    return rel


def _export_zip(db) -> zipfile.ZipFile:
    data, filename = export_project(db, "p1")
    assert filename.endswith(".narraforge.zip")
    return zipfile.ZipFile(io.BytesIO(data))


def test_export_returns_zip_with_manifest_and_segment_audio(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db_session, _seed())
    db_session.commit()
    orig_rel = _add_segment_audio(db_session, monkeypatch, tmp_path)

    z = _export_zip(db_session)
    names = z.namelist()
    assert "manifest.json" in names
    manifest = json.loads(z.read("manifest.json"))
    assert manifest["bundle_version"] == 1
    assert manifest["project"]["name"] == "Test项目"
    assert len(manifest["chapters"]) == 1
    assert len(manifest["segments"]) == 1
    # audio path rewritten to bundle-relative
    assert manifest["segments"][0]["audio"]["current"]["path"] == "assets/segments/s1.mp3"
    assert "assets/segments/s1.mp3" in names
    assert z.read("assets/segments/s1.mp3") == b"FAKE_MP3"
    # remotion_project_path excluded
    assert "remotion_project_path" not in manifest["project"]


def test_export_is_non_destructive(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db_session, _seed())
    db_session.commit()
    _add_segment_audio(db_session, monkeypatch, tmp_path)

    export_project(db_session, "p1")

    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    # original audio path untouched
    assert seg.audio["current"]["path"].startswith("test-xiang-mu/chapters/")
    p = db_session.query(SegmentedProject).filter_by(id="p1").one()
    assert p.name == "Test项目"


def test_export_includes_roles(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db_session, _seed())
    db_session.commit()
    db_session.add(Role(id="r1", name="旁白", project_id="p1",
                        voice={"engine": "edge_tts", "voice": "zh-CN-YunxiNeural"}))
    db_session.commit()

    z = _export_zip(db_session)
    manifest = json.loads(z.read("manifest.json"))
    assert len(manifest["roles"]) == 1
    assert manifest["roles"][0]["id"] == "r1"
    assert manifest["roles"][0]["name"] == "旁白"


def test_export_refuses_when_segment_audio_outside_project_dir(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db_session, _seed())
    db_session.commit()
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    # path that escapes the project dir
    seg.audio = {"format": "mp3", "current": {"id": None, "path": "../other/seg.mp3"},
                 "duration_sec": 1.0}
    db_session.commit()

    with pytest.raises(ValueError, match="project_assets_not_under_project_dir"):
        export_project(db_session, "p1")


def test_export_refuses_unknown_project(db_session):
    with pytest.raises(LookupError, match="project_not_found"):
        export_project(db_session, "nope")


def test_export_bundles_voice_profile_audio_and_rewrites_path(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path / "seg")
    monkeypatch.setattr(config.settings, "base_dir", tmp_path)
    (tmp_path / "clone_voices").mkdir(parents=True, exist_ok=True)
    (tmp_path / "clone_voices" / "v1.mp3").write_bytes(b"VOICE_MP3")
    svc.save_project(db_session, _seed())
    db_session.commit()
    from app.models.voice_profile import VoiceProfile
    db_session.add(VoiceProfile(
        id="vp1", name="克隆音色", project_id="p1",
        voice={"model": "mimo_tts", "voice_type": "clone"},
        preview={"preview_audio_path": "clone_voices/v1.mp3", "audition_text": "试听"},
    ))
    db_session.commit()

    z = _export_zip(db_session)
    manifest = json.loads(z.read("manifest.json"))
    vp = manifest["voice_profiles"][0]
    assert vp["preview"]["preview_audio_path"] == "assets/voices/vp1.mp3"
    assert z.read("assets/voices/vp1.mp3") == b"VOICE_MP3"


def test_export_bundles_source_and_narration_docs(db_session, tmp_path, monkeypatch):
    from app.core.segmented_assets import write_project_document
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db_session, _seed())
    db_session.commit()
    p = db_session.query(SegmentedProject).filter_by(id="p1").one()
    p.source_document_path = write_project_document(
        "p1", kind="source", project_name="Test项目", text="源文档内容")
    p.narration_document_path = write_project_document(
        "p1", kind="narration", project_name="Test项目", text="旁白稿内容")
    db_session.commit()

    z = _export_zip(db_session)
    manifest = json.loads(z.read("manifest.json"))
    assert manifest["project"]["source_document"] == "text/source.md"
    assert manifest["project"]["narration_document"] == "text/narration.md"
    assert z.read("text/source.md").decode("utf-8") == "源文档内容"
    assert z.read("text/narration.md").decode("utf-8") == "旁白稿内容"


def test_export_succeeds_with_legacy_layout_audio_path(db_session, tmp_path, monkeypatch):
    """Audio under a legacy dir (inside the asset root, outside the slug dir)
    must still export — the bundler reads DB-stored paths, not the layout."""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db_session, _seed())
    db_session.commit()
    legacy = tmp_path / "p1" / "chapters" / "chapter-old-name-abc123" / "segments" / "segment-000-abc123.mp3"
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_bytes(b"FAKE_MP3")
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.audio = {"format": "mp3", "current": {"id": None, "path": "p1/chapters/chapter-old-name-abc123/segments/segment-000-abc123.mp3"}}
    db_session.commit()

    z = _export_zip(db_session)
    assert z.read("assets/segments/s1.mp3") == b"FAKE_MP3"


def test_export_skips_missing_audio_files(db_session, tmp_path, monkeypatch):
    """Dead refs (file deleted) must not crash the export; marked missing."""
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    svc.save_project(db_session, _seed())
    db_session.commit()
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.audio = {"format": "mp3", "current": {"id": None, "path": "p1/chapters/gone/segments/nope.mp3"}}
    db_session.commit()

    z = _export_zip(db_session)
    manifest = json.loads(z.read("manifest.json"))
    seg_row = manifest["segments"][0]
    assert seg_row["audio"]["current"].get("missing") is True
    assert "assets/segments/s1.mp3" not in z.namelist()
