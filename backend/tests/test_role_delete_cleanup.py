"""D1 regression tests: role deletion must clean dangling references,
and SQLite connections must enforce foreign keys."""
from sqlalchemy import text

from app.models.role import Role
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
from app.services.role_service import delete_role

from tests.test_segmented_synthesis import _seed


def test_sqlite_engine_enforces_foreign_keys():
    from app.core.database import engine

    if "sqlite" not in str(engine.url):
        return
    with engine.connect() as conn:
        assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_delete_role_cleans_dangling_references(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    role = Role(id="r1", name="旁白", voice={"engine": "edge_tts", "params": {}})
    db_session.add(role)
    project = db_session.query(SegmentedProject).filter_by(id="p1").one()
    project.default_narrator_role_id = "r1"
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.role_id = "r1"
    seg.voice = {"source": "role", "role_id": "r1"}
    db_session.commit()

    assert delete_role(db_session, "r1") is True
    db_session.commit()

    db_session.expire_all()
    assert db_session.query(Role).filter_by(id="r1").first() is None
    project = db_session.query(SegmentedProject).filter_by(id="p1").one()
    assert project.default_narrator_role_id is None
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg.role_id is None
    # voice JSON 里的 role 引用没有 FK 可管，必须显式重置回 chapter 跟随
    assert seg.voice == {"source": "chapter"}


def test_delete_role_keeps_unrelated_voice_refs(db_session, tmp_path, monkeypatch):
    _seed(db_session, tmp_path, monkeypatch)
    db_session.add(Role(id="r1", name="A", voice={"engine": "edge_tts", "params": {}}))
    db_session.add(Role(id="r2", name="B", voice={"engine": "edge_tts", "params": {}}))
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    seg.role_id = "r2"
    seg.voice = {"source": "role", "role_id": "r2"}
    db_session.commit()

    assert delete_role(db_session, "r1") is True
    db_session.commit()

    db_session.expire_all()
    seg = db_session.query(SegmentedProjectSegment).filter_by(id="s1").one()
    assert seg.role_id == "r2"
    assert seg.voice == {"source": "role", "role_id": "r2"}
