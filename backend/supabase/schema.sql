-- NarraForge workers 模式 Supabase/Postgres schema（步骤 3A/3B）
-- 从 SQLAlchemy 模型导出（backend/app/models/），由 tests/unit/test_supabase_schema_sync.py
-- 锁定同步：模型改动必须同步更新本文件。
--
-- 类型映射：String/Text → text，JSON → jsonb，DateTime → timestamptz（存 UTC），
-- Integer → integer，Float → double precision。
-- 主键策略：所有主键都是应用侧生成的字符串（uuid / src_xxx / 前端传入 id），
-- 与 SQLite 一致，不用 serial/identity。
--
-- 建表顺序：segmented_projects 与 roles 互相引用（环状 FK），先建
-- segmented_projects（FK 后置 alter table 补上），其余按被引用 → 引用顺序。
-- 时间戳默认值由 DB 兜底（now()）；updated_at 的刷新由仓储层显式写入
-- （PostgREST 不走 ORM onupdate）。

create table if not exists segmented_projects (
    id text primary key,
    name text not null,
    schema_version integer not null default 2,
    layout text not null default 'vertical',
    active_chapter_id text,
    original_text text,
    animation_theme text,
    remotion_project_path text,
    source_document text,  -- workers 模式直接存内容（本地模式已弃用，内容落文件）
    source_document_path text,
    narration_document_path text,
    default_narrator_role_id text,  -- FK → roles(id)，见文件末尾 alter table（环状依赖）
    configs jsonb,
    logo text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists voice_profiles (
    id text primary key,
    name text not null,
    description text,
    avatar text,
    project_id text references segmented_projects(id) on delete set null,
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
    project_id text references segmented_projects(id) on delete set null,
    voice jsonb not null default '{"engine": "edge_tts", "params": {}}'::jsonb,
    favorite_styles jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists source_documents (
    id text primary key,
    project_id text not null references segmented_projects(id) on delete cascade,
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

create table if not exists segmented_project_chapters (
    id text primary key,
    project_id text not null references segmented_projects(id) on delete cascade,
    position integer not null,
    name text not null,
    voice jsonb not null default '{}'::jsonb,
    split_config jsonb not null default '{}'::jsonb,
    original_text text,
    narration_script text,
    design_title text,
    sync_state jsonb,   -- layer-sync Phase A: {l1_hash, l2_hash, segments_hash}
    audio_adjust jsonb, -- post-synthesis adjust record: {tempo, volume_db, applied_at, segments}
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_chapter_project_position unique (project_id, position)
);

create index if not exists ix_chapters_project_id on segmented_project_chapters (project_id);

create table if not exists segmented_project_segments (
    id text primary key,
    chapter_id text not null references segmented_project_chapters(id) on delete cascade,
    position integer not null,
    text text not null default '',
    emotion text,
    role_id text references roles(id) on delete set null,
    segment_kind text not null default 'narration',
    voice jsonb not null default '{"source": "chapter"}'::jsonb,
    generated_params jsonb,
    audio jsonb,
    generated_at timestamptz,
    animation_spec_json text,  -- 模型侧是 Text（JSON 字符串），对齐不用 jsonb
    split_anchor jsonb,        -- layer-sync Phase B: {offset_start, offset_end, baseline_text}
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_segment_chapter_position unique (chapter_id, position)
);

create index if not exists ix_segments_chapter_id on segmented_project_segments (chapter_id);

-- TTS 合成历史（后端存储模式）：workers 模式下音频存 Supabase Storage
-- （audio_path 为 bucket key），记录存本表。
create table if not exists tts_results (
    id text primary key,
    text text not null,
    voice_id text not null,
    voice_name text,
    audio_path text not null,
    audio_format text default 'wav',
    speed double precision default 1.0,
    volume double precision default 80,
    pitch double precision default 1.0,
    instruction text,
    language text default 'Chinese',
    source text,
    created_at timestamptz default now()
);

-- 环状 FK：segmented_projects.default_narrator_role_id → roles(id)
-- （roles 在 segmented_projects 之后建表，只能后置补约束）
alter table segmented_projects
    add constraint fk_project_default_narrator_role
    foreign key (default_narrator_role_id) references roles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Storage bucket（步骤 6A-2）：workers 模式无 R2 binding 的部署（如 Render）
-- 把克隆样本/试听音频等二进制资产存 Supabase Storage。
-- bucket 名必须与后端 SUPABASE_STORAGE_BUCKET（默认 voice-assets）一致。
-- public=false：仅经 service key（后端）读写，音频仍由 API 端点服务。
-- 若本脚本在无 storage schema 的环境执行报错，可改为 Supabase 控制台
-- Storage → New bucket 手动创建（同名、Private）。
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('voice-assets', 'voice-assets', false)
on conflict (id) do nothing;
