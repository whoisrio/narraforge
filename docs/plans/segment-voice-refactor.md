# Segment 音色配置重构 —— 已实施

> **状态**: ✅ 已实施 (2026-06-30)
> **结果**: 三表共减少 25 列冗余字段，删除 narration/prosody_marks/role_snapshot 等死代码

## 一、旧结构（重构前）

### 1.1 类型定义

```typescript
// 前端: frontend/src/types/index.ts

interface SegmentEngineParams {
  engine: 'cosyvoice' | 'edge_tts' | 'mimo_tts' | 'voxcpm';

  // CosyVoice
  voice_id?: string;     instruction?: string;
  speed?: number;         volume?: number;
  pitch?: number;         language?: string;
  enable_ssml?: boolean;  enable_markdown_filter?: boolean;

  // Edge-TTS
  edge_voice?: string;    edge_rate?: string;    // '+0%'
  edge_volume?: string;

  // MiMo-TTS
  mimo_mode?: 'preset' | 'voiceclone' | 'voicedesign';
  mimo_preset_voice?: string;
  mimo_clone_voice_id?: string;
  mimo_instruction?: string;
  mimo_voice_description?: string;

  // VoxCPM
  voxcpm_mode?: 'tts' | 'design' | 'clone' | 'ultimate';
  voxcpm_voice_description?: string;
  voxcpm_style_control?: string;
  voxcpm_prompt_text?: string;
  voxcpm_cfg_value?: number;
  voxcpm_inference_timesteps?: number;

  input_method?: 'record' | 'upload' | 'url';
}

type SegmentStatus = 'idle' | 'queued' | 'pending' | 'ready' | 'failed';

interface Segment {
  id: string;
  text: string;
  ssml?: string;
  params: SegmentEngineParams;          // 所有引擎字段（22个）
  voice_ref?: VoiceRef;                 // 当前激活的音色引用
  status: SegmentStatus;
  error?: string;
  current_audio_id?: string;            // IndexedDB key
  previous_audio_id?: string;
  current_audio_path?: string;          // 后端文件路径
  previous_audio_path?: string;
  audio_format?: string;
  generated_params?: Record<string, unknown>; // 生成时的有效参数快照
  duration_sec?: number;
  ssml_annotated_by_llm?: boolean;
  emotion?: EmotionType;
  role_id?: string | null;
  role_snapshot?: RoleSnapshot | null;
  segment_kind?: SegmentKind;
  prosody_marks?: ProsodyMark[];
  overrides?: ('voice' | 'speed' | 'volume' | 'pitch' | 'instruction' | 'language')[];
  generated_voice_id?: string;          // 生成时实际使用的音色ID
  created_at: string;
  updated_at: string;
}
```

### 1.2 一个 segment 实际存储的数据

```json
{
  "id": "seg-001",
  "text": "往山那边走，那里有座破庙。",
  "params": {
    "engine": "mimo_tts",
    "mimo_mode": "voiceclone",
    "mimo_clone_voice_id": "v_01",
    "mimo_instruction": "急促",
    "voice_id": "v_01",
    "edge_voice": "",
    "edge_rate": "+0%",
    "edge_volume": "+0%",
    "voxcpm_mode": "tts",
    "voxcpm_cfg_value": 2.0,
    "voxcpm_inference_timesteps": 10,
    "speed": 1.0,
    "volume": 80,
    "pitch": 1.0,
    "language": "Chinese"
  },
  "overrides": ["voice"],
  "voice_ref": { "source": "role", "voice_id": "v_01", "engine": "mimo_tts", "role_id": "role_xm", "name": "小明" },
  "role_id": "role_xm",
  "role_snapshot": { "id": "role_xm", "name": "小明", "default_engine": "mimo_tts", ... },
  "generated_params": { "engine": "mimo_tts", "mimo_mode": "voiceclone", "mimo_clone_voice_id": "v_01", "mimo_instruction": "急促", "voice_id": "v_01", ... },
  "generated_voice_id": "v_01",
  "status": "ready",
  "current_audio_id": "audio_abc",
  "audio_format": "wav",
  "duration_sec": 2.3,
  "segment_kind": "dialogue"
}
```

**有效信息 ~15%**，其余 85% 是冗余/可推导。

### 1.3 合成时的读取逻辑

```typescript
// TTSSynthesis.tsx — handleRegenerate
const overrides = seg.overrides || [];
const hasVoiceLock = overrides.includes('voice');
const currentRole = seg.role_id ? roles.find(r => r.id === seg.role_id) : undefined;
const sp = currentRole?.default_engine_params
  ? { ...seg.params, ...currentRole.default_engine_params }
  : seg.params;
const gp = buildCurrentParams(); // 章节全局

// 逐字段用 overrides 判断是取自 sp 还是 gp
const voiceId = currentRole ? (sp.voice_id || '')
  : (hasVoiceLock ? sp.voice_id : (gp.voice_id || sp.voice_id));
const speed   = overrides.includes('speed')   ? sp.speed   : (currentRole ? sp.speed   : gp.speed)   ?? 1.0;
const volume  = overrides.includes('volume')  ? sp.volume  : (currentRole ? sp.volume  : gp.volume)  ?? 80;
const pitch   = overrides.includes('pitch')   ? sp.pitch   : (currentRole ? sp.pitch   : gp.pitch)   ?? 1.0;
// ... 每个字段手动重复同样的三目运算
```

