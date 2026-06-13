# Source 导入 & 旁白文档架构 — V3

> Branch: `feat/source-ingestion` (从 `feat/project-workbench` 拉出)
> 状态: 设计中 (V3 — 引入"旁白文档"作为 LLM 中间产物)

## 核心架构变化 (相对 V2)

### V2 (作废)
- 源关联到 chapter (`chapter.current_source_id`)
- chapter.original_text = ASR 转写 / 粘贴的原文
- 切源 = 切章节

### V3 (当前)
- 源是**项目级全局**资产 (挂在 ProjectSidebar)
- 新增 `narration_documents` 表 = LLM 合成后的旁白文档
- chapter.original_text = 旁白文档中该章节的**切片** (按 # H2 自动切)
- 切源 = 切项目级源 (不直接动章节)

### 数据流
```
项目 N 个源 (侧栏多选)
  ↓ [LLM 合成 (口播化、按 H2 切分)]
旁白文档 (项目级一份, 可多版本)
  ↓ [markdown 解析, 按 H2 自动切片到各 chapter]
chapter.original_text
  ↓ [规则 / 智能拆分]
segments → TTS 合成
```

---

## 数据模型

### 新增表: `source_documents` (项目级)
```sql
CREATE TABLE source_documents (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,           -- FK ON DELETE CASCADE
  source_type   TEXT NOT NULL,           -- 'paste' | 'audio' | 'path'
  title         TEXT NOT NULL,           -- 显示名 (文件名 / 前 30 字)
  file_path     TEXT,                    -- source_type='path' 时的本地引用
  pasted_text   TEXT,                    -- source_type='paste' 时的原文
  audio_path    TEXT,                    -- source_type='audio' 时上传的文件路径
  file_size     INTEGER,
  duration_sec  REAL,                    -- audio 时长
  created_at    TEXT NOT NULL,
  -- 故意不存 transcript_text / word_count / language
  -- 这些信息住在 chapter.original_text (口播稿已经把它们吸进去了)
  FOREIGN KEY (project_id) REFERENCES segmented_projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_source_documents_project ON source_documents(project_id);
```

**互斥约束**: `file_path`, `pasted_text`, `audio_path` 三个字段只有一个非空 (按 source_type)。

### 新增表: `narration_documents` (项目级, 可多版本)
```sql
CREATE TABLE narration_documents (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  version         TEXT NOT NULL,         -- 'v1', 'v2', 'v2.1' (semver-like)
  version_kind    TEXT NOT NULL,         -- 'full' (整稿重生成) | 'partial' (章节级)
  body_markdown   TEXT NOT NULL,         -- 整篇旁白文档 markdown (含 # H2 切分)
  word_count      INTEGER NOT NULL,
  source_ids_json TEXT NOT NULL,         -- JSON array of source_document ids
  prompt_hint     TEXT,                  -- 用户在生成时填的补充提示
  settings_json   TEXT NOT NULL,         -- {target_chapters, target_words, language, engine}
  generated_at    TEXT NOT NULL,
  -- chapter slices (可选, 冗余存储避免每次解析 markdown)
  chapter_slices_json TEXT,              -- JSON: [{chapter_index, title, start_char, end_char}]
  FOREIGN KEY (project_id) REFERENCES segmented_projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_narration_documents_project ON narration_documents(project_id, version DESC);
```

**版本规则**:
- 整稿重新生成 (LLM 跑全部选中源) → `v{N+1}` (大版本)
- 单章节再生成 → `v{N}.{M+1}` (小版本)

**唯一性**: (project_id, version) 联合唯一

### 修改表: `chapters`
```sql
ALTER TABLE chapters ADD COLUMN narration_document_id TEXT;
ALTER TABLE chapters ADD COLUMN narration_version TEXT;       -- e.g. 'v2.1' (这个章节用哪个版本的旁白)
ALTER TABLE chapters ADD COLUMN narration_slice_start INTEGER; -- char offset in body_markdown
ALTER TABLE chapters ADD COLUMN narration_slice_end INTEGER;
ALTER TABLE chapters ADD COLUMN narration_synced_at TEXT;
-- 移除: current_source_id (V2 决策, V3 不用)
-- original_text 保留, 但语义变为 = 旁白文档该章节的切片 (允许手工润色)
```

**单章节再生成的 fork 机制** (D3 决策):
- v2 整稿不动
- v2.1 整稿 = v2 内容 + 那个章节的新内容 (其他章节标 `<!-- INHERIT FROM v2 -->`)
- chapter.narration_version = 'v2.1'
- chapter.original_text = v2.1.body_markdown[slice] (该章节切片)

**chapter 关联模型变化**:
- 一个 chapter 的 narration_version 不必所有章节一致
- 比如项目里有 3 章节, chapter 1 用 v2.1, chapter 2 用 v2, chapter 3 用 v2.1 — 完全 OK
- chapter.narration_document_id 指向具体那一份旁白文档

### 修改表: `segments`
无变化。

---

## 关键决策 (已拍板)

| # | 决策点 | 选择 |
|---|--------|------|
| D1 | 旁白文档是项目级唯一一份还是多版本? | **多版本 (v1/v2/v2.1)** — 上限 10 个版本, 超限 LRU 删最老 |
| D2 | 章节切片: LLM 输出时切还是后端 markdown parser 切? | **默认 markdown parser (H2 切) + LLM marker 作为可选增强** — prompt 建议 LLM 输出 `<!-- CHAPTER: 标题 -->` 标记, parser 先 try marker 找不到再 fallback H2 |
| D3 | 单章节再生成: 局部替换整稿还是单章独立存? | **单章独立存** — 不修改 v2 整稿, 为该章节单独生成一份新的整稿版本 (v2.1), 其他章节保持 v2 原文 |

---

## API 端点 (V3)

### 源管理
```
GET    /api/projects/{project_id}/sources
POST   /api/projects/{project_id}/sources           {source_type, title, ...}
DELETE /api/projects/{project_id}/sources/{id}
POST   /api/projects/{project_id}/sources/{id}/transcript  -- 对音频源触发 ASR (单独, 不自动)
```

### 旁白文档
```
GET    /api/projects/{project_id}/narrations                 -- 列出所有版本
GET    /api/projects/{project_id}/narrations/{version}       -- 取某个版本 (含 body_markdown)
POST   /api/projects/{project_id}/narrations/generate        -- 整稿生成 {source_ids, prompt_hint, settings}
POST   /api/projects/{project_id}/narrations/{version}/chapters/{idx}/regenerate  -- 单章重写
```

### 章节
```
GET    /api/projects/{project_id}/chapters                    -- 含 narration_* 字段
POST   /api/projects/{project_id}/chapters/{id}/sync-from-narration  -- 从 narration 重新切片 (章节已编辑时弹 confirm)
```

### 能力检测
```
GET    /api/system/capabilities  -- {ffmpeg: bool, asr_engines: [...]}
```

---

## UI 设计 (V3 决策)

### ProjectSidebar 拆成两 section
```
┌ 项目 ──────────────────┐
│  + 新建项目            │
│  📌 草稿台     (默认)  │
│  📕 DeepSeek  [active] │
│  📘 MoE               │
└────────────────────────┘
┌ DeepSeek · 源 (3) ─────┐
│  ☑ 📄 notes.md   320字 │
│  ☑ 🎵 interview  4:32  │
│  ☐ 🔗 论文.pdf   链接  │
│  + 添加源              │
│  [🧠 基于 2 源生成旁白]│
└────────────────────────┘
```

### 章节编辑器 (新常态)
```
[旁白 banner: 📜 v2 · 3 章节 · 1,247字 · 10:23  👁 📋 🔄]
[chapter tabs: 第1章(active) | 第2章 | 第3章 | +]

[TextInputPanel (简化)]
  header: 📜 v2 › 第 1 章 · 战略起源    [已同步 ✓]
  [可编辑 textarea, 内容 = 旁白 v2 第 1 章切片]
  [拆分按钮 + 字数 320]

[segments ...]
```

### 弹窗: 生成旁白
- 选中源 (chips, 可点击移除)
- 补充提示 (textarea)
- 目标章节数 / 长度 / 语言 / 引擎
- [取消] [🧠 生成 v3]

### 旁白全屏视图
- markdown 渲染, 每章节可点击跳回编辑器
- [📋 复制] [⬇ 导出] [← 返回]

---

## 范围 (本次只做)

P2 范围 = **文本 + 音频 (mp3/wav)**, 视频延后。
- 不引入 FFmpeg (视频抽音暂不做)
- audio 限 mp3/wav
- 不做 path 类型 (path 实际上是 filePath 引用, v1 可只做 paste + audio)

**v1 简化**: 先只做 `paste` + `audio` 两种 source_type, `path` 类型延后 (与视频一起做)。

**UI 参考**: `docs/demos/p2-narration-architecture.html` (V3 7 区块演示)

---

## 实施步骤 (16 tasks)

### Phase A: 后端 (P2.2 - P2.4)
- A1. `source_documents` model + 迁移脚本
- A2. `narration_documents` model + 迁移脚本
- A3. chapter 表加 narration 字段
- A4. POST/GET/DELETE source 端点 (paste + audio)
- A5. POST /narrations/generate (LLM 调用 + 写表)
- A6. GET /narrations/{version} 端点
- A7. POST chapter regen (单章 LLM 重写 + 局部替换)
- A8. GET /api/system/capabilities
- A9. 后端测试 (4 套 pytest)

### Phase B: 前端 (P2.5 - P2.6)
- B1. ProjectSidebar 拆分 (项目列表 + 项目级源 section)
- B2. useSourceManager hook
- B3. useNarrationManager hook
- B4. SourceItem 组件 (侧栏源条目, 多选/删除/上传)
- B5. GenerateNarrationModal 组件
- B6. NarrationBanner 组件 (章节编辑器顶部)
- B7. NarrationFullView 组件 (全屏视图)
- B8. TextInputPanel 简化 (移除 source tabs, 改为面包屑)
- B9. 接入主布局 (TTSSynthesis.tsx)
- B10. 前端测试 (1 套 vitest)

### Phase C: 文档 (P2.8)
- C1. 更新 `docs/feature-spec.md` (新增"源管理"+"旁白文档"章节)
- C2. 更新 `docs/api-reference.md` (新增 12 个端点)
- C3. 更新 `docs/database-schema.md` (新增 2 表 + 章节字段)
- C4. 更新 `docs/roadmap.md` (Phase 2 进度)

---

## 测试矩阵

### 后端
- `test_source_documents.py` — CRUD + cascade delete
- `test_narration_generation.py` — LLM mock + markdown 切片正确性
- `test_narration_versioning.py` — v2 → v3 → v2.1 流程
- `test_chapter_sync.py` — 从 narration 切片到 chapter.original_text

### 前端
- `SourceManager.test.ts` — 源多选 / 添加 / 删除
- `NarrationBanner.test.ts` — 版本号显示 / 看全文跳转
- `GenerateNarrationModal.test.ts` — 选源 / 提示 / 提交

---

## 数据迁移 (V2 → V3)

如果 master 上已有 chapter.current_source_id 字段:
- ALTER TABLE chapters DROP COLUMN current_source_id
- 新建 source_documents / narration_documents 表
- 旧 chapter.original_text 不变 (用户可能已经手工编辑过, 不强转)

---

## 不做

- ❌ 视频抽音 (FFmpeg) — 视频类型延后
- ❌ source_type='path' 引用 — 延后
- ❌ 跨项目源库 — 暂不共享, 每个项目独立源
- ❌ LLM 智能切章节 (LLM 只管生成旁白稿, 切片由 markdown parser 做)
- ❌ 旁白版本 diff 视图 — 留待 v2
