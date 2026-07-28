"""D4 regression tests: table recreate must preserve PK/NOT NULL/FK/indexes,
and the repair migration must restore constraints lost by the old buggy recreate."""
import pytest
from sqlalchemy import create_engine, text

from app.core.database import _drop_columns_via_recreate, _repair_lost_constraints


@pytest.fixture
def scratch():
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        yield conn


def _pk_cols(conn, table):
    return [r[1] for r in conn.execute(text(f"PRAGMA table_info({table})")).fetchall() if r[5]]


def _notnull_cols(conn, table):
    return [r[1] for r in conn.execute(text(f"PRAGMA table_info({table})")).fetchall() if r[3]]


def test_drop_columns_preserves_constraints(scratch):
    scratch.execute(text(
        "CREATE TABLE parent (id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL)"
    ))
    scratch.execute(text(
        "CREATE TABLE child ("
        " id VARCHAR PRIMARY KEY,"
        " parent_id VARCHAR NOT NULL REFERENCES parent(id) ON DELETE CASCADE,"
        " value VARCHAR DEFAULT 'x',"
        " obsolete VARCHAR)"
    ))
    scratch.execute(text("CREATE INDEX ix_child_parent ON child(parent_id)"))
    scratch.execute(text("INSERT INTO parent (id, name) VALUES ('p1', 'n')"))
    scratch.execute(text("INSERT INTO child (id, parent_id, value, obsolete) VALUES ('c1', 'p1', 'v', 'junk')"))
    scratch.commit()

    _drop_columns_via_recreate(scratch, "child", ["obsolete"])

    cols = [r[1] for r in scratch.execute(text("PRAGMA table_info(child)")).fetchall()]
    assert "obsolete" not in cols
    assert _pk_cols(scratch, "child") == ["id"]
    assert "parent_id" in _notnull_cols(scratch, "child")
    fks = scratch.execute(text("PRAGMA foreign_key_list(child)")).fetchall()
    assert len(fks) == 1 and fks[0][2] == "parent" and fks[0][6].upper() == "CASCADE"
    indexes = scratch.execute(text("PRAGMA index_list(child)")).fetchall()
    assert any(idx[1] == "ix_child_parent" for idx in indexes)
    row = scratch.execute(text("SELECT id, parent_id, value FROM child")).fetchone()
    assert row == ("c1", "p1", "v")


def test_repair_lost_constraints_restores_model_schema(scratch):
    """Simulate the damage left by the old buggy recreate on the real dev DB:
    roles table without PK/NOT NULL/FK and with a leftover zombie column."""
    scratch.execute(text(
        "CREATE TABLE segmented_projects (id VARCHAR PRIMARY KEY, name VARCHAR, default_narrator_role_id VARCHAR REFERENCES roles(id) ON DELETE SET NULL)"
    ))
    scratch.execute(text(
        "CREATE TABLE roles ("
        " id VARCHAR, name VARCHAR, avatar VARCHAR, description VARCHAR,"
        " role_kind VARCHAR, project_id VARCHAR, voice JSON, favorite_styles JSON,"
        " default_engine VARCHAR,"  # zombie column
        " created_at DATETIME, updated_at DATETIME)"
    ))
    scratch.execute(text(
        "INSERT INTO roles (id, name, role_kind, default_engine) VALUES ('r1', 'n', 'cast', 'legacy')"
    ))
    scratch.execute(text(
        "INSERT INTO segmented_projects (id, name, default_narrator_role_id) VALUES ('p1', 'proj', 'r1')"
    ))
    scratch.commit()
    assert _pk_cols(scratch, "roles") == []

    _repair_lost_constraints(scratch)

    assert _pk_cols(scratch, "roles") == ["id"]
    assert "name" in _notnull_cols(scratch, "roles")
    cols = [r[1] for r in scratch.execute(text("PRAGMA table_info(roles)")).fetchall()]
    assert "default_engine" not in cols  # zombie dropped (model schema wins)
    fks = scratch.execute(text("PRAGMA foreign_key_list(roles)")).fetchall()
    assert any(fk[2] == "segmented_projects" for fk in fks)
    row = scratch.execute(text("SELECT id, name, role_kind FROM roles")).fetchone()
    assert row == ("r1", "n", "cast")
    # 引用 roles 的其他表 FK 不能被 RENAME 改写到临时表名
    proj_fks = scratch.execute(text("PRAGMA foreign_key_list(segmented_projects)")).fetchall()
    assert proj_fks and all(fk[2] == "roles" for fk in proj_fks)
    assert scratch.execute(text("SELECT default_narrator_role_id FROM segmented_projects")).fetchone()[0] == "r1"