`overrides` 数组承担了「判断字段来自哪层」的职责，但这个职责应该由存储模型本身解决。

---

## 二、改进后结构

### 2.1 类型定义

```typescript
// ── 每种引擎只定义自己需要的字段 ──

interface EdgeTTSParams {
  engine: 'edge_tts';
  voice: string;
  rate: string;   // '+0%'
  volume: string;
}

interface CosyVoiceParams {
  engine: 'cosyvoice';
  voice_id: string;
  instruction?: string;
  ssml?: string;                 // SSML 文本（CosyVoice 专属）
  speed?: number;
  volume?: number;
  pitch?: number;
  language?: string;
  enable_ssml?: boolean;
}

interface MiMoParams {
  engine: 'mimo_tts';
  mode: 'preset' | 'voiceclone' | 'voicedesign';
  voice_id: string;         // 统一 voice_id（preset 名、clone_voice_id、描述均可作为标识）
  instruction?: string;
  voice_description?: string;
}

interface VoxCPMParams {
  engine: 'voxcpm';
  mode: 'tts_design' | 'clone' | 'ultimate';
  voice_id: string;
  voice_description?: string;
  style_control?: string;
  prompt_text?: string;
  cfg_value?: number;
  inference_timesteps?: number;
}

type EngineParams = EdgeTTSParams | CosyVoiceParams | MiMoParams | VoxCPMParams;

// ── Segment 上的音色配置 ──

type VoiceSource =
  | { source: 'chapter' }                            // 完全跟随章节全局
  | { source: 'role';    role_id: string }            // 使用角色的默认音色
  | { source: 'custom';  engine: EngineParams['engine']; params: Partial<Omit<EngineParams, 'engine'>> }
  // source='custom' 时才存 engine + 与上层不同的字段
  // role_id 可选：有值时 params 与 role.default_engine_params 合并后作为最终参数
  ;

// ── 精简后的 Segment ──

interface Segment {
  id: string;
  text: string;
  voice: VoiceSource;                    // 替代 params + voice_ref + overrides + ssml
  status: SegmentStatus;
  error?: string;
  audio: {                               // 替代 current_audio_id/path + previous_audio_id/path
    current?: { id?: string; path?: string };
    previous?: { id?: string; path?: string };
    format: string;
    duration_sec?: number;
  };
  generated_params?: Partial<EngineParams>; // 生成快照（只存实际用到的引擎字段）
  emotion?: EmotionType;
  role_id?: string | null;
  role_snapshot?: RoleSnapshot | null;
  segment_kind: SegmentKind;
  prosody_marks?: ProsodyMark[];
  created_at: string;
  updated_at: string;
}
```

### 2.2 同一个 segment 改进后存什么

```json
{
  "id": "seg-001",
  "text": "往山那边走，那里有座破庙。",
  "voice": {
    "source": "role",
    "role_id": "role_xm"
  },
  "status": "ready",
  "audio": {
    "current": { "id": "audio_abc" },
    "format": "wav",
    "duration_sec": 2.3
  },
  "generated_params": {
    "engine": "mimo_tts",
    "mode": "voiceclone",
    "voice_id": "v_01",
    "instruction": "急促"
  },
  "role_id": "role_xm",
  "role_snapshot": { "id": "role_xm", "name": "小明", "default_engine": "mimo_tts" },
  "segment_kind": "dialogue"
}
```

**从 ~45 个字段减少到 ~12 个核心字段。**

### 2.3 合成时的读取逻辑

```typescript
// 一处定义，所有调用点复用
function resolveEffectiveVoice(
  segVoice: VoiceSource,
  role: Role | undefined,
  chapterDefaults: EngineParams,
): EngineParams {
  if (segVoice.source === 'chapter') return chapterDefaults;

  const roleParams = role?.default_engine_params;

  if (segVoice.source === 'role') {
    return roleParams
      ? (mergeDeep(chapterDefaults, roleParams) as EngineParams)
      : chapterDefaults;
  }

  // source === 'custom'
  const base = roleParams
    ? mergeDeep(chapterDefaults, roleParams)
    : chapterDefaults;
  return mergeDeep(base, { engine: segVoice.engine, ...segVoice.params }) as EngineParams;
}

// 使用:
const effective = resolveEffectiveVoice(seg.voice, currentRole, chapter.default_params);
mimoTtsApi.synthesizeVoiceClone({
  voice_id: effective.voice_id,
  instruction: effective.instruction,
  text: seg.text,
});
```

