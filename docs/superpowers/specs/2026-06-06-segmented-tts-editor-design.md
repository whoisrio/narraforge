# 分段语音编辑器（Segmented TTS Editor）设计文档

- **日期**：2026-06-06
- **范围**：voice-clone-studio
- **状态**：设计完成，待实现

---

## 1. 背景与目标

### 1.1 现有痛点

`TTSSynthesis` 页面目前以"长文本一次性合成"为主要工作流。当用户粘贴一大段文字（如播客脚本、视频解说稿）合成后：

- 发现一两个字读错、停顿不对、语气不准 → 必须整段重新合成
- 重新合成既浪费 API 调用、又消耗时间
- 无法对长稿的局部做精细控制（如某句加停顿、某词加强调）
- 一次合成的结果是单个音频文件，无法按段重排、删减

### 1.2 目标

新增一个**分段语音编辑器**页面，让用户把长文本按句切分、逐段精调、逐段试听重生成，最终拼成一个完整音频导出。同时输出与音频时间轴对齐的字幕（SRT）。

工作流：

```
①  粘贴长文本
       ↓
②  选择拆分方式（规则按标点 / LLM 智能）→ 拆分
       ↓
③  拆分结果展示为段列表（status=idle，未生成）
       ↓
④  用户审阅 + 手动调整（合并 / 拆 / 改文字 / 删 / 插入）
       ↓
⑤  [可选] LLM 自动标注 SSML  ✨  或手动编辑 SSML
       ↓
⑥  点「全部生成」→ 并发 3 调 TTS
       ↓
⑦  各段试听、单段重生成、单段撤回，反复迭代
       ↓
⑧  点「导出」→ WAV 音频 + 脚本 JSON + SRT + 双语 SRT 多选下载
```

### 1.3 范围与非目标

**v1 范围（本文档）：**
- 新增独立页面 `/segmented-tts`，与现有 `TTSSynthesis` 并存
- 三引擎都支持分段+单段重生成（CosyVoice / Edge-TTS / MiMo-TTS）
- SSML 单段编辑：仅 CosyVoice
- 前端模式持久化（IndexedDB），跟随项目现有 `useStorageMode` 开关；后端模式数据结构骨架预留，本期不接入运行时
- 拼接导出：前端 Web Audio API → WAV
- 字幕导出：单语 SRT + 双语 SRT（复用现有 `/api/subtitle-llm/translate`）
- LLM 智能拆分 + LLM 智能标注 SSML（共用 LLM client）
- 纵向列表布局（默认） + 横向布局切换（v1 包含）

**非目标 / 后续版本：**
- 后端模式持久化（v2 启用预留的 SQLAlchemy 模型）
- 后端 ffmpeg 拼接 + MP3 导出（v2）
- 真实波形显示（v1 不做波形，仅显示时长数字）
- 段拖拽重排（v1 用 ⋮ 菜单上移/下移；拖拽列入 follow-up）
- 段级多版本历史（v1 仅保留上一版用于撤销）
- 国际化（v1 中文 UI）

---

## 2. 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend (React)                                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Page: <SegmentedTTS />                              │   │
│  │  ─────────────────────────────────────────────       │   │
│  │  ① TextInputPanel    (输入长文本 + 拆分配置)         │   │
│  │  ② SegmentList       (纵向列表，每段一行)            │   │
│  │  ③ SegmentEditDrawer (弹出式编辑面板，复用 SSMLToolbar)│  │
│  │  ④ ProjectToolbar    (项目名/全部播放/全部生成/导出) │   │
│  │  ⑤ ExportDialog      (导出多选)                      │   │
│  └──────────────────────────────────────────────────────┘   │
│              ↑ uses                                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Hook: useSegmentedProject() — useReducer            │   │
│  │  State: { project, segments[], selectedId, ... }     │   │
│  │  Actions: split / append / insert / delete /         │   │
│  │           regenerate / undo / updateText / updateSSML │  │
│  │           annotateSSML                                │  │
│  └──────────────────────────────────────────────────────┘   │
│              ↑ persists to                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Service: segmentedProjectDB  (IndexedDB)            │   │
│  │  Stores: segmentedProjects / + 复用现有 ttsResults   │   │
│  └──────────────────────────────────────────────────────┘   │
│              ↑ HTTP                                          │
└──────────────────────────────────────────────────────────────┘
               ↓
