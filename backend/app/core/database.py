from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# P2 v2: 轻量级 schema migration (在 create_all 之后跑, 幂等).
# 因为 Base.metadata.create_all 不会 ALTER 已有表, 老 DB 需要手动加列.
_P2_V2_ALTER_STMTS = (
    # project 级: 旁白文档当前活跃版本
    "ALTER TABLE segmented_projects ADD COLUMN active_narration_version VARCHAR",
    # chapter 级: 旁白文档关联
    "ALTER TABLE segmented_project_chapters ADD COLUMN narration_document_id VARCHAR",
    "ALTER TABLE segmented_project_chapters ADD COLUMN narration_version VARCHAR",
    "ALTER TABLE segmented_project_chapters ADD COLUMN narration_slice_start INTEGER",
    "ALTER TABLE segmented_project_chapters ADD COLUMN narration_slice_end INTEGER",
    "ALTER TABLE segmented_project_chapters ADD COLUMN narration_synced_at DATETIME",
)

# P2 v3: 动画规格字段 (复用 segments 表, 加 2 列).
_P2_V3_ALTER_STMTS = (
    # project 级: 整体动画主题
    "ALTER TABLE segmented_projects ADD COLUMN animation_theme VARCHAR",
    # project 级: 默认关联 Remotion 项目路径
    "ALTER TABLE segmented_projects ADD COLUMN remotion_project_path VARCHAR",
    # chapter 级: 给 Remotion/视觉设计使用的章节标题
    "ALTER TABLE segmented_project_chapters ADD COLUMN design_title VARCHAR",
    # segment 级: 完整动画规格 (JSON 字符串)
    "ALTER TABLE segmented_project_segments ADD COLUMN animation_spec_json TEXT",
)

# P3: dialogue roles and local prosody marks.
_P3_ROLE_PROSODY_ALTER_STMTS = (
    "ALTER TABLE segmented_projects ADD COLUMN default_narrator_role_id VARCHAR",
    "ALTER TABLE segmented_projects ADD COLUMN default_narrator_snapshot JSON",
    "ALTER TABLE segmented_project_segments ADD COLUMN role_id VARCHAR",
    "ALTER TABLE segmented_project_segments ADD COLUMN role_snapshot JSON",
    "ALTER TABLE segmented_project_segments ADD COLUMN segment_kind VARCHAR DEFAULT 'narration'",
    "ALTER TABLE segmented_project_segments ADD COLUMN prosody_marks JSON",
)

# P4: explicit voice role kind.
_P4_ROLE_KIND_ALTER_STMTS = (
    "ALTER TABLE roles ADD COLUMN role_kind VARCHAR DEFAULT 'cast'",
)

# P5: voice profile avatar.
_P5_VOICE_AVATAR_ALTER_STMTS = (
    "ALTER TABLE voice_profiles ADD COLUMN avatar VARCHAR",
)

# P6: voice clone original/preview audio paths.
_P6_CLONE_AUDIO_PATHS_ALTER_STMTS = (
    "ALTER TABLE voice_profiles ADD COLUMN original_audio_path VARCHAR",
    "ALTER TABLE voice_profiles ADD COLUMN cloned_preview_path VARCHAR",
)

# P7: source document for library.
_P7_SOURCE_DOCUMENT_ALTER_STMTS = (
    "ALTER TABLE segmented_projects ADD COLUMN source_document TEXT",
)

# P8: voice profile prompt text (VoxCPM reference audio transcript).
_P8_PROMPT_TEXT_ALTER_STMTS = (
    "ALTER TABLE voice_profiles ADD COLUMN prompt_text VARCHAR",
)

# P9: voice profile project scope (NULL = global, non-null = project-specific).
_P9_VOICE_PROJECT_SCOPE_ALTER_STMTS = (
    "ALTER TABLE voice_profiles ADD COLUMN project_id VARCHAR",
)

# P10: voice engine metadata (voices_engine nested structure).
_P10_VOICE_ENGINE_ALTER_STMTS = (
    "ALTER TABLE voice_profiles ADD COLUMN voice_engine_type VARCHAR",
    "ALTER TABLE voice_profiles ADD COLUMN engine_type VARCHAR",
    "ALTER TABLE voice_profiles ADD COLUMN engine_sub_type VARCHAR",
    "ALTER TABLE voice_profiles ADD COLUMN engine_params JSON",
)