不再需要 `overrides` 数组，不再逐字段三目运算。读取逻辑集中在一个函数里。

---

## 三、对照表

| 维度 | 当前 | 改进后 |
|------|------|--------|
| segment 字段数 | ~32（含 params 的 22 个子字段） | ~18 |
| 音频引用 | 4 个独立字段 (current/previous _ id/path) | 1 个嵌套对象 `audio` |
| overrides 数组 | 需要显式维护，读写都要检查 | 不需要 — 没存 = 继承 |
| 引擎参数 | 所有引擎字段拍平，始终携带 | 辨识联合，只存当前引擎 |
| voice_ref | 额外推导字段，和 role_snapshot 重叠 | 移除，由 resolve 逻辑推导 |
| generated_voice_id | 独立字段，和 generated_params 重复 | 移除，generated_params 已有 engine+voice_id |
| 段级别参数继承 | overrides 数组事后标记 | 写入时不存默认值，读取时 merge |
| 读取有效参数 | 每个字段手写三目运算 | 一处 mergeDeep 调用 |
| 引擎切换时 | 需清除旧引擎字段 + 补齐新引擎默认 | 只改 voice.engine + voice.params |
| 后端 JSON 列 | 完整 params + overrides + locked_params | 只存 `{ source, role_id?, engine?, params? }` |

---

## 四、迁移兼容

新旧格式并存期间，加一层 `normalizeSegmentVoice` 兼容旧数据：

```typescript
function normalizeSegmentVoice(seg: SegmentV1): Segment {
  if ('voice' in seg) return seg as Segment; // 已是新格式

  // 从旧格式推导 voice source
  const hasOverrides = (seg.overrides?.length ?? 0) > 0;
  const hasRole = !!seg.role_id;

  let voice: VoiceSource;
  if (hasOverrides) {
    voice = { source: 'custom', engine: seg.params.engine, params: extractOverrides(seg) };
  } else if (hasRole) {
    voice = { source: 'role', role_id: seg.role_id };
  } else {
    voice = { source: 'chapter' };
  }

  return { ...seg, voice };
}
```

不影响旧数据读写，新 segment 写新格式，旧 segment 读取时秒转。

---

## 补充：其余结构问题

### 5. 双轨音频引用 → 统一 audio 对象

**当前** 每个 segment 存 4 个独立字段：

```json
{
  "current_audio_id":   "audio_abc",        // IndexedDB (前端模式)
  "previous_audio_id":  "audio_xyz",
  "current_audio_path": "/projects/p1/ch1/seg-1.mp3",  // 后端路径
  "previous_audio_path": null,
  "audio_format":        "wav",
  "duration_sec":        2.3
}
```

每次清理、对比、迁移都要同时维护两套路径。存储模式在项目级别已决定（`storageMode`），segment 层不需要同时存两个。

**改进后**：

```typescript
interface SegmentAudio {
  current:  { id?: string; path?: string };
  previous?: { id?: string; path?: string };
  format: string;
  duration_sec?: number;
}

interface Segment {
  audio: SegmentAudio;
  // 移除: current_audio_id, previous_audio_id,
  //       current_audio_path, previous_audio_path,
  //       audio_format, duration_sec
}
```

清理逻辑简化：

```typescript
// 当前: 每次都要处理 4 个字段
if (seg.current_audio_id)  await deleteTTSResult(seg.current_audio_id);
if (seg.previous_audio_id) await deleteTTSResult(seg.previous_audio_id);
if (seg.current_audio_id)  await ttsApi.deleteResult(seg.current_audio_id);
if (seg.previous_audio_id) await ttsApi.deleteResult(seg.previous_audio_id);

// 改进后: 一处遍历
for (const ref of [seg.audio.current, seg.audio.previous]) {
  if (!ref) continue;
  if (ref.id)   await deleteTTSResult(ref.id);
  if (ref.id)   await ttsApi.deleteResult(ref.id);
  if (ref.path) await deleteFile(ref.path);
}
```

---

### 6. 后端 `project_id` 冗余 FK

**当前** `segmented_project_segments` 表同时有 `chapter_id` 和 `project_id` 两个外键：

```sql
CREATE TABLE segmented_project_segments (
  chapter_id VARCHAR FK → segmented_project_chapters.id,
  project_id VARCHAR FK → segmented_projects.id,  -- 冗余
);
```

`project_id` 可以从 `chapter_id → chapter.project_id` 推导。维护两个 FK 意味着写入 segment 时必须同步传 `project_id`，且可能产生 `project_id` 和 `chapter.project_id` 不一致的脏数据。

**改进后**：移除 `project_id`，需要时通过 JOIN 获取：

```sql
-- 查询 segment 所属 project
SELECT p.* FROM segmented_projects p
JOIN segmented_project_chapters c ON c.project_id = p.id
WHERE c.id = seg.chapter_id;
```

**收益**：消除写入路径上的一致性问题，segment 创建/更新少一个必填参数。

---

