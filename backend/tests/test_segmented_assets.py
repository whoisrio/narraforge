from pathlib import Path
from app.core.config import settings
from app.core.segmented_assets import (
    project_dir,
    chapter_dir,
    segment_audio_path,
    write_original_text,
    write_segment_text,
    write_segment_ssml,
    write_manifest,
    read_manifest,
    remove_project_dir,
)


def test_project_dir_path():
    d = project_dir("p1")
    assert d == settings.segmented_dir / "p1"
    assert chapter_dir("p1", "c1") == d / "chapters" / "c1"
    assert segment_audio_path("p1", "c1", "s1", "mp3") == d / "chapters" / "c1" / "segments" / "s1.mp3"
    assert segment_audio_path("p1", "c1", "s1", "wav") == d / "chapters" / "c1" / "segments" / "s1.wav"


def test_write_and_read_manifest(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "segmented_dir", tmp_path)
    pid = "p1"
    write_manifest(pid, {"project": {"id": pid, "name": "x"}})
    m = read_manifest(pid)
    assert m == {"project": {"id": pid, "name": "x"}}


def test_write_text_and_ssml_files(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "segmented_dir", tmp_path)
    pid = "p1"
    write_original_text(pid, "global text")
    write_segment_text(pid, "c1", "s1", "seg text")
    write_segment_ssml(pid, "c1", "s1", "<speak/>")
    assert (project_dir(pid) / "original.txt").read_text(encoding="utf-8") == "global text"
    seg_dir = chapter_dir(pid, "c1") / "segments"
    assert (seg_dir / "s1.txt").read_text(encoding="utf-8") == "seg text"
    assert (seg_dir / "s1.ssml").read_text(encoding="utf-8") == "<speak/>"


def test_remove_project_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "segmented_dir", tmp_path)
    pid = "p1"
    write_original_text(pid, "x")
    remove_project_dir(pid)
    assert not project_dir(pid).exists()
