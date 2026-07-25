"""Tests for data_root_migration (unified data root, plan B)."""
from pathlib import Path

from app.core import segmented_assets as assets
from app.models.segmented_project import (
    SegmentedProject, SegmentedProjectChapter, SegmentedProjectSegment,
)
from app.services.data_root_migration import (
    apply_migration, plan_migration, plan_project,
)


def _seed_project(db, *, pid="1784872201849-6-xnfikk", name="langgraph-stream", chapters=2):
    proj = SegmentedProject(id=pid, name=name, schema_version=2, layout="vertical")
    for i in range(chapters):
        ch = SegmentedProjectChapter(
            id=f"{pid}-ch{i}", project_id=pid, position=i, name=f"第{i + 1}章",
            voice={}, split_config={},
        )
        ch.segments = [
            SegmentedProjectSegment(
                id=f"{pid}-s{i}{j}", chapter_id=ch.id, position=j,
                text=f"第{i + 1}章第{j + 1}段", segment_kind="narration",
                voice={"source": "chapter"},
            )
            for j in range(2)
        ]
        proj.chapters.append(ch)
    db.add(proj)
    db.commit()
    return proj


def _plant_legacy_assets(legacy_root: Path, project) -> dict[str, str]:
    """Create legacy uid-layout files; return {seg.id: rel_path}."""
    paths = {}
    for ch in project.chapters:
        ch_dir = legacy_root / project.id / "chapters" / f"chapter-{ch.name}-{project.name}-{assets.short_id(ch.id)}"
        for seg in ch.segments:
            f = ch_dir / "segments" / f"segment-{seg.position:03d}-{assets.short_id(seg.id)}.mp3"
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(b"fake")
            rel = f"{project.id}/chapters/{ch_dir.name}/segments/{f.name}"
            seg.audio = {"current": {"path": rel, "format": "mp3"}}
            paths[seg.id] = rel
    return paths


def test_plan_is_dry_run(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path / "new")
    legacy = tmp_path / "legacy"
    proj = _seed_project(db_session)
    _plant_legacy_assets(legacy, proj)
    db_session.commit()

    plans = plan_migration(db_session, legacy_root=legacy)
    assert len(plans) == 1
    plan = plans[0]
    assert plan.skipped_reason is None
    assert len(plan.file_moves) > 0
    assert len(plan.audio_rewrites) == 4
    # dry-run: nothing moved, DB untouched
    assert not (tmp_path / "new" / "langgraph-stream").exists()
    seg = db_session.query(SegmentedProjectSegment).filter_by(id=f"{proj.id}-s00").one()
    assert seg.audio["current"]["path"].startswith(proj.id)


def test_apply_moves_files_and_rewrites_db(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path / "new")
    legacy = tmp_path / "legacy"
    proj = _seed_project(db_session)
    _plant_legacy_assets(legacy, proj)
    db_session.commit()

    plans = plan_migration(db_session, legacy_root=legacy)
    apply_migration(db_session, plans)

    for ch in proj.chapters:
        for seg in ch.segments:
            new_rel = f"langgraph-stream/chapters/{ch.id}/segments/{seg.id}.mp3"
            assert seg.audio["current"]["path"] == new_rel
            assert (tmp_path / "new" / "langgraph-stream" / "chapters" / ch.id
                    / "segments" / f"{seg.id}.mp3").exists()
    assert not (legacy / proj.id).exists()


def test_apply_is_idempotent(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path / "new")
    legacy = tmp_path / "legacy"
    proj = _seed_project(db_session)
    _plant_legacy_assets(legacy, proj)
    db_session.commit()

    apply_migration(db_session, plan_migration(db_session, legacy_root=legacy))
    # second run: nothing left to migrate
    plans2 = plan_migration(db_session, legacy_root=legacy)
    assert all(p.skipped_reason for p in plans2)


def test_multi_chapter_suffix_collision(db_session, tmp_path, monkeypatch):
    """Chapters whose ids share the short prefix must BOTH migrate (the
    production incident scenario: timestamp-prefix ids collide on short_id)."""
    monkeypatch.setattr(assets.settings, "segmented_dir", tmp_path / "new")
    legacy = tmp_path / "legacy"
    proj = SegmentedProject(id="1784872201849-6-xnfikk", name="langgraph-stream",
                            schema_version=2, layout="vertical")
    # two chapters whose ids share the same first-6 prefix
    ids = ["178487aaaaaa-1-x", "178487bbbbbb-2-y"]
    for i, cid in enumerate(ids):
        ch = SegmentedProjectChapter(id=cid, project_id=proj.id, position=i,
                                     name=f"ch{i}", voice={}, split_config={})
        ch.segments = [SegmentedProjectSegment(
            id=f"{cid}-s0", chapter_id=cid, position=0, text="t",
            segment_kind="narration", voice={"source": "chapter"})]
        proj.chapters.append(ch)
    db_session.add(proj)
    db_session.commit()

    for ch in proj.chapters:
        # NOTE: both legacy dirs end with the SAME suffix (-178487) — realistic drift
        d = legacy / proj.id / "chapters" / f"chapter-{ch.name}-{proj.name}-178487"
        seg = ch.segments[0]
        f = d / "segments" / "segment-000-178487.mp3"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"fake")
        seg.audio = {"current": {"path": f"{proj.id}/chapters/{d.name}/segments/{f.name}",
                                 "format": "mp3"}}
    db_session.commit()

    apply_migration(db_session, plan_migration(db_session, legacy_root=legacy))

    for ch in proj.chapters:
        seg = ch.segments[0]
        assert seg.audio["current"]["path"] == \
            f"langgraph-stream/chapters/{ch.id}/segments/{seg.id}.mp3"
        assert (tmp_path / "new" / "langgraph-stream" / "chapters" / ch.id
                / "segments" / f"{seg.id}.mp3").exists()