### 7. `audio_missing` 应可推导

后端 segment 模型有 `audio_missing` 布尔列标记音频文件是否存在。这是文件系统状态的缓存副本 —— `os.path.exists(current_audio_path)` 可以直接得出。

**改进后**：删除该列，查询时动态判断：

```python
# 不在 ORM 模型上存 audio_missing
# 需要时:
has_audio = seg.current_audio_path and os.path.exists(
    settings.resolve_path(seg.current_audio_path)
)
```

**权衡**：多了一次 `os.path.exists` 调用。但音频文件状态本身是易变的（可能被外部清理），缓存值本身就有过期风险。动态判断反而更准确。

---

### 8. `overrides` / `locked_params` 应可推导

这两个字段本质上是「段级参数与章级默认参数的差异集」。当前显式存为数组，需要研发手动维护。改进后（配合 VoiceSource 重构），差异直接在 `voice.params` 中体现，不需要额外标记。

```typescript
// 当前: overrides 显式声明
{ params: { speed: 1.5, pitch: 1.0 }, overrides: ["speed"] }

// 改进后: params 里只写和上层不同的值，没写 = 继承
{ voice: { source: "custom", engine: "mimo_tts", params: { speed: 1.5 } } }
// pitch 不存在 → 从 role 或 chapter 继承，不需要显式标记
```

后端 `locked_params`（标识哪些 parameter 被前端锁定不跟随全局）同理，由 `voice.params` 存在的键名即可判断。

---

### 9. `voice_ref` 和 `role_snapshot` 职责重叠

`voice_ref` 描述「当前激活的音色来源」，`role_snapshot` 描述「角色的完整快照（含默认音色）」。一个 segment 挂了一个角色后，`role_snapshot.default_engine_params` 已经包含了角色的一切音色信息，`voice_ref` 是重复推导。

**改进后**：移除 `voice_ref`，音色来源由 `voice.source` 决定，具体参数通过 `resolveEffectiveVoice()` 从 `role_snapshot` 和 `chapter.default_params` 计算。

---

### 10. `generated_voice_id` 和 `generated_params` 双写

同一次合成的结果存了两处。`generated_params` 已经包含 `engine` 和 `voice_id`/`edge_voice` 等音色标识，`generated_voice_id` 是冗余提取。

**改进后**：只保留 `generated_params`（精简为只含当前引擎的字段），stale 检测通过深对比 `resolveEffectiveVoice()` vs `generated_params` 完成。

---

## 改动优先级

| 优先级 | 改动 | 风险 | 收益 |
|--------|------|------|------|
| P0 | VoiceSource 辨识联合 (含 overrides/voice_ref/generated_voice_id 消除) | 中 | 大幅减少冗余，统一读取逻辑 |
| P1 | 音频引用合并为 audio 对象 | 低 | 清理逻辑简化，4 字段变 1 |
| P1 | 后端移除 project_id 冗余 FK | 低 | 消除一致性问题 |
| P2 | 移除 audio_missing 列 | 极低 | 消除文件系统状态缓存 |

---

## 五、数据库表结构重构

### 当前表: `segmented_project_segments`

```sql
CREATE TABLE segmented_project_segments (
    id                  VARCHAR PRIMARY KEY,
    chapter_id          VARCHAR NOT NULL  REFERENCES segmented_project_chapters(id) ON DELETE CASCADE,
    project_id          VARCHAR NOT NULL  REFERENCES segmented_projects(id) ON DELETE CASCADE,  -- ← 冗余
    position            INTEGER NOT NULL,
    text                VARCHAR NOT NULL DEFAULT '',
    ssml                VARCHAR,                                 -- ← CosyVoice 专属，应移入引擎参数
    emotion             VARCHAR,
    role_id             VARCHAR  REFERENCES roles(id) ON DELETE SET NULL,
    role_snapshot       JSON,
    segment_kind        VARCHAR NOT NULL DEFAULT 'narration',
    prosody_marks       JSON NOT NULL DEFAULT '[]',
    params              JSON NOT NULL DEFAULT '{}',              -- ← 大杂烩
    voice_ref           JSON,                                    -- ← 与 role_snapshot 重叠
    locked_params       JSON NOT NULL DEFAULT '[]',              -- ← 应可推导
    generated_params    JSON,                                    -- ← 含冗余 voice_id
    current_audio_path  VARCHAR,                                 -- ← 可合并
    previous_audio_path VARCHAR,                                 -- ← 可合并
    audio_format        VARCHAR NOT NULL DEFAULT 'mp3',
    duration_sec        FLOAT,
    audio_missing       BOOLEAN NOT NULL DEFAULT FALSE,          -- ← 应可推导
    generated_at        TIMESTAMP,
    ssml_annotated_by_llm BOOLEAN NOT NULL DEFAULT FALSE,        -- ← 无实际用途
    animation_spec_json TEXT,
    created_at          TIMESTAMP DEFAULT utcnow(),
    updated_at          TIMESTAMP DEFAULT utcnow()
);
```

