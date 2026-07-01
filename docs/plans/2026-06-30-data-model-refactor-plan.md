# 数据模型重构计划 (TDD)

> 基于 `docs/segment-voice-refactor.md` 的设计方案。
> 单用户项目，无存量前端数据包袱，直接硬切换，不需要迁移兼容层。

## 重构范围

| 表 | 当前列 | 目标列 | 删除内容 |
|----|--------|--------|---------|
| `segmented_project_segments` | 26 | 16 | project_id / ssml / params / voice_ref / locked_params / audio_missing / ssml_annotated_by_llm / current_audio_path / previous_audio_path / audio_format / duration_sec / narration 5 列 / prosody_marks / role_snapshot |
| `voice_profiles` | 23 | 12 | qwen_voice_id / external_audio_url / mimo_voice_id / prompt_text / clone_engine / voice_engine_type / engine_type / engine_sub_type / is_cloned / cloned_at / role |
| `roles` | 10 | 8 | default_engine / default_voice / default_engine_params→voice |

## Phase 0：类型 + 核心函数（1h）

**先写测试，再写实现。**

### 0.1 新类型定义

**文件**: `frontend/src/types/index.ts` — 直接替换旧类型

```typescript
// 辨识联合：每种引擎只定义自己的字段
type EngineParams = EdgeTTSParams | MiMoParams | CosyVoiceParams | VoxCPMParams;

// Segment 音色来源（三层继承模型）
type VoiceSource =
  | { source: 'chapter' }
  | { source: 'role'; role_id: string }
  | { source: 'custom'; engine: EngineParams['engine']; params: Record<string, unknown>; role_id?: string };

// VoiceProfile 引擎信息（替代 11 列平铺字段）
type VoiceEngine = {
  type: 'qwen' | 'mimo' | 'voxcpm';
  qwen_voice_id?: string;
  mimo_voice_id?: string;
  external_audio_url?: string;
  prompt_text?: string;
  is_cloned?: boolean;
  cloned_at?: string;
};

// 精简后的 Segment
interface Segment {
  id: string;
  text: string;
  voice: VoiceSource;
  status: SegmentStatus;
  error?: string;
  audio: {
    current?: { id?: string; path?: string };
    previous?: { id?: string; path?: string };
    format: string;
    duration_sec?: number;
  };
  generated_params?: Partial<EngineParams>;
  emotion?: EmotionType;
  role_id?: string | null;
  segment_kind: SegmentKind;
  created_at: string;
  updated_at: string;
}

// 精简后的 Role
interface Role {
  id: string;
  name: string;
  avatar?: string | null;
  description?: string | null;
  role_kind: 'narrator' | 'cast';
  voice: EngineParams;
  favorite_styles: FavoriteStyle[];
  created_at: string;
  updated_at: string;
}

// 精简后的 VoiceProfile
interface VoiceProfile {
  id: string;
  name: string;
  source_audio_path?: string;
  cloned_preview_path?: string;
  description?: string;
  avatar?: string | null;
  project_id?: string | null;
  role_kind: 'narrator' | 'cast';
  engine: VoiceEngine;
  created_at: string;
  updated_at: string;
}

// 精简后的 Chapter（删除 narration 5 列）
interface Chapter {
  id: string;
  name: string;
  original_text?: string;
  design_title?: string;
  segments: Segment[];
  default_params: EngineParams;
  split_config: SplitConfig;
  panel_open: boolean;
  created_at: string;
  updated_at: string;
}
```

### 0.2 核心函数

**文件**: `frontend/src/services/voiceResolution.ts`（新建）

```typescript
function resolveEffectiveVoice(
  segVoice: VoiceSource,
  role: Role | undefined,
  chapterDefaults: EngineParams,
): EngineParams

function isAudioStale(
  current: EngineParams,
  generated: Partial<EngineParams> | undefined,
): boolean
```

### 0.3 测试 Phase 0

**文件**: `frontend/src/services/__tests__/voiceResolution.test.ts`（新建）