def test_repair_lost_constraints_is_idempotent(scratch):
    from app.core.database import Base

    Base.metadata.create_all(bind=scratch)
    before = scratch.execute(
        text("SELECT sql FROM sqlite_master WHERE name='roles'")
    ).scalar()
    _repair_lost_constraints(scratch)
    after = scratch.execute(
        text("SELECT sql FROM sqlite_master WHERE name='roles'")
    ).scalar()
    assert before == after


def test_repair_adds_missing_fk(scratch):
    """Table has PK and no dangling refs, but its FK clause is absent entirely
    (lost by the old buggy recreate) — must be rebuilt with the model's FK."""
    scratch.execute(text(
        "CREATE TABLE segmented_projects (id VARCHAR PRIMARY KEY, name VARCHAR)"
    ))
    scratch.execute(text(
        "CREATE TABLE roles ("
        " id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, avatar VARCHAR, description VARCHAR,"
        " role_kind VARCHAR, project_id VARCHAR,"  # no FK clause at all
        " voice JSON, favorite_styles JSON, created_at DATETIME, updated_at DATETIME)"
    ))
    scratch.execute(text("INSERT INTO roles (id, name, role_kind) VALUES ('r1', 'n', 'cast')"))
    scratch.commit()

    _repair_lost_constraints(scratch)

    refs = [(fk[3], fk[2]) for fk in scratch.execute(text("PRAGMA foreign_key_list(roles)")).fetchall()]
    assert refs == [("project_id", "segmented_projects")]
    assert scratch.execute(text("SELECT id, name FROM roles")).fetchone() == ("r1", "n")


def test_repair_fixes_dangling_fk_references(scratch):
    """Historical RENAME corruption: table has PK but its FK references a
    dropped temp table — must be rebuilt from the model with a clean reference."""
    scratch.execute(text(
        "CREATE TABLE segmented_projects (id VARCHAR PRIMARY KEY, name VARCHAR)"
    ))
    # 手工复现 dev 库的真实损坏形态：有 PK，但 FK 指向已被 DROP 的临时表
    scratch.execute(text(
        "CREATE TABLE roles ("
        " id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, avatar VARCHAR, description VARCHAR,"
        " role_kind VARCHAR, project_id VARCHAR REFERENCES \"segmented_projects_old\"(id) ON DELETE SET NULL,"
        " voice JSON, favorite_styles JSON, created_at DATETIME, updated_at DATETIME)"
    ))
    scratch.execute(text(
        "INSERT INTO roles (id, name, role_kind) VALUES ('r1', 'n', 'cast')"
    ))
    scratch.commit()
    dangling = [fk[2] for fk in scratch.execute(text("PRAGMA foreign_key_list(roles)")).fetchall()]
    assert dangling == ["segmented_projects_old"]

    _repair_lost_constraints(scratch)

    refs = [fk[2] for fk in scratch.execute(text("PRAGMA foreign_key_list(roles)")).fetchall()]
    assert refs == ["segmented_projects"]
    assert scratch.execute(text("SELECT id, name, role_kind FROM roles")).fetchone() == ("r1", "n", "cast")