**26 列，其中至少 5 列冗余/可推导。**

### 改进后表: `segmented_project_segments`

```sql
CREATE TABLE segmented_project_segments (
    id                VARCHAR PRIMARY KEY,
    chapter_id        VARCHAR NOT NULL  REFERENCES segmented_project_chapters(id) ON DELETE CASCADE,
    -- project_id 移除，通过 chapter JOIN 获取
    position          INTEGER NOT NULL,
    text              VARCHAR NOT NULL DEFAULT '',
    emotion           VARCHAR,
    role_id           VARCHAR  REFERENCES roles(id) ON DELETE SET NULL,
    role_snapshot     JSON,
    segment_kind      VARCHAR NOT NULL DEFAULT 'narration'
                      CHECK (segment_kind IN ('narration', 'dialogue')),
    prosody_marks     JSON NOT NULL DEFAULT '[]',

    -- voice 替代 params + voice_ref + locked_params + ssml
    -- 结构: { "source":"chapter"|"role"|"custom", "role_id"?, "engine"?, "params"? }
    -- CosyVoice 时 params 内可含 ssml: { …, "params": { "ssml": "…" } }
    voice             JSON NOT NULL DEFAULT '{"source":"chapter"}',

    generated_params  JSON,   -- 只存实际引擎字段
    audio             JSON,   -- { current?: {id?,path?}, previous?: {id?,path?}, format: "mp3", duration_sec: 2.3 }
    generated_at      TIMESTAMP,
    animation_spec_json TEXT,
    created_at        TIMESTAMP DEFAULT utcnow(),
    updated_at        TIMESTAMP DEFAULT utcnow()
);
```

**变更汇总：**

| 操作 | 列 | 原因 |
|------|-----|------|
| 删除 | `project_id` | chapter_id 可推导 |
| 删除 | `ssml` | CosyVoice 专属字段，移入 voice.params |
| 删除 | `params` | 替换为 voice |
| 删除 | `voice_ref` | 由 voice + role_snapshot 推导 |
| 删除 | `locked_params` | 由 voice.params 的键判断 |
| 删除 | `audio_missing` | os.path.exists 动态判断 |
| 删除 | `ssml_annotated_by_llm` | 无实际用途（标注结果已在 ssml 文本中） |
| 删除 | `current_audio_path` | 合并到 audio |
| 删除 | `previous_audio_path` | 合并到 audio |
| 删除 | `audio_format` | 合并到 audio |
| 删除 | `duration_sec` | 合并到 audio |
| 新增 | `voice` JSON | 替代 params + voice_ref + locked_params + ssml |
| 新增 | `audio` JSON | 替代 current_audio_path/previous_audio_path/audio_format/duration_sec |
| 新增 | CHECK 约束 | segment_kind IN ('narration','dialogue') |

**26 列 → 16 列。**

---

### SQLAlchemy 模型改进后

```python
class SegmentedProjectSegment(Base):
    __tablename__ = "segmented_project_segments"

    id = Column(String, primary_key=True)
    chapter_id = Column(
        String,
        ForeignKey("segmented_project_chapters.id", ondelete="CASCADE"),
        nullable=False,
    )
    position = Column(Integer, nullable=False)
    text = Column(String, nullable=False, default="")
    emotion = Column(String, nullable=True)
    role_id = Column(String, ForeignKey("roles.id", ondelete="SET NULL"), nullable=True)
    role_snapshot = Column(JSON, nullable=True)
    segment_kind = Column(String, nullable=False, default="narration")
    prosody_marks = Column(JSON, nullable=False, default=list)

    voice = Column(JSON, nullable=False, default=lambda: {"source": "chapter"})
    # voice 结构:
    #   {"source":"chapter"}
    #   {"source":"role",  "role_id":"role_xm"}
    #   {"source":"custom","engine":"mimo_tts","params":{"instruction":"急促"}}
    #   {"source":"custom","engine":"cosyvoice","params":{"ssml":"<speak>…</speak>","voice_id":"v_01"}}
    # custom 且关联角色时可额外带 role_id

    generated_params = Column(JSON, nullable=True)
    audio = Column(JSON, nullable=True)
    # audio 结构: {"current":{"id":"…","path":"…"},"previous":{"id":"…","path":"…"},"format":"mp3","duration_sec":2.3}

    generated_at = Column(DateTime, nullable=True)
    animation_spec_json = Column(Text, nullable=True)

    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    chapter = relationship("SegmentedProjectChapter", back_populates="segments")

    @property
    def project_id(self):
        """推导属性，消除冗余 FK"""
        return self.chapter.project_id if self.chapter else None
```

---

### 迁移 SQL（Alembic 风格）

