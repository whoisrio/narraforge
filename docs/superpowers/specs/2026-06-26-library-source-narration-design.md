# 文本库源文档与旁白文档分离设计

## 概述

将文本库重构为双文档模型：**源文档**（原始素材，markdown 编辑器）和**旁白文档**（用于 TTS 合成，章节视图），通过 tab 切换，支持左右分栏对比查看。

## 目标

1. 引入 `react-markdown` + `@uiw/react-md-editor`，增强文档阅读和编辑体验
2. 文本库区分源文档和旁白文档，tab 切换
3. 源文档：单个 markdown 文件，可编辑，不分章节
4. 旁白文档：保持现有章节结构，markdown 渲染增强阅读
5. 对比模式：左右分栏并排查看源文档和旁白文档全文

## 不在范围内

- 源文档→旁白文档的 agent 改写能力（后续单独设计）
- 源文档的章节划分（源文档始终是单文件）

## 数据模型

### 源文档

在 `SegmentedProject` 上新增字段：

```
source_document: string | null   // markdown 内容，存储在项目级别
```

- 一个项目只有一个源文档
- 源文档是单个 markdown 文件，不分章节
- 与旁白文档（chapters）独立，1:1 关联

### 旁白文档

保持现有结构不变：

- `Chapter.original_text` — 每章的旁白文本
- `Segment` — 分段后的 TTS 单元
- `NarrationDocument` — 可选的 markdown 格式旁白文档（P2 功能）

### 后端模型变更

`SegmentedProject` 模型新增：

```python
source_document = Column(Text, nullable=True)  # 源文档 markdown 内容
```

API：现有的 project GET/PUT 接口已支持 `source_document` 字段的读写。

## 前端架构

### 新增依赖

```json
{
  "react-markdown": "^9.x",
  "@uiw/react-md-editor": "^4.x"
}
```

### 组件结构

```
ProjectLibrary
├── LibraryTabs (顶部 tab: 源文档 | 旁白文档)
├── SourceDocumentView (源文档视图)
│   ├── MDEditor (@uiw/react-md-editor)
│   └── 底部栏: 对比查看按钮
├── NarrationDocumentView (旁白文档视图，现有逻辑)
│   ├── overview mode (章节卡片网格)
│   ├── chapter mode (单章编辑)
│   └── fulltext mode (全文查看)
└── CompareView (对比模式，左右分栏)
    ├── 左栏: 源文档 markdown 渲染 (react-markdown)
    └── 右栏: 旁白文档全文渲染 (react-markdown)
```

### LibraryMode 扩展

```typescript
type LibraryMode = 'overview' | 'chapter' | 'fulltext';
type LibraryTab = 'source' | 'narration';

// 新增状态
const [activeTab, setActiveTab] = useState<LibraryTab>('narration');
const [comparing, setComparing] = useState(false);
const [sourceDocument, setSourceDocument] = useState('');  // 从 project.source_document 读取
```

### 源文档视图 (SourceDocumentView)

- 使用 `@uiw/react-md-editor` 的 `MDEditor` 组件
- 编辑模式：默认 split 模式（左编辑右预览），可切换为 preview/edit 模式
- 自动保存：编辑内容通过 debounce 写入 `project.source_document`
- 底部栏：「对比查看」按钮、字数统计

### 对比模式 (CompareView)

- 左右分栏，各占 50% 宽度
- 左栏：源文档 `react-markdown` 渲染
- 右栏：旁白文档全文（所有 chapter 的 `original_text` 拼接）`react-markdown` 渲染
- 顶部：「返回」按钮
- 两栏同步滚动（可选，后续优化）

### 旁白文档视图增强

- 章节编辑模式的 `<textarea>` 替换为 `react-markdown` 渲染（只读预览模式）
- 编辑时仍用 textarea 或 MDEditor
- 全文查看模式使用 `react-markdown` 渲染

## UI 流程

### 默认状态

```
[文本库] [源文档 | 旁白文档]     [新建章节]
                                 [查看全文]
                                 [对比查看]

旁白文档 tab → 现有的章节卡片网格
```

### 源文档 tab

```
[文本库] [源文档 | 旁白文档]

┌─────────────────────────────────┐
│  @uiw/react-md-editor           │
│  ┌──────────┬──────────┐        │
│  │ 编辑区    │ 预览区    │        │
│  │          │          │        │
│  │          │          │        │
│  └──────────┴──────────┘        │
│                                 │
│  [对比查看]  1,234 字            │
└─────────────────────────────────┘
```

### 对比模式

```
[文本库] [源文档 | 旁白文档]  [← 返回]

┌────────────────┬────────────────┐
│ 源文档          │ 旁白文档        │
│                │                │
│ react-markdown │ react-markdown │
│ 渲染            │ 渲染           │
│                │                │
│                │                │
└────────────────┴────────────────┘
```

## 数据流

### 源文档保存

```
用户编辑 MDEditor
→ debounce 500ms
→ dispatch({ type: 'SET_SOURCE_DOCUMENT', text })
→ project.source_document 更新
→ 自动保存 (backend/IndexedDB)
```

### 源文档读取

```
加载项目时
→ project.source_document 读取
→ setSourceDocument(text)
→ MDEditor 显示
```

## 后端变更

### 数据库

`SegmentedProject` 模型新增 `source_document` 字段（Text, nullable）。

迁移语句：

```python
"ALTER TABLE segmented_projects ADD COLUMN source_document TEXT"
```

### API

现有的 project GET/PUT 接口自动包含 `source_document` 字段（Pydantic schema 已支持额外字段的透传）。

## 实现顺序

1. 安装依赖：`react-markdown`、`@uiw/react-md-editor`
2. 后端：`SegmentedProject` 新增 `source_document` 字段 + 迁移
3. 前端类型：`SegmentedProject` 新增 `source_document?: string`
4. 前端：ProjectLibrary 新增 tab 切换和源文档视图
5. 前端：对比模式实现
6. 前端：旁白文档 markdown 渲染增强

## 验证

1. 创建项目 → 切换到源文档 tab → 编辑 markdown → 保存 → 刷新后内容保留
2. 切换到旁白文档 tab → 现有功能不受影响
3. 点击对比查看 → 左右分栏显示源文档和旁白文档
4. 源文档编辑 → 自动保存 → 后端 GET 接口返回 source_document
