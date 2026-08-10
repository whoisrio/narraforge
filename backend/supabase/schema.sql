-- NarraForge workers 模式 Supabase/Postgres schema（步骤 3A）
-- 从 SQLAlchemy 模型导出（backend/app/models/），由 tests/unit/test_supabase_schema_sync.py
-- 锁定同步：模型改动必须同步更新本文件。
--
-- 类型映射：String/Text → text，JSON → jsonb，DateTime → timestamptz（存 UTC），
-- Integer → integer，Float → double precision。
-- 主键策略：所有主键都是应用侧生成的字符串（uuid / src_xxx / 前端传入 id），
-- 与 SQLite 一致，不用 serial/identity。
--
-- 注意（3A 范围）：
-- - segmented_projects / segmented_project_chapters / segmented_project_segments
--   三张表在步骤 3B 迁移。voice_profiles.project_id、roles.project_id、
--   source_documents.project_id 的 FOREIGN KEY 届时一并补上（当前仅保留普通列，
--   引用完整性由应用层保证）。
-- - 时间戳默认值由 DB 兜底（now()）；updated_at 的刷新由仓储层显式写入
--   （PostgREST 不走 ORM onupdate）。

create table if not exists voice_profiles (
    id text primary key,
    name text not null,
    description text,
    avatar text,
    project_id text,  -- 3B 补 FK → segmented_projects(id) on delete set null
    voice jsonb not null default '{}'::jsonb,
    voice_params jsonb not null default '{}'::jsonb,
    preview jsonb,
    created_at timestamptz not null default now()
);

create table if not exists system_configs (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
);

create table if not exists roles (
    id text primary key,
    name text not null,
    avatar text,
    description text,
    role_kind text not null default 'cast',
    project_id text,  -- 3B 补 FK → segmented_projects(id) on delete set null
    voice jsonb not null default '{"engine": "edge_tts", "params": {}}'::jsonb,
    favorite_styles jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists source_documents (
    id text primary key,
    project_id text not null,  -- 3B 补 FK → segmented_projects(id) on delete cascade
    source_type text not null,  -- 'paste' | 'audio' | 'path'
    title text not null,
    file_path text,
    pasted_text text,
    audio_path text,
    file_size integer,
    duration_sec double precision,
    created_at timestamptz not null default now()
);

create index if not exists idx_source_documents_project_id on source_documents (project_id);
