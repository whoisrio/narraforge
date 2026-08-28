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
    constraint uq_chapter_project_position unique (project_id, position) deferrable initially deferred
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
    text_transforms jsonb,  -- 合成时文本变换: {applied_map_ids, lowercase_latin}
    generated_at timestamptz,
    animation_spec_json text,  -- 模型侧是 Text（JSON 字符串），对齐不用 jsonb
    split_anchor jsonb,        -- layer-sync Phase B: {offset_start, offset_end, baseline_text}
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_segment_chapter_position unique (chapter_id, position) deferrable initially deferred
);

create index if not exists ix_segments_chapter_id on segmented_project_segments (chapter_id);

-- 既有部署的增量列（create table 块已含；此处为已建表环境补列，幂等）
alter table segmented_project_segments add column if not exists text_transforms jsonb;

-- 既有部署：将排序唯一约束改为可延迟，使 save_project 的批量 upsert 能安全处理
-- 章节/段落重排序（重排 [0,1]→[1,0] 时，逐行检查会瞬间撞 (project_id,position)
-- 唯一约束，延迟到语句末检查才能通过）。
-- 注意：Postgres 不允许用 ALTER 把「唯一约束」改为可延迟（ALTER 仅对外键/CHECK 有效），
-- 只能删除后以 DEFERRABLE 重建。DROP 幂等（不存在则跳过），重建出的约束名与建表块一致。
alter table segmented_project_chapters
  drop constraint if exists uq_chapter_project_position,
  add constraint uq_chapter_project_position unique (project_id, position) deferrable initially deferred;
alter table segmented_project_segments
  drop constraint if exists uq_segment_chapter_position,
  add constraint uq_segment_chapter_position unique (chapter_id, position) deferrable initially deferred;

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

-- 用量计量事件（Phase 3）：TTS/LLM 计费原料。kind='tts' 时 token 恒 0；
-- estimated=true 表示 token 为字符估算（非 API 返回）。project_id 可空
-- （无项目上下文的 LLM 调用归 NULL 桶）。
create table if not exists usage_events (
    id text primary key,
    project_id text,
    kind text not null,
    chars integer not null default 0,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    estimated boolean not null default false,
    created_at timestamptz default now()
);

-- 环状 FK：segmented_projects.default_narrator_role_id → roles(id)
-- （roles 在 segmented_projects 之后建表，只能后置补约束）
alter table segmented_projects
    add constraint fk_project_default_narrator_role
    foreign key (default_narrator_role_id) references roles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 多用户数据归属（M2）：user_id 归属列。
-- 只加在六张顶层表中的五张（model_providers 在 Supabase 侧不存在——
-- 模型配置存于 system_configs，全局共享，故不加）；chapters/segments 不加
-- （归属经 project 传递，仓储层先校验 project 归属再操作）。
-- nullable：存量行回填前为 NULL（匿名/旧数据），回填脚本见
-- backend/scripts/backfill_user_ownership.py。local SQLite 模型不加此列
-- （local 单用户无认证），本文件是 Postgres-only 超集。
-- ---------------------------------------------------------------------------
alter table segmented_projects add column if not exists user_id uuid;
alter table voice_profiles add column if not exists user_id uuid;
alter table roles add column if not exists user_id uuid;
alter table source_documents add column if not exists user_id uuid;
alter table tts_results add column if not exists user_id uuid;
alter table usage_events add column if not exists user_id uuid;

create index if not exists idx_segmented_projects_user_id on segmented_projects (user_id);
create index if not exists idx_voice_profiles_user_id on voice_profiles (user_id);
create index if not exists idx_roles_user_id on roles (user_id);
create index if not exists idx_source_documents_user_id on source_documents (user_id);
create index if not exists idx_tts_results_user_id on tts_results (user_id);
create index if not exists idx_usage_events_user_id on usage_events (user_id);
create index if not exists idx_usage_events_project_id on usage_events (project_id);

-- ---------------------------------------------------------------------------
-- 用户档案与使用统计（M2/M5，Supabase Auth 用户体系）
-- profiles.id = Supabase Auth user id（auth.users.id），由后端统计中间件
-- 首见时 upsert（service key 直写，不建 FK 到 auth.users，避免 auth schema 耦合）。
-- ---------------------------------------------------------------------------
create table if not exists profiles (
    id uuid primary key,
    email text,
    created_at timestamptz not null default now(),
    last_seen_at timestamptz,
    is_admin boolean not null default false
);

-- 按日计数指标（visit_authed / visit_anon / synthesize 等），经 RPC
-- increment_metric 原子 +1（避免读-改-写竞态）。
create table if not exists daily_stats (
    date date not null,
    metric text not null,
    count bigint not null default 0,
    primary key (date, metric)
);

-- 变更类操作审计（POST/PUT/DELETE，剔除轮询与管理端路径）
create table if not exists operation_logs (
    id bigint generated always as identity primary key,
    user_id uuid,
    action text,
    method text,
    path text,
    status integer,
    duration_ms integer,
    created_at timestamptz not null default now()
);

create index if not exists idx_operation_logs_created_at on operation_logs (created_at);
create index if not exists idx_operation_logs_user_id on operation_logs (user_id);

create table if not exists daily_active_users (
    date date not null,
    user_id uuid not null,
    primary key (date, user_id)
);

-- 原子计数 +1：PostgREST RPC（post /rest/v1/rpc/increment_metric）
create or replace function increment_metric(p_date date, p_metric text)
returns void
language sql
as $$
    insert into daily_stats (date, metric, count)
    values (p_date, p_metric, 1)
    on conflict (date, metric)
    do update set count = daily_stats.count + 1;
$$;

-- Try 页（/try 获客页）匿名合成限流计数：key = "<scope>:<ip>"，按天计数。
-- local 单用户模式用不到（不进模型层）。
create table if not exists rate_limit_counters (
    key text not null,
    day date not null,
    count bigint not null default 0,
    primary key (key, day)
);

-- 原子 +1 并返回新计数（post /rest/v1/rpc/hit_rate_limit）；
-- 由 app/core/rate_limit.py 的 SupabaseRateLimitStore 调用。
create or replace function hit_rate_limit(p_key text, p_day date)
returns bigint
language sql
as $$
    insert into rate_limit_counters (key, day, count)
    values (p_key, p_day, 1)
    on conflict (key, day)
    do update set count = rate_limit_counters.count + 1
    returning count;
$$;

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
