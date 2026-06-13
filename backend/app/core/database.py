from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

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
    # segment 级: 完整动画规格 (JSON 字符串)
    "ALTER TABLE segmented_project_segments ADD COLUMN animation_spec_json TEXT",
)


def _run_alter_or_skip(conn, stmt: str) -> bool:
    """执行 ALTER TABLE. 列已存在时 (sqlite: 'duplicate column name') 跳过.

    Returns True if executed, False if skipped.
    """
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
        for stmt in _P2_V2_ALTER_STMTS + _P2_V3_ALTER_STMTS:
            if _run_alter_or_skip(conn, stmt):
                import logging
                logging.getLogger(__name__).info(f"[migration] applied: {stmt}")