# P11: rename audio_path → source_audio_path, drop original_audio_path.
_P11_SOURCE_AUDIO_ALTER_STMTS = (
    "ALTER TABLE voice_profiles ADD COLUMN source_audio_path VARCHAR",
    # 项目级配置 JSON 字段 (split_voice_mode 等)
    "ALTER TABLE segmented_projects ADD COLUMN configs JSON",
)

# P12: segment 显式音色引用
_P12_VOICE_REF_ALTER_STMTS = (
    "ALTER TABLE segmented_project_segments ADD COLUMN voice_ref JSON",
)


def _run_alter_or_skip(conn, stmt: str) -> bool:
    """执行 ALTER TABLE. 列已存在时跳过.

    Returns True if executed, False if skipped.
    """
    parts = stmt.split()
    if len(parts) >= 6 and parts[0].upper() == "ALTER" and parts[1].upper() == "TABLE":
        table_name = parts[2]
        column_name = parts[5]
        existing_columns = {c["name"] for c in inspect(conn).get_columns(table_name)}
        if column_name in existing_columns:
            return False

    try:
        conn.execute(text(stmt))
        return True
    except Exception as e:
        msg = str(e).lower()
        if "duplicate column" in msg or "already exists" in msg:
            return False
        raise


def _migrate_source_audio_path(conn):
    """P11: copy audio_path/original_audio_path → source_audio_path (幂等)."""
    import logging
    logger = logging.getLogger(__name__)
    try:
        existing = {c["name"] for c in inspect(conn).get_columns("voice_profiles")}
        if "source_audio_path" not in existing:
            return
        if "original_audio_path" in existing:
            conn.execute(text(
                "UPDATE voice_profiles SET source_audio_path = original_audio_path "
                "WHERE source_audio_path IS NULL AND original_audio_path IS NOT NULL"
            ))
        if "audio_path" in existing:
            conn.execute(text(
                "UPDATE voice_profiles SET source_audio_path = audio_path "
                "WHERE source_audio_path IS NULL AND audio_path IS NOT NULL AND audio_path != ''"
            ))
        logger.info("[migration] P11: copied audio_path → source_audio_path")
    except Exception as e:
        logger.warning(f"[migration] P11 data migration skipped: {e}")


def _migrate_design_preview_and_drop_legacy(conn):
    """P12: move design source→preview, drop audio_path/original_audio_path columns."""
    import logging
    logger = logging.getLogger(__name__)
    try:
        existing = {c["name"] for c in inspect(conn).get_columns("voice_profiles")}
        if "audio_path" not in existing and "original_audio_path" not in existing:
            return

        # Step 1: move design voice source_audio_path → cloned_preview_path
        if "source_audio_path" in existing and "cloned_preview_path" in existing:
            conn.execute(text(
                "UPDATE voice_profiles SET cloned_preview_path = source_audio_path, source_audio_path = NULL "
                "WHERE source_audio_path LIKE '%design_%' AND (cloned_preview_path IS NULL OR cloned_preview_path = '')"
            ))
            count = conn.execute(text(
                "SELECT changes()"
            )).scalar()
            if count:
                logger.info(f"[migration] P12: moved {count} design source → preview")

        # Step 2: drop audio_path and original_audio_path via table recreate
        columns = conn.execute(text("PRAGMA table_info(voice_profiles)")).fetchall()
        drop_cols = {"audio_path", "original_audio_path"}
        keep_cols = [c for c in columns if c[1] not in drop_cols]
        if len(keep_cols) == len(columns):
            # No columns to drop (already clean)
            return

        col_defs = []
        for col in keep_cols:
            cid, name, col_type, notnull, default_val, pk = col
            not_null = " NOT NULL" if notnull else ""
            default = f" DEFAULT {default_val}" if default_val is not None else ""
            pk_str = " PRIMARY KEY" if pk else ""
            col_defs.append(f"{name} {col_type}{not_null}{default}{pk_str}")

        fk_list = conn.execute(text("PRAGMA foreign_key_list(voice_profiles)")).fetchall()
        fk_stmts = []
        for fk in fk_list:
            fk_stmts.append(
                f"FOREIGN KEY ({fk[3]}) REFERENCES {fk[2]}({fk[4]})"
                + (f" ON DELETE {fk[6]}" if fk[6] != "NO ACTION" else "")
            )

        col_sql = ", ".join(col_defs + fk_stmts)

        indexes = conn.execute(text("PRAGMA index_list(voice_profiles)")).fetchall()
        index_stmts = []
        for idx in indexes:
            idx_name = idx[1]
            if idx_name.startswith("sqlite_"):
                continue  # skip internal SQLite indexes
            unique = "UNIQUE " if idx[2] else ""
            cols = conn.execute(text(f"PRAGMA index_info({idx_name})")).fetchall()
            col_names = ", ".join(c[2] for c in cols)
            index_stmts.append(f"CREATE {unique}INDEX IF NOT EXISTS {idx_name} ON voice_profiles ({col_names})")

        conn.execute(text("ALTER TABLE voice_profiles RENAME TO voice_profiles_old"))
        conn.execute(text(f"CREATE TABLE voice_profiles ({col_sql})"))
        col_names = ", ".join(c[1] for c in keep_cols)
        conn.execute(text(f"INSERT INTO voice_profiles ({col_names}) SELECT {col_names} FROM voice_profiles_old"))
        conn.execute(text("DROP TABLE voice_profiles_old"))
        for stmt in index_stmts:
            conn.execute(text(stmt))

        logger.info("[migration] P12: dropped audio_path and original_audio_path columns")
    except Exception as e:
        logger.warning(f"[migration] P12 skipped: {e}")


