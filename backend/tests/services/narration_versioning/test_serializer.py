from pathlib import Path

from app.services.narration_versioning.serializer import (
    write_project, parse_segments_md,
)


class _Obj:
    def __init__(self, **kw): self.__dict__.update(kw)


def _make_project():
    ch = _Obj(
        id="ch01-opening", project_id="deepseek-strategy",
        position=1, name="Opening", design_title="开场白",
        voice={"engine": "edge_tts"}, split_config={},
        original_text="章节原文。",
        narration_script="# 开场白\n改写后。",
        segments=[
            _Obj(id="s001", chapter_id="ch01-opening", position=0,
                 text="第一段文本。", segment_kind="narration",
                 role_id=None, emotion=None, voice={"source": "chapter"}),
            _Obj(id="s002", chapter_id="ch01-opening", position=1,
                 text="第二段。", segment_kind="dialogue",
                 role_id="role_xm", emotion="happy",
                 voice={"source": "role", "role_id": "role_xm"}),
            _Obj(id="s003", chapter_id="ch01-opening", position=2,
                 text="第三段\n带换行。", segment_kind="narration",
                 role_id=None, emotion=None, voice={"source": "chapter"}),
        ],
    )
    return _Obj(
        id="deepseek-strategy", name="DeepSeek 策略", layout="vertical",
        active_chapter_id=None, animation_theme=None,
        remotion_project_path=None, default_narrator_role_id=None,
        configs={"description": "test project"},
        source_document="# 源文档\n正文。",
        chapters=[ch],
    )


def test_write_project_creates_expected_tree(tmp_path):
    proj = _make_project()
    root = tmp_path / "repo"
    write_project(proj, root)

    proj_dir = root / "projects" / "deepseek-strategy"
    assert (proj_dir / "project.yaml").exists()
    assert (proj_dir / "source.md").read_text() == "# 源文档\n正文。"
    # _make_project 无项目级 narration_script → 不写 narration.md
    assert not (proj_dir / "narration.md").exists()

    ch_dir = proj_dir / "chapters" / "ch01-opening"
    assert (ch_dir / "chapter.yaml").exists()
    assert (ch_dir / "original.md").read_text() == "章节原文。"
    assert (ch_dir / "script.md").read_text() == "# 开场白\n改写后。"

    segs = (ch_dir / "segments.md").read_text()
    assert "<!-- s001 kind=narration -->" in segs
    assert "第一段文本。" in segs
    assert "<!-- s002 kind=dialogue role=role_xm emotion=happy" in segs
    assert "第三段\n带换行。" in segs


def test_write_project_writes_full_narration(tmp_path):
    proj = _make_project()
    doc = tmp_path / "store" / "narration.md"
    doc.parent.mkdir(parents=True)
    doc.write_text("# 完整旁白稿\n全文。", encoding="utf-8")
    proj.narration_document_path = str(doc)
    root = tmp_path / "repo"
    write_project(proj, root)

    proj_dir = root / "projects" / "deepseek-strategy"
    assert (proj_dir / "narration.md").read_text() == "# 完整旁白稿\n全文。"


def test_write_is_idempotent(tmp_path):
    proj = _make_project()
    root = tmp_path / "repo"
    write_project(proj, root)
    p = root / "projects" / "deepseek-strategy" / "chapters" / "ch01-opening" / "segments.md"
    snapshot_1 = p.read_text()
    write_project(proj, root)
    snapshot_2 = p.read_text()
    assert snapshot_1 == snapshot_2


def test_deleted_chapter_dir_is_swept(tmp_path):
    proj = _make_project()
    root = tmp_path / "repo"
    write_project(proj, root)
    proj.chapters = []
    write_project(proj, root)
    ch_dir = root / "projects" / "deepseek-strategy" / "chapters" / "ch01-opening"
    assert not ch_dir.exists()


def test_optional_files_deleted_when_null(tmp_path):
    proj = _make_project()
    root = tmp_path / "repo"
    write_project(proj, root)
    ch_dir = root / "projects" / "deepseek-strategy" / "chapters" / "ch01-opening"
    assert (ch_dir / "script.md").exists()
    proj.chapters[0].narration_script = None
    proj.source_document = None
    write_project(proj, root)
    assert not (ch_dir / "script.md").exists()
    assert not (root / "projects" / "deepseek-strategy" / "source.md").exists()


def test_parse_segments_md_round_trip():
    text = (
        '<!-- s001 kind=narration -->\n'
        '第一段。\n\n'
        '<!-- s002 kind=dialogue role=role_xm emotion=happy -->\n'
        '"你好！"\n'
    )
    parsed = parse_segments_md(text)
    assert parsed[0] == {"id": "s001", "kind": "narration", "text": "第一段。"}
    assert parsed[1] == {
        "id": "s002", "kind": "dialogue",
        "role": "role_xm", "emotion": "happy", "text": '"你好！"',
    }
