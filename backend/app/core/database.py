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


def init_db():
    Base.metadata.create_all(bind=engine)
    # 跑 P2 v2 + v3 列迁移 (幂等)
    with engine.begin() as conn:
        for stmt in _P2_V2_ALTER_STMTS + _P2_V3_ALTER_STMTS + _P3_ROLE_PROSODY_ALTER_STMTS + _P4_ROLE_KIND_ALTER_STMTS + _P5_VOICE_AVATAR_ALTER_STMTS + _P6_CLONE_AUDIO_PATHS_ALTER_STMTS + _P7_SOURCE_DOCUMENT_ALTER_STMTS:
            if _run_alter_or_skip(conn, stmt):
                import logging
                logging.getLogger(__name__).info(f"[migration] applied: {stmt}")