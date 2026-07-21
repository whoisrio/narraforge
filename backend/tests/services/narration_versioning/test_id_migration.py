from app.services.narration_versioning.id_migration import migrate_ids


def test_migrate_assigns_semantic_ids(db_session):
    from app.models.segmented_project import (
        SegmentedProject, SegmentedProjectChapter, SegmentedProjectSegment,
    )

    proj = SegmentedProject(
        id="legacy-uid-abc123",
        name="DeepSeek 策略",
        layout="vertical",
    )
    ch = SegmentedProjectChapter(
        id="legacy-ch-xyz",
        project_id=proj.id,
        position=1,
        name="Opening",
        design_title="开场白",
        voice={}, split_config={},
    )
    ch.segments = [
        SegmentedProjectSegment(
            id="legacy-seg-1", chapter_id=ch.id, position=0,
            text="A", segment_kind="narration", voice={"source": "chapter"},
        ),
        SegmentedProjectSegment(
            id="legacy-seg-2", chapter_id=ch.id, position=1,
            text="B", segment_kind="narration", voice={"source": "chapter"},
        ),
    ]
    proj.chapters = [ch]
    db_session.add(proj)
    db_session.commit()

    result = migrate_ids(session=db_session)
    assert result.projects_migrated == 1
    assert result.chapters_migrated == 1
    assert result.segments_migrated == 2

    db_session.expire_all()
    migrated = db_session.query(SegmentedProject).one()
    # NOTE: pypinyin renders 略 → 'lve', so 策略 → 'ce-lve'
    assert migrated.id == "deepseek-ce-lve"
    assert migrated.chapters[0].id == "ch01-kai-chang-bai"
    assert [s.id for s in migrated.chapters[0].segments] == ["s001", "s002"]


def test_migrate_is_idempotent(db_session):
    from app.models.segmented_project import SegmentedProject
    proj = SegmentedProject(id="deepseek-ce-lve", name="DeepSeek 策略", layout="vertical")
    db_session.add(proj); db_session.commit()
    result = migrate_ids(session=db_session)
    assert result.projects_migrated == 0


def test_migrate_dry_run_does_not_write(db_session):
    from app.models.segmented_project import SegmentedProject
    proj = SegmentedProject(id="legacy-abc", name="Foo", layout="vertical")
    db_session.add(proj); db_session.commit()
    result = migrate_ids(session=db_session, dry_run=True)
    assert result.projects_migrated == 1
    db_session.expire_all()
    assert db_session.query(SegmentedProject).one().id == "legacy-abc"


def test_slug_collision_resolved_with_hash(db_session):
    from app.models.segmented_project import SegmentedProject
    a = SegmentedProject(id="legacy-a", name="测试", layout="vertical")
    b = SegmentedProject(id="legacy-b", name="测试", layout="vertical")
    db_session.add_all([a, b]); db_session.commit()

    migrate_ids(session=db_session)
    db_session.expire_all()
    ids = sorted(p.id for p in db_session.query(SegmentedProject).all())
    assert ids[0] == "ce-shi"
    assert ids[1].startswith("ce-shi-") and len(ids[1]) > len("ce-shi-")
