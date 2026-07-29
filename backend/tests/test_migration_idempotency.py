"""P9006 follow-up: legacy ALTER groups must not re-add zombie columns on
modern DBs (re-add/drop ping-pong every startup otherwise)."""
from sqlalchemy import create_engine, text

from app.core.database import (
    _ALL_ALTER_STMTS,
    _run_alter_or_skip,
    _run_migrations,
    Base,
)
from app import models  # noqa: F401  (register metadata)

ZOMBIE_COLS = {
    "engine", "engine_params", "source_audio_path", "cloned_preview_path",
    "original_audio_path", "voice_engine_type", "engine_type", "engine_sub_type",
}


def test_legacy_alters_skip_zombie_columns_on_modern_db():
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        Base.metadata.create_all(bind=conn)
        _run_migrations(conn)  # full first run → clean model schema
        # 第二轮的 legacy ALTER 循环不得再把僵尸列加回来
        for stmt in _ALL_ALTER_STMTS:
            _run_alter_or_skip(conn, stmt)
        cols = {c[1] for c in conn.execute(text("PRAGMA table_info(voice_profiles)")).fetchall()}
        assert not (cols & ZOMBIE_COLS)


def test_migrations_idempotent_no_zombie_columns():
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        Base.metadata.create_all(bind=conn)
        _run_migrations(conn)
        _run_migrations(conn)
        cols = {c[1] for c in conn.execute(text("PRAGMA table_info(voice_profiles)")).fetchall()}
        assert not (cols & ZOMBIE_COLS)