```sql
-- Phase 1: 新增列
ALTER TABLE segmented_project_segments
  ADD COLUMN voice JSON NOT NULL DEFAULT '{"source":"chapter"}',
  ADD COLUMN audio JSON;

-- Phase 2: 数据迁移 (Python 脚本)
-- 对每行 segment:
--   voice = normalize_voice_from_old(params, voice_ref, locked_params, ssml, role_id)
--   audio  = {
--     "current": {"id": null, "path": current_audio_path},
--     "previous": {"id": null, "path": previous_audio_path},
--     "format": audio_format,
--     "duration_sec": duration_sec,
--   }

-- Phase 3: 删除旧列
ALTER TABLE segmented_project_segments
  DROP COLUMN project_id,
  DROP COLUMN ssml,
  DROP COLUMN params,
  DROP COLUMN voice_ref,
  DROP COLUMN locked_params,
  DROP COLUMN audio_missing,
  DROP COLUMN ssml_annotated_by_llm,
  DROP COLUMN current_audio_path,
  DROP COLUMN previous_audio_path,
  DROP COLUMN audio_format,
  DROP COLUMN duration_sec;

-- Phase 4: 添加约束
ALTER TABLE segmented_project_segments
  ADD CONSTRAINT ck_segment_kind CHECK (segment_kind IN ('narration', 'dialogue'));
```

### 迁移数据转换函数

```python
def normalize_voice_from_old(
    params: dict,
    voice_ref: dict | None,
    locked_params: list,
    ssml: str | None,
    role_id: str | None,
) -> dict:
    """从旧格式推导 VoiceSource"""
    engine = params.get("engine", "edge_tts")
    overridden = any(k in (locked_params or []) for k in params)

    if overridden:
        engine_params = extract_engine_params(params, engine)
        # CosyVoice 时把独立 ssml 列带入 params
        if engine == "cosyvoice" and ssml:
            engine_params["ssml"] = ssml
        result: dict = {"source": "custom", "engine": engine, "params": engine_params}
        if role_id:
            result["role_id"] = role_id
        return result

    # 没有 overrides 但有 ssml（cosyvoice 引擎的 ssml 文本不应丢失）
    if ssml:
        result = {"source": "custom", "engine": engine, "params": {"ssml": ssml}}
        if role_id:
            result["role_id"] = role_id
        return result

    if role_id:
        return {"source": "role", "role_id": role_id}

    return {"source": "chapter"}


def extract_engine_params(params: dict, engine: str) -> dict:
    """从大杂烩 params 中提取当前引擎的实际字段"""
    ENGINE_KEY_MAP = {
        "edge_tts": {"edge_voice": "voice", "edge_rate": "rate", "edge_volume": "volume"},
        "mimo_tts": {"mimo_mode": "mode", "mimo_clone_voice_id": "voice_id",
                      "mimo_instruction": "instruction", "mimo_voice_description": "voice_description"},
        "cosyvoice": {"voice_id": "voice_id", "instruction": "instruction",
                       "speed": "speed", "volume": "volume", "pitch": "pitch", "language": "language",
                       "enable_ssml": "enable_ssml"},
        # ssml 文本由 normalize_voice_from_old 从独立列注入，不在此处映射
        "voxcpm": {"voxcpm_mode": "mode", "voxcpm_voice_description": "voice_description",
                    "voxcpm_style_control": "style_control", "voxcpm_prompt_text": "prompt_text",
                    "voxcpm_cfg_value": "cfg_value", "voxcpm_inference_timesteps": "inference_timesteps"},
    }
    key_map = ENGINE_KEY_MAP.get(engine, {})
    return {new_key: params[old_key]
            for old_key, new_key in key_map.items()
            if params.get(old_key)}
```

---

### 查询优化

`project_id` 移除后，需要按项目查询 segment 时通过 JOIN：

```python
# 当前
segments = db.query(SegmentedProjectSegment).filter(
    SegmentedProjectSegment.project_id == project_id
).all()

# 改进后（用 chapter_id 的 IN 子查询）
chapter_ids = db.query(SegmentedProjectChapter.id).filter(
    SegmentedProjectChapter.project_id == project_id
).subquery()
segments = db.query(SegmentedProjectSegment).filter(
    SegmentedProjectSegment.chapter_id.in_(chapter_ids)
).all()

# 或直接 JOIN
segments = db.query(SegmentedProjectSegment).join(
    SegmentedProjectChapter
).filter(
    SegmentedProjectChapter.project_id == project_id
).all()
```

对已有索引 `chapter_id` 来讲，这个查询性能无损（子查询走了索引）。

---

## 六、voice_profiles 表重构

### 当前表 & 前端类型