| # | 用例 | 输入 | 期望 |
|---|------|------|------|
| 1 | chapter source | `{source:'chapter'}`, chapter={edge_tts} | → edge_tts params |
| 2 | role source | `{source:'role',role_id:'r1'}`, role.voice={mimo_tts} | → merge(chapter, role) |
| 3 | custom source | `{source:'custom',engine:'mimo_tts',params:{instruction:'急'}}` | → merge(chapter, role?, custom) |
| 4 | custom overrides chapter | custom.params.instruction 覆盖 chapter.instruction | custom 优先 |
| 5 | role overrides chapter | role.voice 覆盖 chapter defaults | role 优先 |
| 6 | custom overrides role AND chapter | custom.params 最优先 | custom > role > chapter |
| 7 | isAudioStale - match | current == generated | false |
| 8 | isAudioStale - engine diff | engine 不同 | true |
| 9 | isAudioStale - param diff | instruction 不同 | true |
| 10 | isAudioStale - undefined generated | generated === undefined | false |
| 11 | isAudioStale - extra key in generated | generated 有额外 key | false |

---

## Phase 1：前端业务逻辑切换（2h）

### 1.1 逐文件改造（红→绿）

| # | 文件 | 改动 |
|---|------|------|
| 1 | `types/index.ts` | 用 Phase 0 的新类型直接替换（删旧类型） |
| 2 | `services/segmentGenerationInputs.ts` | 用 `resolveEffectiveVoice()` 替代 `buildSegmentGenerationInputs()` |
| 3 | `services/segmentGenerationInputs.ts` | 用 `isAudioStale()` 替代 `pickDurableEngineParams` 白名单对比 |
| 4 | `pages/TTSSynthesis.tsx` | `handleRegenerate` / `handleSynthesize` 用新字段 |
| 5 | `pages/TTSSynthesis.tsx` | `handleApplyAnalysis` 用新字段创建 segment |
| 6 | `pages/TTSSynthesis.tsx` | 删除所有 `seg.params.xxx` / `overrides.includes()` / `voice_ref` 引用 |
| 7 | `services/api.ts` | ttsApi 接口适配新 params 格式 |
| 8 | `components/ProjectVoices/` | 适配 `voice_profile.engine` |
| 9 | `components/SegmentedTTS/` | 适配 `seg.voice` + `seg.audio` |
| 10 | `components/ProjectLibrary/` | 适配新 segment + chapter 结构 |
| 11 | `components/ApplyAnalysisDialog.tsx` | 适配新 role 结构 |
| 12 | `services/indexedDB.ts` | `collectAudioIds` 适配 `seg.audio` |
| 13 | `services/segmentedProjectDB.ts` | 同适配 audio 字段 |
| 14 | `hooks/useSegmentedDraftSync.ts` | 适配新字段 |
| 15 | `hooks/useSegmentedProject.ts` | reducer 适配新字段 |

### 1.2 前端测试更新

| 文件 | 操作 |
|------|------|
| `voiceResolution.test.ts` | 新增（Phase 0 已写） |
| `segmentGenerationInputs.test.ts` | 用 `resolveEffectiveVoice` 重写 |
| `TTSSynthesis.studioChrome.test.tsx` | 用新 segment mock |
| `ChatSegmentView.studio.test.tsx` | 新 segment mock |
| `SegmentList.studioRoles.test.tsx` | 新 segment mock |
| `ProjectVoices.test.tsx` | 新 engine 字段 |
| `ProjectLibrary.test.tsx` | 新 segment + chapter 字段 |
| `ProjectLibrary.test.tsx` (分析流程) | 新 segment mock |
| `ApplyAnalysisDialog.test.tsx` | 新 role 结构 |
| `segmentedProjectDB.test.ts` | 新 audio 字段 |
| `backendSegmentedProjectStorage.test.ts` | 新字段（如有涉及） |
| `useSegmentedProject.test.ts` | 新 segment 字段 |

---

## Phase 2：Alembic 迁移 + SQLAlchemy（2h）

### 2.1 迁移脚本