┌──────────────────────────────────────────────────────────────┐
│  Backend (FastAPI)                                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  NEW  app/api/text_split.py                          │   │
│  │       POST /api/text-split/rule        按标点拆      │   │
│  │       POST /api/text-split/llm         智能拆分      │   │
│  │       POST /api/text-split/ssml-annotate LLM 标注    │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  NEW  app/services/text_split_service.py             │   │
│  │       rule_split() / llm_split() / ssml_annotate()   │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  NEW  app/services/llm_client.py  (抽自 llm_subtitle)│   │
│  │       _get_llm_config / _call_llm / _extract_json    │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  EXISTING  /api/tts/synthesize  (单段重生成直接复用) │   │
│  │  EXISTING  /api/mimo-tts/*       (同上)               │   │
│  │  EXISTING  /api/subtitle-llm/translate (双语 SRT)    │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  STUB (本期不实现，仅写骨架)                          │   │
│  │       app/models/segmented_project.py                │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 关键设计原则

1. **复用优先** —— 单段生成直接调现有 `/api/tts/synthesize` 和 `/api/mimo-tts/*`，**不在编辑器层再包一个 segment-synthesize 端点**，避免重复维护参数集
2. **拆分是无副作用的纯函数操作** —— 后端只做"切"，不创建段记录、不落库；段管理完全在前端
3. **段轻、音频独立** —— `Segment` 对象只含 id/text/ssml/参数/audio引用；音频字节复用现有 `ttsResults` IndexedDB store
4. **后端模式预留但不启用** —— SQLAlchemy 模型骨架写入但不注册到 `Base.metadata.create_all`，v2 后端模式开发时再接入

### 2.2 文件清单

**后端新增：**
- `backend/app/api/text_split.py`
- `backend/app/services/text_split_service.py`
- `backend/app/services/llm_client.py`
- `backend/app/models/segmented_project.py`（骨架，不接 router、不接入运行时）
- `backend/tests/test_text_split_service.py`
- `backend/tests/test_text_split_api.py`
- `backend/tests/test_llm_client.py`

**后端修改：**
- `backend/main.py`（注册 text_split router）
- `backend/app/services/llm_subtitle_service.py`（迁移 `_get_llm_config` / `_extract_json_array` / `_call_llm` 到 `llm_client.py`，原模块改为 re-export 保持向后兼容）
- `backend/app/models/tts_result.py`（加可空字段 `source`，默认空字符串）

**前端新增：**
- `frontend/src/pages/SegmentedTTS.tsx`
- `frontend/src/pages/SegmentedTTS.module.css`
- `frontend/src/components/SegmentedTTS/`
  - `TextInputPanel.tsx` + css
  - `SegmentList.tsx` + css
  - `SegmentRow.tsx` + css
  - `SegmentEditDrawer.tsx` + css
  - `ProjectToolbar.tsx` + css
  - `ExportDialog.tsx` + css
- `frontend/src/hooks/useSegmentedProject.ts`
- `frontend/src/hooks/useCountUp.ts`
- `frontend/src/services/segmentedProjectDB.ts`
- `frontend/src/services/audioConcat.ts`（拼接 + WAV 编码 + SRT 生成）
- `frontend/src/services/api.ts` 内追加 `textSplitApi`

**前端修改：**
- `frontend/src/App.tsx`（注册 `/segmented-tts` 路由）
- `frontend/src/pages/Landing.tsx`（入口卡片）
- `frontend/src/services/indexedDB.ts`（DB 版本 +1，加 `segmentedProjects` store；`saveTTSResult` 接受 `source` 字段；`getTTSHistory` 过滤 `source === 'segmented_tts'`）
- `frontend/src/types/index.ts`（新增 `Segment` / `SegmentedProject` / `SegmentEngineParams` / `SegmentStatus`）

---

## 3. 数据模型

### 3.1 前端类型定义

```ts
// frontend/src/types/index.ts (新增)

export interface SegmentEngineParams {
  engine: 'cosyvoice' | 'edge_tts' | 'mimo_tts';

  // CosyVoice
  voice_id?: string;
  instruction?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  language?: string;
  enable_ssml?: boolean;
  enable_markdown_filter?: boolean;

  // Edge-TTS
  edge_voice?: string;
  edge_rate?: string;     // '+0%' 风格
  edge_volume?: string;

  // MiMo-TTS
  mimo_mode?: 'preset' | 'voiceclone';
  mimo_preset_voice?: string;
  mimo_clone_voice_id?: string;
  mimo_instruction?: string;
}

export type SegmentStatus =
  | 'idle'        // 有文本但还没生成
  | 'queued'      // 已点全部生成，排队等待发起
  | 'pending'     // 正在调 TTS
  | 'ready'       // 已生成可播放
  | 'failed';     // 上次生成失败

export interface Segment {
  id: string;                       // uuid v4，前端生成
  text: string;
  ssml?: string;
  params: SegmentEngineParams;
  status: SegmentStatus;
  error?: string;

  // 音频引用，指向 IndexedDB ttsResults store
  current_audio_id?: string;
  previous_audio_id?: string;

  duration_sec?: number;
  ssml_annotated_by_llm?: boolean;  // 用于 UI 显示 ✨ 标识
  created_at: string;
  updated_at: string;
}

export interface SegmentedProject {
  schema_version: 1;                // 用于未来 schema 升级
  id: string;
  name: string;
  segments: Segment[];
  selected_segment_id?: string;

  default_params: SegmentEngineParams;

  split_config: {
    delimiters: string[];           // 默认 ['，','。','！','？']
    mode: 'rule' | 'llm';
  };

  layout: 'vertical' | 'horizontal'; // 用户偏好

  created_at: string;
  updated_at: string;
}
```

### 3.2 IndexedDB Schema

复用 `frontend/src/services/indexedDB.ts`，加 store + 升级版本：

| Store | Key | Value | 索引 | 备注 |
|---|---|---|---|---|
| `ttsResults`（已存在） | `id` | `{ id, audioBlob, text, voice_id, source, ... }` | `created_at` | 新增 `source` 字段；编辑器写入时 `source = 'segmented_tts'`，单段 TTS 历史过滤掉这部分 |
| `segmentedProjects`（新增） | `id` | 完整 `SegmentedProject`（不含音频字节） | `updated_at` | 项目对象轻量，通过 `current_audio_id` 引用 `ttsResults` |

**DB 升级**：现有 `indexedDB.ts` 的 `version` +1，`onupgradeneeded` 中若旧版本 < 新版本则 `createObjectStore('segmentedProjects', { keyPath: 'id' })`。

### 3.3 后端 SQLAlchemy 模型骨架（预留）

`backend/app/models/segmented_project.py`：

```python
"""分段语音项目 —— 后端模式持久化模型骨架

⚠️ 本期（v1）暂不启用：编辑器前端模式直接走 IndexedDB。
   预留此模型供 v2 后端模式接入：
   - 创建/列表/删除 API
   - 后端 ffmpeg 拼接 + MP3 导出

字段命名与前端 TypeScript 类型保持一致以便后续无缝接入。
本文件被 import 也不会污染运行时 schema：不在 main.py 中触发 create_all。
"""
from sqlalchemy import Column, String, DateTime, JSON, Integer, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from app.core.database import Base


class SegmentedProject(Base):
    __tablename__ = "segmented_projects"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    default_params = Column(JSON, nullable=False, default=dict)
    split_config = Column(JSON, nullable=False, default=dict)
    layout = Column(String, nullable=False, default='vertical')
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    segments = relationship(
        "SegmentedProjectSegment",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="SegmentedProjectSegment.position",
    )


class SegmentedProjectSegment(Base):
    __tablename__ = "segmented_project_segments"
    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("segmented_projects.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False)
    text = Column(String, nullable=False, default="")
    ssml = Column(String, nullable=True)
    params = Column(JSON, nullable=False, default=dict)
    current_audio_id = Column(String, nullable=True)
    previous_audio_id = Column(String, nullable=True)
    duration_sec = Column(Integer, nullable=True)
    ssml_annotated_by_llm = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("SegmentedProject", back_populates="segments")
```

### 3.4 Reducer 状态与 Actions

`useSegmentedProject` 内部：

```ts
type State = { project: SegmentedProject };

type Action =
  | { type: 'LOAD_PROJECT'; project: SegmentedProject }
  | { type: 'RENAME_PROJECT'; name: string }
  | { type: 'SET_DEFAULT_PARAMS'; params: SegmentEngineParams }
  | { type: 'SET_SPLIT_CONFIG'; config: SegmentedProject['split_config'] }
  | { type: 'SET_LAYOUT'; layout: 'vertical' | 'horizontal' }

  | { type: 'APPLY_SPLIT'; texts: string[] }    // 替换 segments，所有 status=idle

  | { type: 'APPEND_SEGMENT'; text?: string }
  | { type: 'INSERT_SEGMENT'; afterId: string; text?: string }
  | { type: 'DELETE_SEGMENT'; id: string }
  | { type: 'UPDATE_TEXT'; id: string; text: string }
  | { type: 'UPDATE_SSML'; id: string; ssml: string; by_llm?: boolean }
  | { type: 'BATCH_SET_SSML'; updates: { id: string; ssml: string }[]; by_llm?: boolean }
  | { type: 'UPDATE_PARAMS'; id: string; params: Partial<SegmentEngineParams> }
  | { type: 'REORDER'; fromIndex: number; toIndex: number }

  | { type: 'MARK_QUEUED'; ids: string[] }
  | { type: 'GENERATE_START'; id: string }
  | { type: 'GENERATE_SUCCESS'; id: string; audio_id: string; duration_sec: number }
  | { type: 'GENERATE_FAIL'; id: string; error: string }
  | { type: 'UNDO_REGENERATE'; id: string }     // current ↔ previous swap

  | { type: 'SELECT_SEGMENT'; id: string | undefined };
```

Hook 暴露的高阶函数（管理副作用：API 调用 / IndexedDB / 孤儿清理）：

```ts
const { state, actions } = useSegmentedProject(projectId);

actions.applySplit(mode, texts)        // 自动 IDB 保存 + 清理被替换段的孤儿音频
actions.appendSegment(text?)
actions.insertSegment(afterId, text?)
actions.deleteSegment(id)               // 清理音频 + IDB
actions.updateText(id, text)
actions.updateSSML(id, ssml)
actions.updateParams(id, partial)
actions.regenerate(id)                  // 调 TTS → IDB → swap current/previous → 清理旧 previous
actions.regenerateAll()                 // 并发 3 调度
actions.cancelGenerateAll()             // 取消 queued/pending
actions.undoRegenerate(id)
actions.annotateSSML(ids, styleHint?)  // 调 LLM SSML 标注
actions.exportProject(options)         // 见 §5
```

### 3.5 孤儿音频清理规则

`ttsResults` 中的音频有 3 个潜在引用源：
1. `TTSSynthesis` 页面历史
2. 编辑器内 segment.`current_audio_id`
3. 编辑器内 segment.`previous_audio_id`

**前端编辑器写入的音频以 `source: 'segmented_tts'` 标记**，TTSSynthesis 历史列表通过该字段过滤，互不污染。

**清理触发点**（全部立即执行）：

| 触发 | 清理动作 |
|---|---|
| 单段 `regenerate` 成功 | 旧 `previous_audio_id` 对应记录删除；`current → previous`；新 audio 入 `current` |
| `delete segment` | 该段的 `current_audio_id` 和 `previous_audio_id` 对应记录删除 |
| `applySplit`（重新拆分） | 所有旧 segments 的 audio_id 对应记录删除 |
| `delete project` | 项目下所有段的所有 audio_id 对应记录删除 |
| `undoRegenerate` | 不删（current/previous 仅 swap） |

清理失败（IDB 异常）记 `console.warn` 不阻断主流程。

---

## 4. 端到端数据流

### 4.1 拆分（Split）

**规则拆分（纯前端）：**
```
TextInputPanel: 用户粘贴文本 + 勾选分隔符（默认 ，。！？）
  → 点「拆分」
  → 前端本地切分：按 delimiters 切，过滤空白段、纯标点段
  → actions.applySplit('rule', texts[])
    → dispatch APPLY_SPLIT
    → 清理旧 segments 的孤儿音频
    → 自动保存 IDB
```

**LLM 智能拆分：**
```
POST /api/text-split/llm
Request: { text: string, delimiters?: string[] }
Response: { segments: [{ text: string, reason: string }] }

→ text_split_service.llm_split(text, delimiters)
  → llm_client.call_llm(prompt=BUILD_SPLIT_PROMPT(text, delimiters))
  → 解析 JSON（_extract_json_array 兜底）
  → 返回 segments 列表

前端：actions.applySplit('llm', segments.map(s => s.text))

失败回退：LLM 不可达或返回非法格式 → toast 提示 + 自动用规则拆分作为兜底
```

**拆分后状态：** 所有段 `status = 'idle'`，每段持有 `default_params` 副本；用户可手动调整（合并、再切、改文字）再触发生成。

### 4.2 生成（Generate）

**全部生成：**
```
actions.regenerateAll()
  1. 找出 status ∈ {idle, failed} 的段，dispatch MARK_QUEUED
  2. 并发调度器：最多 3 个 in-flight
     for each segment:
       dispatch GENERATE_START
       根据 segment.params.engine 分支：
         cosyvoice → ttsApi.synthesize(...)
         edge_tts  → ttsApi.synthesize({ engine: 'edge_tts', ... })
         mimo_tts  → mimoTtsApi.synthesizePreset / synthesizeVoiceClone
       响应后：
         成功 → 保存 audioBlob 到 ttsResults（source='segmented_tts'）
              → dispatch GENERATE_SUCCESS(audio_id, duration_sec)
              → 清理旧 previous（如有）
         失败 → dispatch GENERATE_FAIL(error.message)
  3. 全部完成后保存 IDB
  4. 进度: 顶部按钮显示 "3/12 段生成中... ✕"
```

**单段重生成（用户在编辑抽屉里改了内容点「重新生成」）：**
```
actions.regenerate(id)
  → dispatch GENERATE_START
  → 调 TTS（同上）
  → 成功：
    - 把旧 current_audio_id 降级为 previous_audio_id
    - 旧 previous_audio_id（如有）立即从 ttsResults 删除
    - 新 audio_id 上 current
    - dispatch GENERATE_SUCCESS
  → 失败：dispatch GENERATE_FAIL
```

### 4.3 编辑与撤销

**编辑文本/SSML/参数：**
- 抽屉内字段实时 dispatch 到 reducer
- 不自动触发生成；手动点「重新生成」才发请求
- 抽屉关闭时若字段已改但未生成：弹「未保存修改将丢失，确认放弃？」

**SSML 单段编辑（仅 CosyVoice）：**
- 抽屉内 SSML 区显示 `<SSMLToolbar>`（复用现有组件）+ textarea
- 调 TTS 时若 `enable_ssml=true` 且 `ssml` 非空，请求传 `text = ssml`，并启用 `enable_ssml`

**撤销：**
- 段行的「↻ 撤回」按钮，仅在 `previous_audio_id` 存在时显示
- 点击 → dispatch UNDO_REGENERATE → swap(current, previous)
- 被换下的 audio_id 进入 previous 位，不删除

### 4.4 LLM 智能 SSML 标注

```
POST /api/text-split/ssml-annotate
Request: {
  texts: string[],
  style_hint?: string    // 可选: '播音腔' | '活泼' | '平和' | '讲故事'
}
Response: {
  annotations: [{
    text: string,        // 原文回显
    ssml: string,        // <speak>...</speak>
    rationale: string    // 简短解释
  }]
}

→ text_split_service.ssml_annotate(texts, style_hint)
  → llm_client.call_llm(prompt=BUILD_SSML_PROMPT(texts, style_hint))
  → 解析 JSON
  → 后处理校验：
    1. 剥除非白名单标签
       允许: <speak>, <break>, <prosody>, <emphasis>
    2. diff 校验：剥除标签后的纯文本 vs 原文 → 不一致则该段退化为 <speak>原文</speak>
  → 返回 annotations

前端：actions.annotateSSML(ids, styleHint)
  → dispatch BATCH_SET_SSML（每段 ssml + 标记 by_llm=true）
  → 自动把对应段 params.enable_ssml = true
  → toast: "已为 N 段标注 SSML"
```

**入口三处：**
- ProjectToolbar：「✨ 全部智能标注 SSML」（仅 engine=cosyvoice 时显示）
- SegmentRow 的 ⋮ 菜单：「智能标注 SSML」
- SegmentEditDrawer 内 SSML 区顶部「✨ 智能标注」小按钮

**已有 SSML 时覆盖前确认：** 弹「该段已有 SSML，覆盖？」

### 4.5 导出（Export）

```
ExportDialog (多选)：
  ☑ WAV 音频           <name>.wav
  ☑ 脚本 JSON          <name>.script.json
  ☐ SRT 字幕           <name>.srt
  ☐ 双语 SRT 字幕      <name>.bilingual.srt
      目标语言：[ English ▼ ]
      源语言：  [ Chinese ▼ ]
  名称: [ 我的播客脚本    ]
  [取消]    [开始导出]
```

**Step 1: 必备前置——累计时间戳**
```ts
let accumulated_ms = 0;
for (const s of segments) {
  s._start_ms = accumulated_ms;
  s._end_ms = accumulated_ms + (s.duration_sec ?? 0) * 1000;
  accumulated_ms = s._end_ms;
}
```

**Step 2: 按勾选并行处理**

**[WAV] 拼接：**
1. 取 `targetSampleRate = max(...各段采样率)`
2. 各段 `audioBlob → decodeAudioData() → AudioBuffer`
3. 若段采样率 ≠ targetSampleRate：用 `OfflineAudioContext(channels, length, targetSampleRate)` 升采样
4. 新 AudioBuffer 总长 = 各段长度之和，逐段 `copyToChannel` 到对应 offset
5. `encodeWAV(buffer, 16-bit PCM)` → `Blob('audio/wav')`
6. 触发浏览器下载 `<name>.wav`

**[JSON] 脚本：**
```json
{
  "name": "...",
  "schema_version": 1,
  "created_at": "...",
  "total_duration_sec": 38.4,
  "segments": [
    {
      "index": 0,
      "text": "...",
      "ssml": "...",
      "start_ms": 0,
      "end_ms": 3200,
      "duration_sec": 3.2,
      "params": { ... }
    }
  ]
}
```

**[SRT] 单语：**
```
1
00:00:00,000 --> 00:00:03,200
今天我们要聊的是人工智能。

2
00:00:03,200 --> 00:00:06,200
这是一个非常有意思的话题。
```
- 使用 `segment.text`，**不**使用 ssml（字幕给人看，标签剥离）
- `fmtSrtTime(ms)` 函数：`HH:MM:SS,mmm`

**[双语 SRT]：**
1. 先生成单语 SRT 字符串
2. POST `/api/subtitle-llm/translate { srt_content, target_language, source_language }`
3. 接口已返回 `bilingual_srt` 字段，直接 Blob 下载
4. 翻译失败：toast「双语 SRT 翻译失败」，但其他文件不受影响

**边界处理：**
- 段 `status !== 'ready'` 且勾选了 WAV/SRT：弹「N/M 段未生成，未生成段时长视为 0 但仍写入字幕。继续？」
  - WAV 中未生成段被跳过（不插入静音）
  - SRT 中未生成段会产生 start==end 的 0 时长字幕条（不影响其他段的时间戳累计，因为 duration=0）
- 某段 `current_audio_id` 在 IDB 缺失（曾经生成成功但 blob 丢了）：WAV 中静音填充 `duration_sec` 长度；SRT 正常输出文本
- 文件名清理：`name` 中 `/ \ : * ? " < > |` 替换为 `_`，空名兜底为时间戳

---

## 5. 组件与 UI

### 5.1 组件树

```
<SegmentedTTS>
├── <ProjectToolbar>
│     项目名(可改) · 段数/总时长
│     [▶ 全部播放] [⚡ 全部生成] [✨ 全部智能标注 SSML]
│     [⬇ 导出] [横/纵切换] [⋮ 默认参数]
│
├── <TextInputPanel>           ← 拆分后可折叠
│     <textarea>
│     分隔符勾选(，。！？；、) + 模式(规则/LLM) + [拆分]
│
├── <SegmentList>              ← vertical | horizontal 两种布局
│   ├── <SegmentRow status="ready" />
│   ├── ...
│   └── <SegmentRow appendStub />  // 末尾「+ 追加新段」
│
├── <SegmentEditDrawer>         ← 仅 vertical 布局使用
│     ── 文本 textarea
│     ── SSML 区（仅 CosyVoice + enable_ssml）
│         「✨ 智能标注」+ <SSMLToolbar> + textarea
│     ── 引擎参数（按 engine 切换子面板）
│         CosyVoice → <ParameterControls>
│         Edge-TTS  → <EdgeTTSParameterControls>
│         MiMo-TTS  → <MiMoTTSPanel> (拆出参数子组件)
│     ── 底部 [试听旧版] [↻ 重新生成] [✓ 保存关闭]
│
├── <ExportDialog>              ← 见 §4.5
└── <ConfirmDialog>             ← 通用确认（删除/丢弃修改）
```

### 5.2 SegmentRow 视觉（纵向布局）

```
┌──────────────────────────────────────────────────────────────────┐
│ [#3] 今天我们要聊的是人工智能，这是个非常有意 …       3.2s       │
│      已生成 · CosyVoice · 龙小淳 · SSML✨            ▶ ✎ ↻ ⋮   │
└──────────────────────────────────────────────────────────────────┘
       ↓ hover 行间隙显示
       ┌─────────────────────┐
       │ + 在此处插入新段    │
       └─────────────────────┘
```

- **不显示波形**（v1 决定），右上角显示时长数字
- `SSML ✨` 表示 LLM 标注；`SSML`（无星）表示手动编辑
- 文本超过 2 行截断，hover 显示完整 tooltip
- 段文本超过 100 字：右侧橙色感叹号 + tooltip「单段过长，建议拆分」（不阻断）

### 5.3 段状态动效

| 状态 | 静态视觉 | 动效 |
|---|---|---|
| **idle** | 灰色边框 + 浅灰背景 + 时长位 "—" | 无 |
| **queued** | 灰色边框 + **左侧 3px 蓝色细条** | 细条**呼吸**（opacity 0.4↔1.0，2s 循环） |
| **pending** | 亮蓝色边框 + 浅蓝背景 + 时长位 `⏳ 合成中…` | **左侧细条流动光斑**（gradient 从上到下，1.5s 循环） |
| **ready** | 绿色细边框 + 白底 | pending→ready 瞬间：**整行绿底闪一次**（200ms in / 600ms out）+ 时长数字**从 0 滚动到真实值**（400ms ease-out） |
| **failed** | 红色边框 + 浅红背景 + ⚠ 图标 | 切入瞬间：**横向轻微抖动一次**（translateX -4px → +4px → 0，250ms） |

**全局过渡：**
- 点「⚡ 全部生成」：所有 idle 段瞬间切到 queued（整齐呼吸感）；顶部进度条 fade-in
- 进度条到 100% 后停 800ms → fade-out → toast 总结

**性能：**
- 优先 CSS `@keyframes`（GPU 合成层，transform/opacity）
- 时长滚动用 `requestAnimationFrame`，仅 ready 瞬间触发一次
- **prefers-reduced-motion 适配**：降级为简单 fade，无抖动、无流动

### 5.4 横向布局（layout='horizontal'）

```
┌──────────────────────────────────────────────────────────────┐
│ [#1▓] [#2▓] [#3▓] [#4▓] [#5▓] [+]      ← 横向滚动             │
│                                                              │
│ ┌────────────────────────────────────────────────────┐      │
│ │ 选中段 #3 详情（编辑面板内联，不再弹抽屉）         │      │
│ │ 文本 / SSML / 参数 / 重新生成                      │      │
│ └────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

- 横向模式段块：70-90px 宽固定，显示「#N + 时长 + 状态色」+ 文本截断到 8 字
- 选中段编辑面板固定在底部，**不弹抽屉**
- 用户偏好保存到 `project.layout` 字段（项目级），下次打开此项目记住

### 5.5 关键交互

**自动保存**
- 每次 reducer dispatch 后 debounce 500ms 写 IDB
- 写入失败 toast，不阻断
- ProjectToolbar 角落小字「已保存 12s 前」/「保存中…」

**键盘快捷键**（选中段时；textarea/input 内禁用）
- `Enter` 打开编辑抽屉
- `Cmd/Ctrl + Enter` 重新生成
- `Cmd/Ctrl + Z` 撤回上一次重生成
- `Delete` 删除段（弹确认）
- `↑/↓` 切换选中段

**生成中禁用删除**
- pending/queued 状态的段：删除按钮 disabled + tooltip「生成中无法删除」
- 简化竞态处理（不用 AbortController）

**编辑抽屉的脏检查**
- 任何字段被改时关闭按钮变「保存关闭」+ 红点
- 点关闭/遮罩 → 「未保存修改，确认放弃？」
- 「重新生成」执行后视为已保存

**全部生成进度**
- 顶部「全部生成」按钮在执行时变为「3/12 段生成中... ✕取消」
- 取消停止后续段；已发出的请求由后端完成，前端忽略其结果

### 5.6 入口与路由

- 路径：`/segmented-tts`
- `App.tsx` 加 `<Route path="/segmented-tts" element={<SegmentedTTS />} />`
- `Landing.tsx` 加卡片：「分段语音编辑器」/「按句拆分长文本，逐段精调，导出整段音频与字幕」

### 5.7 复用现有组件

| 现有组件 | 复用位置 | 改造 |
|---|---|---|
| `SSMLToolbar` | SegmentEditDrawer SSML 区 | 无 |
| `ParameterControls` | SegmentEditDrawer CosyVoice 子面板 | 无 |
| `EdgeTTSParameterControls` | SegmentEditDrawer Edge-TTS 子面板 | 无 |
| `MiMoTTSPanel` | SegmentEditDrawer MiMo 子面板 | **拆出参数部分**为独立子组件 `MiMoTTSParams`，避免与项目级 voice 选择器重复渲染 |
| `AudioPlayer` | 单段试听 / 试听旧版 | 无 |
| `VoiceSelector` | ProjectToolbar「设为默认参数」对话框 | 无 |
| `useStorageMode` | 后端模式开关分流（v1 仅前端模式生效） | 无 |
| `useVoiceRefresh` | 同步 voice 列表 | 无 |
| `ttsApi.synthesize` / `mimoTtsApi.*` | 单段生成 | 无 |
| `saveTTSResult` / `getTTSAudioBlob` / `deleteTTSResult` | 音频持久化 | 加 `source` 字段；`getTTSHistory` 过滤 `source === 'segmented_tts'` |

---

## 6. 后端 API 详细规约

### 6.1 POST `/api/text-split/rule`

**Request：**
```json
{
  "text": "string",
  "delimiters": ["，", "。", "！", "？"]
}
```

**Response 200：**
```json
{ "segments": ["...", "..."] }
```

**错误：**
- 400：text 为空 / delimiters 非数组
- 500：unexpected

**实现：纯本地，无 LLM 依赖。**

### 6.2 POST `/api/text-split/llm`

**Request：**
```json
{ "text": "string", "delimiters": ["，", "。"] }
```

**Response 200：**
```json
{
  "segments": [
    { "text": "...", "reason": "语气转折" }
  ],
  "model": "qwen-plus"
}
```

**错误：**
- 400：text 空
- 502：LLM 服务不可达
- 500：解析失败 / 其他

### 6.3 POST `/api/text-split/ssml-annotate`

**Request：**
```json
{
  "texts": ["段1", "段2"],
  "style_hint": "播音腔"     // 可选
}
```

**Response 200：**
```json
{
  "annotations": [
    {
      "text": "段1",
      "ssml": "<speak>段<break time=\"200ms\"/>1</speak>",
      "rationale": "在主语后加短停顿，增加节奏感"
    }
  ],
  "model": "qwen-plus"
}
```

**错误：**
- 400：texts 空数组
- 502/500：同上

**SSML 白名单校验：** `<speak>`, `<break>`, `<prosody>`, `<emphasis>`。其他标签剥除；剥除后纯文本与原文不一致时该段退化为 `<speak>原文</speak>`。

### 6.4 `llm_client.py` 公共能力

迁移自 `llm_subtitle_service.py`，保持现有签名：

```python
def get_llm_config(db=None) -> tuple[str, str, str]:
    """返回 (api_key, base_url, model)，界面配置优先，回退 .env，再回退 MiMo"""

def call_llm(messages: list[dict], db=None, timeout: int = 30) -> str:
    """调用 LLM，返回 content。失败抛 RuntimeError。"""

def extract_json_array(raw: str) -> str | None:
    """从 LLM 返回中提取 JSON 数组字符串。"""
```

`llm_subtitle_service.py` 改为从 `llm_client` re-export，保证现有调用方零修改：
```python
from app.services.llm_client import (
    get_llm_config as _get_llm_config,
    call_llm as _call_llm,
    extract_json_array as _extract_json_array,
)
```

### 6.5 现有 API 复用

无需修改：
- `POST /api/tts/synthesize` —— 单段 CosyVoice / Edge-TTS 生成
- `POST /api/mimo-tts/synthesize-preset` —— MiMo 预置音色
- `POST /api/mimo-tts/synthesize-voiceclone` —— MiMo 复刻
- `POST /api/subtitle-llm/translate` —— 双语 SRT 翻译（直接喂单语 SRT 字符串）

### 6.6 `tts_result.py` 字段补充

添加可空 `source` 字段（migration 友好）：
```python
source = Column(String, nullable=True, default=None)
# None 或 '' = TTSSynthesis 页面历史
# 'segmented_tts' = 编辑器生成的段音频
```

前端模式（IndexedDB）中同名字段。

---

## 7. 错误处理与失败模式

### 7.1 失败模式清单（FMEA）

| # | 失败场景 | 处置 | UI 反馈 |
|---|---|---|---|
| 1 | LLM 拆分超时/失败 | 回退规则拆分 + toast | "智能拆分失败，已用规则拆分作为兜底" |
| 2 | LLM 返回非法 JSON | `extract_json_array` 兜底；仍失败则回退规则 | 同上 |
| 3 | 单段 TTS 失败 | status='failed' + error 字段；不阻断其他段 | 段红边框 + hover 错误详情 + 「重试此段」 |
| 4 | 全部生成中部分失败 | 已成功段保留 | 进度结束后弹「9/12 段成功，3 段失败」 |
| 5 | LLM SSML 含非法标签 | 白名单剥除 | toast「第 X 段标注部分丢失」 |
| 6 | LLM SSML 改了原文 | diff 校验，退化为 `<speak>原文</speak>` | toast「第 X 段标注未生效」 |
| 7 | IDB 写入失败 | 状态保留；toast | "本地保存失败，请检查浏览器存储" |
| 8 | IDB 音频丢失 | 段 status 回 idle | 段橙边「音频已丢失，请重新生成」 |
| 9 | 导出 WAV blob 缺失 | 静音填充 `duration_sec` | 弹窗「N/M 段音频丢失，已用静音填充」 |
| 10 | 导出 WAV 解码失败 | 跳过，记 missing | 同 9 |
| 11 | 超长项目内存压力 | 文档警告 50 段以内最稳；v2 流式 | 长项目警告 |
| 12 | 双语 SRT 翻译失败 | 其他文件正常导出 | toast「双语 SRT 翻译失败」 |
| 13 | 自动保存 race | debounce 500ms + 写入串行队列 | 无 |
| 14 | 关闭页面未生成修改 | 依赖自动保存（最多丢 500ms） | 不做 beforeunload |
| 15 | 文件名非法字符 | 替换为 `_` | 静默 |
| 16 | 项目 schema 不匹配 | 加载时校验 `schema_version` | 弹窗「项目数据格式过旧」 |
| 17 | 重生成时旧 previous 删除失败 | console.warn，不阻断 | 静默 |
| 18 | 后端 API schema 变更 | 类型守卫 + status=failed | toast |
| 19 | 生成中点删除段 | 删除按钮 disabled | tooltip「生成中无法删除」 |
| 20 | uuid 极小概率冲突 | 不防护 | n/a |

### 7.2 错误处理原则

1. **失败局部化** —— 一段失败不影响其他段；一种导出失败不阻断其他导出
2. **降级而非阻塞** —— LLM 不可达 → 规则；音频丢失 → 静音
3. **状态可观察** —— 每段 status + error 持久化，刷新后仍可见
4. **乐观但有保护** —— UI 假设成功（立即更新），失败时回滚 + toast
5. **重试始终可达** —— 任何失败段都有「重试此段」入口

---

## 8. 测试策略

### 8.1 后端测试（`backend/tests/`）

**`test_text_split_service.py`：**
- `rule_split`：标点全开/部分开/全关、空白处理、连续标点、首尾标点、纯标点段过滤、中英混合
- `llm_split`（mock `call_llm`）：标准 JSON / markdown 包裹 / 非法格式抛 ValueError
- `ssml_annotate`（mock `call_llm`）：正常返回、含非白名单标签被剥除、改了原文则退化、style_hint 正确拼到 prompt

**`test_text_split_api.py`：**
- `/api/text-split/rule`：标准 / 空文本 422 / 超长 OK
- `/api/text-split/llm`：成功 / service 抛 502/400/500 的转换
- `/api/text-split/ssml-annotate`：成功 / 空 texts 422

**`test_llm_client.py`：**
- `get_llm_config`：.env 路径、db 配置路径、fallback 到 MiMo
- `extract_json_array`：保持现有 `llm_subtitle_service` 测试覆盖度

**回归保护：** 现有 `test_llm_subtitle_service.py` 不能挂；helper 迁移用 re-export 兼容。

### 8.2 前端测试（`frontend/src/**/__tests__/`）

**`useSegmentedProject.test.ts`** —— reducer 纯函数：
- APPLY_SPLIT 替换 segments + 清空 selected
- APPEND_SEGMENT 末尾追加 + 复用 default_params
- INSERT_SEGMENT 正确位置
- DELETE_SEGMENT + 选中态回退
- REORDER 上移/下移
- GENERATE_SUCCESS 时 current → previous 正确轮换
- UNDO_REGENERATE swap
- 撤销后再生成：previous 被替换为 current，新结果上 current
- BATCH_SET_SSML 批量正确

**`segmentedProjectDB.test.ts`**（用 `fake-indexeddb`）：
- 项目 CRUD
- 删项目时孤儿 ttsResults 清理

**`audioConcat.test.ts`：**
- WAV header 字节正确
- 多段不同采样率 → 升采样到 max 后拼接
- 缺失段静音填充
- `fmtSrtTime` 边界（0ms / 1h+ / 99h+）

### 8.3 手动测试 checklist

- 长文本（5000 字）规则拆分 + 全部生成
- 全部生成中途断网 → 恢复后重试失败段
- 编辑某段 SSML → 重生成 → 撤回
- 切换横/纵布局，状态保持
- 导出 4 种文件，WAV 时长 = 总时长，SRT 时间戳与音频对齐
- 关闭浏览器后重开，项目能加载继续编辑
- IDB 配额满（手动塞数据）→ 优雅降级
- `prefers-reduced-motion` 系统设置下动效降级
- 100 字以上段橙色感叹号
- 生成中删除按钮 disabled

---

## 9. 性能与安全

### 9.1 性能

- 并发生成上限 = 3
- IDB 写入 debounce 500ms
- 大项目（>50 段）音频解码：分批，释放中间 AudioBuffer 让 GC 回收
- 段列表渲染：>30 段考虑虚拟滚动（v1 不强求，简单 row React 渲染 100 行可扛）
- LLM 拆分 fetch 超时 30s；SSML 标注 60s

### 9.2 安全

- 所有 LLM 端点：文档明确「该功能会把文本发送给配置的 LLM 服务」
- SSML 白名单严格过滤，防止注入未支持标签让 TTS API 报错
- 文件名非法字符过滤
- IDB 仅本浏览器可见，无跨域风险

### 9.3 可访问性

- 焦点管理：抽屉打开 focus 第一个输入框，关闭 restore
- 输入框焦点时禁用快捷键（避免 Delete 误删段）
- 图标按钮 aria-label
- `prefers-reduced-motion` 适配

---

## 10. 实施顺序建议

下面只是粗略依赖关系，详细 plan 由 writing-plans 技能产出：

**Phase 1：后端 LLM 基建**
- 抽 `llm_client.py`，迁移 `llm_subtitle_service.py` 内部引用为 re-export
- 新建 `text_split_service.py` + `text_split.py` + 测试（rule + llm，不含 ssml-annotate）
- 注册路由

**Phase 2：前端数据层 + 拆分**
- 类型定义、IDB schema 升级、`segmentedProjectDB`
- `useSegmentedProject` reducer + actions（不含 regenerate / annotateSSML）
- `TextInputPanel` + 路由 + Landing 入口
- 端到端测试：粘贴 → 拆分 → 看到段列表

**Phase 3：前端段编辑 + 单段生成**
- `SegmentList` + `SegmentRow` + 状态动效
- `SegmentEditDrawer`（含 SSML 手动编辑）
- 单段重生成 / 撤销
- `ProjectToolbar` 基础按钮

**Phase 4：批量生成 + 导出**
- regenerateAll 并发调度 + 进度条
- `audioConcat.ts`（WAV）+ `fmtSrtTime` + SRT 生成
- `ExportDialog` + 双语 SRT 调用现有翻译 API

**Phase 5：SSML 智能标注**
- 后端 `ssml_annotate` 服务 + endpoint + 测试
- 前端三处入口接入

**Phase 6：横向布局 + 打磨**
- layout='horizontal' CSS + 底部编辑面板
- 自动保存提示文字
- 可访问性 + reduced-motion
- 手动 checklist 全过

---

## 附录 A：示例 LLM Prompt

### A.1 智能拆分

```
你是中文文本分句助手。请将下面这段文本按语义和语气节奏拆成多个短句，便于
逐句进行语音合成。