```sql
-- 后端表: 23 列
CREATE TABLE voice_profiles (
    id                  VARCHAR PRIMARY KEY,
    name                VARCHAR NOT NULL,
    source_audio_path   VARCHAR,          -- 克隆源音频本地路径
    external_audio_url  VARCHAR,          -- ← 应移入 engine_params
    qwen_voice_id       VARCHAR,          -- ← 应移入 engine_params
    role                VARCHAR DEFAULT 'custom',
    is_cloned           BOOLEAN DEFAULT FALSE,  -- 可从 engine_params 推导
    cloned_at           TIMESTAMP,              -- 同上
    clone_engine        VARCHAR,          -- ← 与 engine_type 重叠
    mimo_voice_id       VARCHAR,          -- ← 应移入 engine_params
    description         VARCHAR,
    avatar              VARCHAR,
    prompt_text         VARCHAR,          -- ← 应移入 engine_params
    cloned_preview_path VARCHAR,
    project_id          VARCHAR FK,       -- null=全局, 非空=项目专属
    voice_engine_type   VARCHAR,          -- ← 与 engine_type/sub_type 三重表达
    engine_type         VARCHAR,
    engine_sub_type     VARCHAR,
    engine_params       JSON,             -- 引擎参数（和上面 5+ 列重复）
    created_at          TIMESTAMP DEFAULT utcnow(),
    updated_at          TIMESTAMP DEFAULT utcnow()
);
```

```typescript
// 前端类型 (同样冗余)
interface VoiceProfile {
  id: string;
  name: string;
  audio_url: string;
  source_audio_url?: string;
  cloned_preview_url?: string;
  description?: string;
  prompt_text?: string;        // ← 应移入 engine_params
  qwen_voice_id?: string;      // ← 同上
  role?: string;
  clone_engine?: 'qwen' | 'mimo' | 'voxcpm';  // ← 与 engine_type 重叠
  is_cloned?: boolean;          // ← 可推导
  cloned_at?: string;
  created_at: string;
  avatar?: string | null;
  voices_engine?: VoicesEngine | null;  // ← 又一层引擎包装
  project_id?: string | null;
}
```

### 改进后

```sql
-- 后端表: 23 → 12 列
CREATE TABLE voice_profiles (
    id                  VARCHAR PRIMARY KEY,
    name                VARCHAR NOT NULL,
    source_audio_path   VARCHAR,          -- 克隆源音频本地路径
    cloned_preview_path VARCHAR,          -- 试听音频本地路径
    description         VARCHAR,
    avatar              VARCHAR,
    project_id          VARCHAR FK,
    role_kind           VARCHAR NOT NULL DEFAULT 'cast',  -- narrator | cast

    -- 唯一引擎入口 — 替代 8 个旧字段
    engine              JSON NOT NULL DEFAULT '{}',
    -- engine 结构（辨识联合，仅存当前克隆方式的信息）:
    --   {"type":"qwen",  "qwen_voice_id":"xxx", "external_audio_url":"https://..."}
    --   {"type":"mimo",  "mimo_voice_id":"xxx",  "external_audio_url":"https://...",
    --     "is_cloned":true, "cloned_at":"2026-...", "prompt_text":"..."}
    --   {"type":"voxcpm","external_audio_url":"https://...", "prompt_text":"...",
    --     "is_cloned":true, "cloned_at":"2026-...", ...}

    created_at          TIMESTAMP DEFAULT utcnow(),
    updated_at          TIMESTAMP DEFAULT utcnow()
);
```

```typescript
// 前端类型: 同理精简

type VoiceEngine = {
  type: 'qwen' | 'mimo' | 'voxcpm';
  qwen_voice_id?: string;       // Qwen 云音色 ID
  mimo_voice_id?: string;       // MiMo 本地复刻标记
  external_audio_url?: string;  // 云存储原始音频 URL（所有引擎通用）
  prompt_text?: string;         // 参考音频转写（VoxCPM/MiMo）
  is_cloned?: boolean;
  cloned_at?: string;
};

interface VoiceProfile {
  id: string;
  name: string;
  source_audio_path?: string;
  cloned_preview_path?: string;
  description?: string;
  avatar?: string | null;
  project_id?: string | null;
  role_kind: 'narrator' | 'cast';
  engine: VoiceEngine;           // 替代 qwen_voice_id + clone_engine + is_cloned
                                 //       + cloned_at + prompt_text + voice_engine_type
                                 //       + engine_type + engine_sub_type + voices_engine
  created_at: string;
  updated_at: string;
}
```

### 变更汇总 — voice_profiles

| 操作 | 列 | 替代 |
|------|-----|------|
| 删除 | `qwen_voice_id` | → `engine.qwen_voice_id` |
| 删除 | `external_audio_url` | → `engine.external_audio_url` |
| 删除 | `mimo_voice_id` | → `engine.mimo_voice_id` |
| 删除 | `prompt_text` | → `engine.prompt_text` |
| 删除 | `clone_engine` | → `engine.type`(qwen/mimo/voxcpm) |
| 删除 | `voice_engine_type` | → 由 engine.type 推导 |
| 删除 | `engine_type` | → 由 engine.type 推导 |
| 删除 | `engine_sub_type` | → 由 engine.type 推导 |
| 删除 | `is_cloned` | → `engine.is_cloned` |
| 删除 | `cloned_at` | → `engine.cloned_at` |
| 删除 | `role` | → 重命名为 `role_kind` 加 CHECK 约束 |
| 新增 | `engine` JSON | 聚合上述 11 列 |
| 新增 | CHECK | `role_kind IN ('narrator','cast')` |

