"""Tests for the segmented-asset directory rename migration.

The migration walks every project on disk + in the DB, renames legacy paths
    projects/{project_id}/source.md
    projects/{project_id}/narration.md
    projects/{project_id}/chapters/{chapter_id}/
    projects/{project_id}/chapters/{chapter_id}/segments/{segment_id}.{ext}
to the new human-readable layout, and rewrites the DB paths (segment audio
+ project source/narration document paths) accordingly. Idempotent.
"""
from pathlib import Path

import pytest

from app.core import segmented_assets as assets
from app.core.config import settings
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
from app.services.migrate_asset_layout import (
    migrate_all_projects,
    plan_project_migration,
)


@pytest.fixture
def _tmp_segmented_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "segmented_dir", tmp_path)
    return tmp_path


def _seed_legacy_project(
    db, root: Path, *,
    project_id="abcdef123456",
    project_name="Demo 项目",
    chapter_id="chap01234567",
    chapter_title="第一章",
    segment_id="seg00abcdef",
) -> tuple[SegmentedProject, SegmentedProjectChapter, SegmentedProjectSegment]:
    proj_dir = root / project_id
    (proj_dir / "chapters" / chapter_id / "segments").mkdir(parents=True)
    (proj_dir / "source.md").write_text("SRC", encoding="utf-8")
    (proj_dir / "narration.md").write_text("NAR", encoding="utf-8")
    (proj_dir / "original.txt").write_text("ORIG", encoding="utf-8")
    (proj_dir / "chapters" / chapter_id / "original.txt").write_text("CH ORIG", encoding="utf-8")
    (proj_dir / "chapters" / chapter_id / "segments" / f"{segment_id}.mp3").write_bytes(b"MP3")
    (proj_dir / "chapters" / chapter_id / "segments" / f"{segment_id}.txt").write_text("SEG", encoding="utf-8")

    proj = SegmentedProject(
        id=project_id,
        name=project_name,
        schema_version=2,
        layout="vertical",
        source_document_path=str(proj_dir / "source.md"),
        narration_document_path=str(proj_dir / "narration.md"),
    )
    db.add(proj)
    ch = SegmentedProjectChapter(
        id=chapter_id, project_id=project_id, position=0, name=chapter_title,
    )
    db.add(ch)
    seg = SegmentedProjectSegment(
        id=segment_id, chapter_id=chapter_id, position=0, text="hello",
        audio={
            "current": {
                "path": f"{project_id}/chapters/{chapter_id}/segments/{segment_id}.mp3",
                "format": "mp3",
            },
        },
    )
    db.add(seg)
    db.commit()
    return proj, ch, seg


def test_plan_lists_renames(db_session, _tmp_segmented_dir):
    _seed_legacy_project(db_session, _tmp_segmented_dir)
    plan = plan_project_migration(db_session, "abcdef123456")
    src_names = {p.name for p in plan.file_renames.values()}
    # Old files exist, new names planned
    assert "source-Demo_项目-abcdef.md" in src_names
    assert "narration-Demo_项目-abcdef.md" in src_names
    assert "segment-000-seg00a.mp3" in src_names
    # chapter dir rename planned
    assert any("chapter-第一章-Demo_项目-chap01" in str(v) for v in plan.dir_renames.values())


def test_migrate_renames_files_and_updates_db(db_session, _tmp_segmented_dir):
    _seed_legacy_project(db_session, _tmp_segmented_dir)
    result = migrate_all_projects(db_session)
    assert result["projects_migrated"] == 1
    assert result["errors"] == []

    proj = db_session.query(SegmentedProject).filter_by(id="abcdef123456").one()
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="seg00abcdef").one()

    # Files renamed on disk
    proj_dir = assets.project_dir("abcdef123456")
    assert (proj_dir / "source-Demo_项目-abcdef.md").exists()
    assert (proj_dir / "narration-Demo_项目-abcdef.md").exists()
    assert not (proj_dir / "source.md").exists()

    new_chapter_dir = proj_dir / "chapters" / "chapter-第一章-Demo_项目-chap01"
    assert new_chapter_dir.exists()
    assert (new_chapter_dir / "original.txt").read_text(encoding="utf-8") == "CH ORIG"
    assert (new_chapter_dir / "segments" / "segment-000-seg00a.mp3").read_bytes() == b"MP3"
    assert (new_chapter_dir / "segments" / "segment-000-seg00a.txt").read_text(encoding="utf-8") == "SEG"

    # DB paths rewritten
    assert proj.source_document_path.endswith("source-Demo_项目-abcdef.md")
    assert proj.narration_document_path.endswith("narration-Demo_项目-abcdef.md")
    assert seg.audio["current"]["path"].endswith("segment-000-seg00a.mp3")
    # relative to segmented_dir root, and it actually exists
    audio_abs = _tmp_segmented_dir / seg.audio["current"]["path"]
    assert audio_abs.exists()


def test_migration_is_idempotent(db_session, _tmp_segmented_dir):
    _seed_legacy_project(db_session, _tmp_segmented_dir)
    first = migrate_all_projects(db_session)
    second = migrate_all_projects(db_session)
    assert first["projects_migrated"] == 1
    assert second["projects_migrated"] == 0  # nothing left to move
    assert second["errors"] == []


def test_migration_skips_when_no_legacy_files(db_session, _tmp_segmented_dir):
    """Fresh project already using the new layout must not be touched."""
    proj_dir = _tmp_segmented_dir / "newproj"
    proj_dir.mkdir(parents=True)
    (proj_dir / "source-New_Proj-newpro.md").write_text("SRC", encoding="utf-8")
    proj = SegmentedProject(
        id="newproj",
        name="New Proj",
        schema_version=2,
        layout="vertical",
        source_document_path=str(proj_dir / "source-New_Proj-newpro.md"),
    )
    db_session.add(proj)
    db_session.commit()

    result = migrate_all_projects(db_session)
    assert result["projects_migrated"] == 0
    assert (proj_dir / "source-New_Proj-newpro.md").exists()
