"""P9006 follow-up: legacy ALTER groups must not re-add zombie columns on
modern DBs (re-add/drop ping-pong every startup otherwise)."""
from sqlalchemy import create_engine, inspect, text

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


# ── P9007: position dedup + unique indexes (D6) ──

def test_p9007_deduplicates_positions_and_creates_indexes():
    """P9007 must fix duplicate positions and create unique indexes."""
    from app.core.database import _migrate_deduplicate_positions

    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        # Create tables WITHOUT unique constraints (simulate a pre-D6 DB).
        conn.execute(text("""
            CREATE TABLE segmented_projects (
                id VARCHAR NOT NULL PRIMARY KEY, name VARCHAR NOT NULL,
                schema_version INTEGER NOT NULL, layout VARCHAR NOT NULL DEFAULT 'vertical'
            )
        """))
        conn.execute(text("""
            CREATE TABLE segmented_project_chapters (
                id VARCHAR NOT NULL PRIMARY KEY,
                project_id VARCHAR NOT NULL REFERENCES segmented_projects(id) ON DELETE CASCADE,
                position INTEGER NOT NULL, name VARCHAR NOT NULL,
                voice JSON NOT NULL DEFAULT '{}', split_config JSON NOT NULL DEFAULT '{}',
                created_at DATETIME
            )
        """))
        conn.execute(text("""
            CREATE TABLE segmented_project_segments (
                id VARCHAR NOT NULL PRIMARY KEY,
                chapter_id VARCHAR NOT NULL REFERENCES segmented_project_chapters(id) ON DELETE CASCADE,
                position INTEGER NOT NULL, text VARCHAR NOT NULL DEFAULT '',
                segment_kind VARCHAR NOT NULL DEFAULT 'narration',
                voice JSON NOT NULL DEFAULT '{}',
                created_at DATETIME
            )
        """))

        # Insert duplicate segment positions.
        conn.execute(text(
            "INSERT INTO segmented_projects (id, name, schema_version, layout) "
            "VALUES ('p1', 'Test', 2, 'vertical')"
        ))
        conn.execute(text(
            "INSERT INTO segmented_project_chapters (id, project_id, position, name, voice, split_config) "
            "VALUES ('c1', 'p1', 0, 'Ch', '{}', '{}')"
        ))
        for i in range(3):
            conn.execute(text(
                "INSERT INTO segmented_project_segments "
                "(id, chapter_id, position, text, segment_kind, voice) "
                "VALUES (:sid, 'c1', 0, :txt, 'narration', '{}')"
            ), {"sid": f"s{i}", "txt": f"seg {i}"})
        conn.commit()

        # Run dedup.
        _migrate_deduplicate_positions(conn)

        # No duplicate positions remain.
        dups = conn.execute(text(
            "SELECT chapter_id, position, COUNT(*) FROM segmented_project_segments "
            "GROUP BY chapter_id, position HAVING COUNT(*) > 1"
        )).fetchall()
        assert dups == []

        # Unique index exists.
        indexes = {
            row[1] for row in conn.execute(text("PRAGMA index_list(segmented_project_segments)")).fetchall()
        }
        assert "uq_segment_chapter_position" in indexes

        # Re-run is idempotent.
        _migrate_deduplicate_positions(conn)
        dups2 = conn.execute(text(
            "SELECT chapter_id, position, COUNT(*) FROM segmented_project_segments "
            "GROUP BY chapter_id, position HAVING COUNT(*) > 1"
        )).fetchall()
        assert dups2 == []


def test_p9007_noop_when_no_duplicates():
    """P9007 is a clean no-op on a fresh DB with no duplicates.
    Also verifies the unique index exists (from create_all auto-index)."""
    from app.core.database import _migrate_deduplicate_positions

    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        Base.metadata.create_all(bind=conn)
        _migrate_deduplicate_positions(conn)  # should not raise

        # Unique constraint is present (auto-index from __table_args__).
        seg_indexes = {
            row[1] for row in conn.execute(
                text("PRAGMA index_list(segmented_project_segments)")
            ).fetchall()
        }
        # SQLite auto-index names vary; check that *some* unique index exists
        # on the (chapter_id, position) columns.
        has_unique_seg = any(
            conn.execute(text(f"PRAGMA index_info({name})")).fetchall()
            for name in seg_indexes
            if any(
                r[2] in ("chapter_id", "position")
                for r in conn.execute(text(f"PRAGMA index_info({name})")).fetchall()
            )
        )
        # At minimum, the PK exists; the unique constraint is enforced by
        # create_all via __table_args__.
        assert len(seg_indexes) >= 2  # PK + unique constraint

        # P9007 must NOT create a second unique index on the same columns
        # (the auto-index from __table_args__ already covers it).
        unique_seg_count = sum(
            1 for name in seg_indexes
            if conn.execute(text(f"PRAGMA index_list(segmented_project_segments)")).fetchall()
        )
        # Count only truly unique indexes on (chapter_id, position).
        unique_count = 0
        for row in conn.execute(text("PRAGMA index_list(segmented_project_segments)")).fetchall():
            if not row[2]:  # not unique
                continue
            cols = {r[2] for r in conn.execute(text(f"PRAGMA index_info({row[1]})")).fetchall()}
            if cols == {"chapter_id", "position"}:
                unique_count += 1
        assert unique_count == 1, (
            f"Expected exactly 1 unique index on (chapter_id, position), got {unique_count}. "
            "P9007 should skip creating a named index when create_all's auto-index exists."
        )


# ── P9008: drop zombie table narration_documents (D5) ──

def test_p9008_drops_narration_documents():
    """P9008 must drop the zombie narration_documents table."""
    from app.core.database import _migrate_drop_zombie_table

    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        # Simulate a pre-D5 DB with the zombie table.
        conn.execute(text("""
            CREATE TABLE narration_documents (
                id VARCHAR NOT NULL PRIMARY KEY,
                project_id VARCHAR NOT NULL,
                version VARCHAR NOT NULL,
                body_markdown TEXT NOT NULL
            )
        """))
        conn.execute(text(
            "INSERT INTO narration_documents (id, project_id, version, body_markdown) "
            "VALUES ('d1', 'p1', 'v1', 'test')"
        ))
        conn.commit()

        tables_before = set(inspect(conn).get_table_names())
        assert "narration_documents" in tables_before

        _migrate_drop_zombie_table(conn)

        tables_after = set(inspect(conn).get_table_names())
        assert "narration_documents" not in tables_after


def test_p9008_noop_when_table_absent():
    """P9008 is a clean no-op when narration_documents doesn't exist."""
    from app.core.database import _migrate_drop_zombie_table

    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        _migrate_drop_zombie_table(conn)  # should not raise