**23 列 → 12 列。**

---

## 七、roles 表重构

### 当前表 & 前端类型

```sql
-- 后端表: 10 列
CREATE TABLE roles (
    id                    VARCHAR PRIMARY KEY,
    name                  VARCHAR NOT NULL,
    avatar                VARCHAR,
    description           VARCHAR,
    role_kind             VARCHAR NOT NULL DEFAULT 'cast',
    default_engine        VARCHAR NOT NULL DEFAULT 'edge_tts',    -- ← 冗余
    default_voice         VARCHAR,                                 -- ← 冗余
    default_engine_params JSON NOT NULL DEFAULT '{}',             -- ← SegmentEngineParams (大杂烩)
    favorite_styles       JSON NOT NULL DEFAULT '[]',
    created_at            TIMESTAMP DEFAULT utcnow(),
    updated_at            TIMESTAMP DEFAULT utcnow()
);
```

```typescript
interface RoleSnapshot {
  id: string;
  name: string;
  avatar?: string | null;
  description?: string | null;
  role_kind?: 'narrator' | 'cast' | null;
  default_engine: SegmentEngineParams['engine'];        // ← 冗余列
  default_voice?: string | null;                         // ← 冗余列
  default_engine_params: SegmentEngineParams;            // ← 大杂烩
  favorite_styles: FavoriteStyle[];
}
```

**问题**:
- `default_engine` = `default_engine_params.engine`（重复提取）
- `default_voice` = `default_engine_params.voice_id` 或 `.voice`（重复提取）
- `default_engine_params` 是 22 字段的 `SegmentEngineParams`（和 Segment 一样的问题）

### 改进后

```sql
-- 后端表: 10 → 8 列
CREATE TABLE roles (
    id              VARCHAR PRIMARY KEY,
    name            VARCHAR NOT NULL,
    avatar          VARCHAR,
    description     VARCHAR,
    role_kind       VARCHAR NOT NULL DEFAULT 'cast'
                    CHECK (role_kind IN ('narrator', 'cast')),

    -- 唯一音色入口 — 替代 default_engine + default_voice + default_engine_params
    voice           JSON NOT NULL DEFAULT '{"engine":"edge_tts","params":{}}',
    -- voice 结构（和 Segment.voice 同构的 EngineParams）:
    --   {"engine":"edge_tts",  "params":{"voice":"zh-CN-YunxiNeural","rate":"+0%","volume":"+0%"}}
    --   {"engine":"mimo_tts",  "params":{"mode":"voiceclone","voice_id":"v_01"}}
    --   {"engine":"cosyvoice", "params":{"voice_id":"v_01","speed":1.0,"volume":80,"pitch":1.0,"language":"Chinese"}}
    --   {"engine":"voxcpm",    "params":{"mode":"clone","voice_id":"v_01",...}}

    favorite_styles JSON NOT NULL DEFAULT '[]',
    created_at      TIMESTAMP DEFAULT utcnow(),
    updated_at      TIMESTAMP DEFAULT utcnow()
);
```

```typescript
// 前端类型: 和 Segment 复用同一个 EngineParams 辨识联合

interface RoleSnapshot {
  id: string;
  name: string;
  avatar?: string | null;
  description?: string | null;
  role_kind: 'narrator' | 'cast';
  voice: EngineParams;               // 替代 default_engine + default_voice + default_engine_params
  favorite_styles: FavoriteStyle[];
}

interface Role extends RoleSnapshot {
  created_at: string;
  updated_at: string;
}
```

### 变更汇总 — roles

| 操作 | 列 | 替代 |
|------|-----|------|
| 删除 | `default_engine` | → `voice.engine` |
| 删除 | `default_voice` | → `voice.params.voice_id` 或 `voice.params.voice` |
| 删除 | `default_engine_params` | → 替换为 `voice` |
| 新增 | `voice` JSON | 聚合上述 3 列 |
| 新增 | CHECK | `role_kind IN ('narrator','cast')` |

**10 列 → 8 列。**

`default_engine_params` 从 22 字段大杂烩缩为引擎辨识联合（和 Segment 共用同一套 `EngineParams` 类型）。

---

## 八、跨表一致性

重构后三张核心表共享同一套音色类型体系：

```
voice_profiles.engine ──── VoiceEngine   (type + 引擎专属字段)
roles.voice           ──── EngineParams  (engine + params)
segments.voice        ──── VoiceSource   (source + role_id + params)

其中:
- VoiceSource.custom.params  === EngineParams 的同构子集
- Role.voice                === EngineParams
- 读取有效参数时三者通过 resolveEffectiveVoice() 统一合并
```

不再有「同一个 engine 字段在这个表叫 `clone_engine`，在另一个表叫 `engine_type`，在第三个表叫 `default_engine`」的情况。
