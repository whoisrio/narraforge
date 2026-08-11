"""步骤 3A/3B：supabase/schema.sql 与 SQLAlchemy 模型定义的同步校验（防漂移）。

schema.sql 是 workers 模式 Supabase/Postgres 的 DDL，从模型定义手工导出；
本测试锁定两边一致，模型改动时必须同步更新 schema.sql：
- 7 张表的表名集合一致（3B 新增 segmented 三大表）；
- 每张表的列名集合一致；
- 主键一致；
- 模型 nullable=False 的列在 DDL 中必须是 NOT NULL；
- 模型声明的 ForeignKey 在 DDL 中必须有对应 references（含 alter table 补的环状 FK）。
"""
import re
from pathlib import Path

import pytest

from app.models.role import Role
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
from app.models.source_document import SourceDocument
from app.models.system_config import SystemConfig
from app.models.voice_profile import VoiceProfile

SCHEMA_PATH = Path(__file__).resolve().parent.parent.parent / "supabase" / "schema.sql"

MODELS = {
    "voice_profiles": VoiceProfile,
    "system_configs": SystemConfig,
    "roles": Role,
    "source_documents": SourceDocument,
    "segmented_projects": SegmentedProject,
    "segmented_project_chapters": SegmentedProjectChapter,
    "segmented_project_segments": SegmentedProjectSegment,
}

# DDL 列定义里非列名的前导关键字（约束/表级定义）
_CONSTRAINT_KEYWORDS = {"primary", "foreign", "unique", "constraint", "check"}


def _parse_schema(sql: str) -> dict[str, dict[str, str]]:
    """解析 CREATE TABLE 块 → {table: {column: 定义行原文}}。"""
    tables: dict[str, dict[str, str]] = {}
    for match in re.finditer(
        r"create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)\s*\((.*?)\n\);",
        sql,
        re.IGNORECASE | re.DOTALL,
    ):
        table, body = match.group(1), match.group(2)
        columns: dict[str, str] = {}
        for line in body.splitlines():
            line = line.strip().rstrip(",")
            if not line or line.startswith("--"):
                continue
            first = line.split()[0].strip('"').lower()
            if first in _CONSTRAINT_KEYWORDS:
                continue
            columns[first] = line
        tables[table] = columns
    return tables


@pytest.fixture(scope="module")
def ddl() -> dict[str, dict[str, str]]:
    assert SCHEMA_PATH.exists(), f"missing {SCHEMA_PATH}"
    return _parse_schema(SCHEMA_PATH.read_text(encoding="utf-8"))


class TestSchemaSync:
    def test_table_set_matches(self, ddl):
        assert set(ddl.keys()) == set(MODELS.keys())

    @pytest.mark.parametrize("table,model", list(MODELS.items()))
    def test_column_set_matches(self, ddl, table, model):
        model_columns = {c.name for c in model.__table__.columns}
        assert set(ddl[table].keys()) == model_columns, (
            f"{table}: schema.sql={sorted(ddl[table].keys())} model={sorted(model_columns)}"
        )

    @pytest.mark.parametrize("table,model", list(MODELS.items()))
    def test_primary_keys_match(self, ddl, table, model):
        model_pks = {c.name for c in model.__table__.primary_key.columns}
        for pk in model_pks:
            col_def = ddl[table][pk].lower()
            assert "primary key" in col_def, f"{table}.{pk} must be primary key in schema.sql"

    @pytest.mark.parametrize("table,model", list(MODELS.items()))
    def test_not_null_columns_match(self, ddl, table, model):
        # DDL 有意比模型更严的列：时间戳列在 Postgres 强制 NOT NULL + default now()
        # （模型侧靠 Python default 兜底、声明 nullable；数据实际从不为空）
        ddl_stricter = {("voice_profiles", "created_at"), ("system_configs", "updated_at"),
                        ("roles", "created_at"), ("roles", "updated_at"),
                        ("segmented_projects", "created_at"), ("segmented_projects", "updated_at"),
                        ("segmented_project_chapters", "created_at"),
                        ("segmented_project_chapters", "updated_at"),
                        ("segmented_project_segments", "created_at"),
                        ("segmented_project_segments", "updated_at")}
        for col in model.__table__.columns:
            col_def = ddl[table][col.name].lower()
            if not col.nullable and not col.primary_key:
                assert "not null" in col_def, f"{table}.{col.name} should be NOT NULL"
            elif col.nullable and (table, col.name) not in ddl_stricter:
                assert "not null" not in col_def, f"{table}.{col.name} should be nullable"

    @pytest.mark.parametrize("table,model", list(MODELS.items()))
    def test_json_columns_use_jsonb(self, ddl, table, model):
        from sqlalchemy import JSON

        for col in model.__table__.columns:
            if isinstance(col.type, JSON):
                assert "jsonb" in ddl[table][col.name].lower(), (
                    f"{table}.{col.name}: JSON 列在 Postgres 用 jsonb"
                )

    @pytest.mark.parametrize("table,model", list(MODELS.items()))
    def test_foreign_keys_present(self, ddl, table, model):
        """模型的每个 ForeignKey 必须在 DDL 全文中出现对应 references（含环状 FK 的 alter table）。"""
        full_sql = SCHEMA_PATH.read_text(encoding="utf-8").lower()
        for col in model.__table__.columns:
            for fk in col.foreign_keys:
                target = f"{fk.column.table.name}({fk.column.name})".lower()
                pattern = rf"references\s+{re.escape(target)}"
                assert re.search(pattern, full_sql), (
                    f"{table}.{col.name}: schema.sql 缺少 references {target}"
                )