```sql
-- segments
ALTER TABLE segmented_project_segments ADD COLUMN voice JSON NOT NULL DEFAULT '{"source":"chapter"}';
ALTER TABLE segmented_project_segments ADD COLUMN audio JSON;
-- 数据迁移: Python 逐行转换
-- DROP 旧列 (project_id/ssml/params/voice_ref/locked_params/audio_missing/ssml_annotated_by_llm/current_audio_path/previous_audio_path/audio_format/duration_sec/prosody_marks/role_snapshot)

-- chapters: 删除 narration 列
ALTER TABLE segmented_project_chapters DROP COLUMN narration_document_id;
ALTER TABLE segmented_project_chapters DROP COLUMN narration_version;
ALTER TABLE segmented_project_chapters DROP COLUMN narration_slice_start;
ALTER TABLE segmented_project_chapters DROP COLUMN narration_slice_end;
ALTER TABLE segmented_project_chapters DROP COLUMN narration_synced_at;

-- projects
ALTER TABLE segmented_projects DROP COLUMN active_narration_version;

-- voice_profiles
ALTER TABLE voice_profiles ADD COLUMN engine JSON NOT NULL DEFAULT '{}';
-- 数据迁移: Python 逐行转换
-- DROP 旧列 (qwen_voice_id/external_audio_url/mimo_voice_id/prompt_text/clone_engine/is_cloned/cloned_at/voice_engine_type/engine_type/engine_sub_type/role)

-- roles
ALTER TABLE roles ADD COLUMN voice JSON NOT NULL DEFAULT '{"engine":"edge_tts","params":{}}';
-- 数据迁移: Python 逐行转换
-- DROP 旧列 (default_engine/default_voice)
```

### 2.2 SQLAlchemy 模型

直接替换 `backend/app/models/segmented_project.py`、`voice_profile.py`、`role.py` 中的模型定义。

### 2.3 后端测试更新

| 文件 | 操作 |
|------|------|
| `test_voice_profile_model.py` | 适配 engine 字段 |
| `test_segmented_project_service.py` | 适配 voice/audio，删除 prosody_marks/voice_ref/role_snapshot 断言 |
| `test_segmented_synthesis.py` | 适配新 params 格式 |
| `test_segmented_projects_service.py` | 适配新字段 |

---

## Phase 3：后端业务逻辑重构 + 死代码删除（2h）

### 3.1 改造

| 文件 | 改动 |
|------|------|
| `services/segmented_project_service.py` | `synthesize_segment` 用 `role.voice` 替代 `role_snapshot` |
| `services/segmented_project_service.py` | 删除 `_get_voice_info`（voice_ref 相关） |
| `services/segmented_project_service.py` | 删除 `should_use_split_fallback` |
| `services/segmented_project_service.py` | 删除 narration 字段序列化 |
| `services/segmented_project_service.py` | 适配 `audio` JSON 字段 + `voice` JSON 字段 |
| `services/role_service.py` | `role_to_out` 用新 `voice` 字段 |
| `api/clone.py` | 适配 `voice_profile.engine` |
| `api/mimo_tts.py` | 适配 `voice_profile.engine` |
| `api/narrations.py` | 删除整个文件（死代码） |

### 3.2 死代码删除清单

| 后端 | 前端 |
|------|------|
| `should_use_split_fallback()` | `SegmentEngineParams` 类型 |
| `_get_voice_info()` (voice_ref builder) | `VoiceRef` 类型 |
| narration_* 列 + FK | `overrides` / `locked_params` 类型 |
| `active_narration_version` 列 | `generated_voice_id` 字段 |
| `audio_missing` 列 | `ssml_annotated_by_llm` 字段 |
| `project_id` 列 (segment) | `ssml` 字段（segment 层级） |
| `narrations` API 路由 | 旧的 `current_audio_id/path` 等 4 字段 |
| — | `prosody_marks` 类型 + 引用 |

---

## Phase 4：集成验证（1h）

- [ ] `npm run lint` + `npx tsc --noEmit` + `npx vitest run` 全绿
- [ ] `uv run --extra test pytest -q` 全绿
- [ ] `npx vite build` 成功
- [ ] 创建新项目 → 分配合成 → stale 检测
- [ ] 后端存量项目 → 迁移后正常打开
- [ ] 角色编辑 → segment stale 标记
- [ ] 智能解析 → 创建 + 合成
- [ ] 旧源码文件 `rm scripts/*.sql`（清理旧的 SQL dump）

---

## Phase 5：文档刷新（0.5h）

| 文档 | 内容 |
|------|------|
| `docs/database-schema.md` | 三张表新 DDL + ER 图 |
| `docs/api-reference.md` | Segment/Chapter/Role/VoiceProfile 新响应格式 |
| `docs/roadmap.md` | 标记本重构完成 |
| `.agents/rules/common/patterns.md` | 添加「引擎参数用辨识联合，默认值不拍平」规则 |
| `.agents/rules/typescript/coding-style.md` | `VoiceSource` / `EngineParams` 使用规范 |
| `.agents/rules/python/coding-style.md` | SQLAlchemy JSON 列规范 |
