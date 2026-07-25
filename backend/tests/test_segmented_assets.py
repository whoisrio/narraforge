"""Tests for segmented asset path construction (plan B: unified data root).

New layout:

    data/projects/{project-slug}/
        manifest.json
        source.md / narration.md / original.txt
        chapters/{chapter-id}/
            original.txt
            segments/{segment-id}.mp3|txt|ssml

Project dir uses the name slug (pinyin); chapter/segment paths use raw DB
ids so renames never move files.
"""
from pathlib import Path

from app.core import segmented_assets as assets


class P:
    """minimal project/chapter stand-ins"""
    id = "1784872201849-6-xnfikk"
    name = "langgraph-stream"


CID = "1784872201849-5-e63qdw"
SID = "1784872305255-25-i8i202"


def test_short_id_takes_stable_prefix():
    assert assets.short_id("abcdef-123") == "abcdef"
    assert assets.short_id("ab") == "ab"
    assert assets.short_id("") == ""


def test_safe_name_part_strips_and_replaces_unsafe_chars():
    assert assets.safe_name_part("hello world") == "hello_world"
    assert assets.safe_name_part(".hidden") == "hidden"
    assert assets.safe_name_part("") == "untitled"


def test_project_dir_uses_name_slug(tmp_path, monkeypatch):
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path)
    d = assets.project_dir(P.id, P.name)
    assert d == tmp_path / "langgraph-stream"


def test_project_dir_falls_back_to_id_when_name_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path)
    assert assets.project_dir(P.id, None) == tmp_path / P.id


def test_project_dir_collision_gets_hash_suffix(tmp_path, monkeypatch):
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path)
    # first project claims the slug dir (with its manifest)
    d1 = assets.project_dir("proj-aaa", "test")
    d1.mkdir(parents=True)
    assets.write_manifest("proj-aaa", {"id": "proj-aaa"}, project_name="test")
    # second project with the same name gets a deterministic hash suffix
    d2 = assets.project_dir("proj-bbb", "test")
    assert d2.name.startswith("test-") and d2.name != "test"
    # stable on repeated calls
    assert assets.project_dir("proj-bbb", "test") == d2
    # original owner still resolves to the bare slug
    assert assets.project_dir("proj-aaa", "test") == d1


def test_chapter_dir_uses_raw_chapter_id(tmp_path, monkeypatch):
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path)
    d = assets.chapter_dir(P.id, CID, project_name=P.name)
    assert d == tmp_path / "langgraph-stream" / "chapters" / CID


def test_segment_audio_path_uses_raw_segment_id(tmp_path, monkeypatch):
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path)
    p = assets.segment_audio_path(
        P.id, CID, project_name=P.name, segment_id=SID, fmt="mp3",
    )
    assert p == tmp_path / "langgraph-stream" / "chapters" / CID / "segments" / f"{SID}.mp3"


def test_project_document_paths_are_fixed_names(tmp_path, monkeypatch):
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path)
    assert assets.source_document_path(P.id, P.name) == tmp_path / "langgraph-stream" / "source.md"
    assert assets.narration_document_path(P.id, P.name) == tmp_path / "langgraph-stream" / "narration.md"


def test_write_and_read_manifest(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path)
    assets.write_manifest(P.id, {"id": P.id, "name": P.name}, project_name=P.name)
    m = assets.read_manifest(P.id, P.name)
    assert m is not None and m["id"] == P.id
    assert (tmp_path / "langgraph-stream" / "manifest.json").exists()


def test_write_chapter_original_and_segment_files(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path)
    assets.write_chapter_original_text(P.id, CID, project_name=P.name, text="原文")
    assets.write_segment_text(P.id, CID, project_name=P.name, segment_id=SID, text="段文本")
    assets.write_segment_ssml(P.id, CID, project_name=P.name, segment_id=SID, ssml="<speak/>")
    base = tmp_path / "langgraph-stream" / "chapters" / CID
    assert (base / "original.txt").read_text() == "原文"
    assert (base / "segments" / f"{SID}.txt").read_text() == "段文本"
    assert (base / "segments" / f"{SID}.ssml").read_text() == "<speak/>"


def test_remove_project_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path)
    d = assets.project_dir(P.id, P.name)
    d.mkdir(parents=True)
    assets.remove_project_dir(P.id, P.name)
    assert not d.exists()


def test_remove_segment_audio_by_db_path(tmp_path: Path, monkeypatch):
    """Deletion prefers the DB-stored path (works for ANY historical layout)."""
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path)
    legacy = tmp_path / "old-uid" / "chapters" / "weird-name" / "segments" / "segment-000-x.mp3"
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(b"x")
    assets.delete_audio_file("old-uid/chapters/weird-name/segments/segment-000-x.mp3")
    assert not legacy.exists()