要求：
- 严格保留原文一字不改，仅在合适位置切分
- 每段控制在 5-40 字
- 在语气转折、停顿点、并列结构处切分
- 输出 JSON 数组：[{"text": "...", "reason": "切分理由"}]
- 不要包含任何 markdown、解释或额外说明，直接输出 JSON

文本：
<<<USER_TEXT>>>
```

### A.2 SSML 智能标注

```
你是 SSML 标注助手。请为下面的若干段中文文本添加 SSML 标签，
让语音合成更自然、有节奏。

要求：
- 严格保留原文一字不改，仅在合适位置插入标签
- 仅允许使用以下标签：<speak>, <break time="...ms"/>, <prosody rate/pitch/volume>, <emphasis level="...">
- 每段必须用 <speak>...</speak> 包裹
- 风格提示：<<<STYLE_HINT>>>
- 输出 JSON 数组：[{"text": "原文", "ssml": "<speak>...</speak>", "rationale": "简短解释"}]
- 不要包含 markdown 或额外说明

待标注文本：
1. <<<TEXT_1>>>
2. <<<TEXT_2>>>
...
```

## 附录 B：风险与未决事项

- **LLM 模型差异性**：拆分/标注质量高度依赖 LLM 模型。建议默认模型选 qwen-plus，文档提示用户可在「模型配置」页面切换
- **超长项目内存**：100+ 段一次拼接可能 OOM。v1 文档提醒；v2 流式或后端拼接
- **MP3 导出**：v1 仅 WAV。v2 通过后端 ffmpeg 增加 MP3 选项

---

文档结束。
