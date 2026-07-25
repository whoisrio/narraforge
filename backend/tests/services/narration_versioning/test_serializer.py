from pathlib import Path

from app.services.narration_versioning.serializer import (
    write_project, parse_segments_md,
)


class _Obj:
    def __init__(self, **kw): self.__dict__.update(kw)


def _make_project():
    """Legacy-style ids (uid timestamps) — the serializer must slugify names,
    never trust DB ids for directory/header naming."""
    ch = _Obj(
        id="1781590441912-5-eycy3s", project_id="1781590441912-6-21esct",
        position=1, name="Opening", design_title="开场白",
        voice={"engine": "edge_tts"}, split_config={},
        original_text="章节原文。",
        narration_script="# 开场白\n改写后。",
        segments=[
            _Obj(id="1781590472414-15-x36xni", chapter_id="1781590441912-5-eycy3s", position=0,
                 text="第一段文本。", segment_kind="narration",
                 role_id=None, emotion=None, voice={"source": "chapter"}),
            _Obj(id="1781590472414-16-oxijy8", chapter_id="1781590441912-5-eycy3s", position=1,
                 text="第二段。", segment_kind="dialogue",
                 role_id="role_xm", emotion="happy",
                 voice={"source": "role", "role_id": "role_xm"}),
            _Obj(id="1781590472414-17-k05fb6", chapter_id="1781590441912-5-eycy3s", position=2,
                 text="第三段\n带换行。", segment_kind="narration",
                 role_id=None, emotion=None, voice={"source": "chapter"}),
        ],
    )
    return _Obj(
        id="1781590441912-6-21esct", name="DeepSeek 策略", layout="vertical",
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

    # directory names derive from NAME/position, not DB ids
    proj_dir = root / "projects" / "deepseek-ce-lve"
    assert proj_dir.exists(), f"expected slug dir, got {list((root / 'projects').iterdir())}"
    assert (proj_dir / "project.yaml").exists()
    assert (proj_dir / "source.md").read_text() == "# 源文档\n正文。"
    # _make_project 无项目级 narration_script → 不写 narration.md
    assert not (proj_dir / "narration.md").exists()

    # chapter dir: ch{NN}-{pinyin slug of design_title}; position is 0-based in DB → +1
    ch_dir = proj_dir / "chapters" / "ch02-kai-chang-bai"
    assert ch_dir.exists(), f"expected chapter slug dir, got {list((proj_dir / 'chapters').iterdir())}"
    assert (ch_dir / "chapter.yaml").exists()
    assert (ch_dir / "original.md").read_text() == "章节原文。"
    assert (ch_dir / "script.md").read_text() == "# 开场白\n改写后。"

    # segment headers are s{NNN} by position order, regardless of DB id
    segs = (ch_dir / "segments.md").read_text()
    assert "<!-- s001 kind=narration -->" in segs
    assert "第一段文本。" in segs
    assert "<!-- s002 kind=dialogue role=role_xm emotion=happy" in segs
    assert "<!-- s003 kind=narration -->" in segs
    assert "第三段\n带换行。" in segs
    assert "1781590472414" not in segs

    # project.yaml still records the real DB id for traceability/sweeps
    assert "id: 1781590441912-6-21esct" in (proj_dir / "project.yaml").read_text()


def test_write_project_writes_full_narration(tmp_path):
    proj = _make_project()
    doc = tmp_path / "store" / "narration.md"
    doc.parent.mkdir(parents=True)
    doc.write_text("# 完整旁白稿\n全文。", encoding="utf-8")
    proj.narration_document_path = str(doc)
    root = tmp_path / "repo"
    write_project(proj, root)

    proj_dir = root / "projects" / "deepseek-ce-lve"
    assert (proj_dir / "narration.md").read_text() == "# 完整旁白稿\n全文。"


def test_write_is_idempotent(tmp_path):
    proj = _make_project()
    root = tmp_path / "repo"
    write_project(proj, root)
    p = root / "projects" / "deepseek-ce-lve" / "chapters" / "ch02-kai-chang-bai" / "segments.md"
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
    ch_dir = root / "projects" / "deepseek-ce-lve" / "chapters" / "ch02-kai-chang-bai"
    assert not ch_dir.exists()


def test_optional_files_deleted_when_null(tmp_path):
    proj = _make_project()
    root = tmp_path / "repo"
    write_project(proj, root)
    ch_dir = root / "projects" / "deepseek-ce-lve" / "chapters" / "ch02-kai-chang-bai"
    assert (ch_dir / "script.md").exists()
    proj.chapters[0].narration_script = None
    proj.source_document = None
    write_project(proj, root)
    assert not (ch_dir / "script.md").exists()
    assert not (root / "projects" / "deepseek-ce-lve" / "source.md").exists()


def test_project_name_collision_gets_hash_suffix(tmp_path):
    p1 = _make_project()
    p2 = _make_project()
    p2.id = "1782999999999-9-zzzzzz"  # same name, different DB id
    root = tmp_path / "repo"
    taken: set[str] = set()
    d1 = write_project(p1, root, taken)
    d2 = write_project(p2, root, taken)
    assert d1.name == "deepseek-ce-lve"
    assert d2.name.startswith("deepseek-ce-lve-") and d2.name != d1.name
    # rerun with the same ordering is stable
    taken2: set[str] = set()
    assert write_project(p1, root, taken2).name == d1.name
    assert write_project(p2, root, taken2).name == d2.name


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
