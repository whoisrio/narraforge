"""Tests for the human-readable naming layout of segmented project assets.

The paths are keyed by project/chapter *name* + a short id suffix for
uniqueness — never by id alone or by name alone:

    projects/{project_id}/
        source-{project-name}-{project-id-short}.md
        narration-{project-name}-{project-id-short}.md
        chapters/
            chapter-{chapter-title}-{project-name}-{chapter-id-short}/
                original.txt
                segments/
                    segment-{position:03d}-{segment-id-short}.mp3
                    segment-{position:03d}-{segment-id-short}.txt
                    segment-{position:03d}-{segment-id-short}.ssml

Rationale: browsable in a file manager (names are meaningful), yet a short id
suffix (first 6 chars of the UUID/id) guarantees uniqueness across projects
that share a name or chapters that share a title.
"""
from pathlib import Path

from app.core.config import settings
from app.core.segmented_assets import (
    chapter_dir,
    ensure_chapter_layout,
    project_dir,
    read_manifest,
    remove_project_dir,
    safe_name_part,
    segment_audio_path,
    segment_basename,
    short_id,
    source_document_path,
    narration_document_path,
    write_chapter_original_text,
    write_manifest,
    write_project_document,
    write_segment_ssml,
    write_segment_text,
)


def test_short_id_takes_stable_prefix():
    assert short_id("1783497432116-2-a3o1cf") == "178349"
    assert short_id("abc") == "abc"
    assert short_id("") == ""


def test_safe_name_part_strips_and_replaces_unsafe_chars():
    assert safe_name_part("我的 项目 / v2") == "我的_项目_v2"
    # Leading dots are stripped so we don't create hidden files or leak
    # traversal-looking prefixes into a browsable path.
    assert safe_name_part("  ../etc/passwd  ") == "_etc_passwd"
    # Falls back to a sentinel so paths never contain an empty part.
    assert safe_name_part("") == "untitled"
    assert safe_name_part("   ") == "untitled"


def test_project_dir_still_keyed_by_id():
    """Project dir stays id-keyed so renaming a project doesn't move files."""
    d = project_dir("p1")
    assert d == settings.segmented_dir / "p1"


def test_source_and_narration_paths_include_project_name_and_short_id():
    pid = "1783497432116-2-a3o1cf"
    src = source_document_path(pid, "DeepSeek 解说")
    nar = narration_document_path(pid, "DeepSeek 解说")
    assert src.parent == project_dir(pid)
    assert src.name == "source-DeepSeek_解说-178349.md"
    assert nar.name == "narration-DeepSeek_解说-178349.md"


def test_chapter_dir_includes_title_project_name_and_short_id():
    pid = "1783497432116-2-a3o1cf"
    cid = "1783497432116-1-9ihllc"
    d = chapter_dir(pid, cid, chapter_title="引言", project_name="DeepSeek 解说")
    expected = (
        project_dir(pid) / "chapters"
        / "chapter-引言-DeepSeek_解说-178349"
    )
    assert d == expected


def test_segment_paths_use_position_and_short_segment_id():
    pid = "p1"
    cid = "c1"
    base = segment_basename(position=3, segment_id="abc123def456")
    assert base == "segment-003-abc123"

    audio = segment_audio_path(
        pid, cid,
        chapter_title="第 一 章", project_name="Proj",
        segment_id="abc123def456", position=3, fmt="mp3",
    )
    assert audio.name == "segment-003-abc123.mp3"
    assert audio.parent.name == "segments"
    assert audio.parent.parent == chapter_dir(pid, cid, chapter_title="第 一 章", project_name="Proj")


def test_write_and_read_manifest_unchanged(tmp_path: Path, monkeypatch):
    """manifest.json still lives at the project dir root, unchanged name."""
    monkeypatch.setattr(settings, "segmented_dir", tmp_path)
    write_manifest("p1", {"project": {"id": "p1", "name": "x"}})
    assert read_manifest("p1") == {"project": {"id": "p1", "name": "x"}}


def test_write_project_document_creates_named_file(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "segmented_dir", tmp_path)
    pid = "1783497432116-2-a3o1cf"
    path = write_project_document(pid, kind="source", project_name="My Proj", text="hello")
    assert Path(path).name == "source-My_Proj-178349.md"
    assert Path(path).read_text(encoding="utf-8") == "hello"


def test_write_chapter_original_and_segment_files(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "segmented_dir", tmp_path)
    pid = "1783497432116-2-a3o1cf"
    cid = "1783497432116-1-9ihllc"
    ensure_chapter_layout(pid, cid, chapter_title="引言", project_name="P")
    write_chapter_original_text(pid, cid, chapter_title="引言", project_name="P", text="ch original")
    write_segment_text(
        pid, cid, chapter_title="引言", project_name="P",
        segment_id="s1abcdef", position=0, text="seg body",
    )
    write_segment_ssml(
        pid, cid, chapter_title="引言", project_name="P",
        segment_id="s1abcdef", position=0, ssml="<speak/>",
    )
    cdir = chapter_dir(pid, cid, chapter_title="引言", project_name="P")
    assert (cdir / "original.txt").read_text(encoding="utf-8") == "ch original"
    seg_dir = cdir / "segments"
    assert (seg_dir / "segment-000-s1abcd.txt").read_text(encoding="utf-8") == "seg body"
    assert (seg_dir / "segment-000-s1abcd.ssml").read_text(encoding="utf-8") == "<speak/>"


def test_remove_project_dir_still_works(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "segmented_dir", tmp_path)
    write_manifest("p1", {"x": 1})
    remove_project_dir("p1")
    assert not project_dir("p1").exists()


def test_disambiguates_when_names_collide():
    """Two projects with the same name still produce distinct file paths
    because the id-short suffix differs."""
    p1_src = source_document_path("aaa111-x", "SameName")
    p2_src = source_document_path("bbb222-y", "SameName")
    assert p1_src != p2_src
    assert p1_src.name != p2_src.name