def _migrate_absolute_to_relative(conn):
    """P13: convert absolute paths in voice_profiles to relative paths (幂等)."""
    import logging
    from pathlib import Path as FsPath
    from app.core.config import settings
    logger = logging.getLogger(__name__)
    try:
        existing = {c["name"] for c in inspect(conn).get_columns("voice_profiles")}
        path_cols = [c for c in ("source_audio_path", "cloned_preview_path") if c in existing]
        if not path_cols:
            return

        base = settings.base_dir
        for col in path_cols:
            rows = conn.execute(text(f"SELECT rowid, {col} FROM voice_profiles WHERE {col} IS NOT NULL")).fetchall()
            updated = 0
            for rowid, val in rows:
                p = FsPath(val)
                if p.is_absolute():
                    try:
                        rel = str(p.relative_to(base)).replace("\\", "/")
                    except ValueError:
                        rel = str(p).replace("\\", "/")
                    if rel != val:
                        conn.execute(text(f"UPDATE voice_profiles SET {col} = :rel WHERE rowid = :rid"), {"rel": rel, "rid": rowid})
                        updated += 1
            if updated:
                logger.info(f"[migration] P13: converted {updated} absolute paths in {col}")
    except Exception as e:
        logger.warning(f"[migration] P13 skipped: {e}")


def init_db():
    Base.metadata.create_all(bind=engine)
    # 跑 P2 v2 + v3 列迁移 (幂等)
    with engine.begin() as conn:
        for stmt in _P2_V2_ALTER_STMTS + _P2_V3_ALTER_STMTS + _P3_ROLE_PROSODY_ALTER_STMTS + _P4_ROLE_KIND_ALTER_STMTS + _P5_VOICE_AVATAR_ALTER_STMTS + _P6_CLONE_AUDIO_PATHS_ALTER_STMTS + _P7_SOURCE_DOCUMENT_ALTER_STMTS + _P8_PROMPT_TEXT_ALTER_STMTS + _P9_VOICE_PROJECT_SCOPE_ALTER_STMTS + _P10_VOICE_ENGINE_ALTER_STMTS + _P11_SOURCE_AUDIO_ALTER_STMTS + _P12_VOICE_REF_ALTER_STMTS:
            if _run_alter_or_skip(conn, stmt):
                import logging
                logging.getLogger(__name__).info(f"[migration] applied: {stmt}")
        # P11 data migration: copy audio_path → source_audio_path
        _migrate_source_audio_path(conn)
        # P12: move design source→preview, drop audio_path/original_audio_path
        _migrate_design_preview_and_drop_legacy(conn)
        # P13: convert absolute paths to relative paths
        _migrate_absolute_to_relative(conn)