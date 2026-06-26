# 文本库源文档与旁白文档分离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将文本库重构为双文档模型——源文档（markdown 编辑器）和旁白文档（章节视图），通过 tab 切换，支持左右分栏对比查看。

**Architecture:** 后端在 SegmentedProject 新增 `source_document` 字段；前端 ProjectLibrary 组件拆分为 tab 结构，源文档使用 @uiw/react-md-editor 编辑，旁白文档保持现有章节视图并用 react-markdown 增强渲染；对比模式左右分栏并排显示。

**Tech Stack:** react-markdown, @uiw/react-md-editor, FastAPI, SQLAlchemy, CSS Modules

---

## 文件清单

### 新建文件

| 文件 | 职责 |
|------|------|
| `frontend/src/components/ProjectLibrary/SourceDocumentView.tsx` | 源文档编辑器视图（MDEditor + 底部栏） |
| `frontend/src/components/ProjectLibrary/CompareView.tsx` | 对比模式视图（左右分栏） |
| `frontend/src/components/ProjectLibrary/SourceDocumentView.module.css` | 源文档视图样式 |
| `frontend/src/components/ProjectLibrary/CompareView.module.css` | 对比视图样式 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `backend/app/models/segmented_project.py` | SegmentedProject 新增 `source_document` 列 |
| `backend/app/schemas/segmented_project.py` | ProjectIn 新增 `source_document` 字段 |
| `backend/app/core/database.py` | 新增 P7 迁移语句 |
| `frontend/src/types/index.ts` | SegmentedProject 新增 `source_document` 字段 |
| `frontend/src/hooks/useSegmentedProject.ts` | 新增 `SET_SOURCE_DOCUMENT` action |
| `frontend/src/components/ProjectLibrary/ProjectLibrary.tsx` | 重构为 tab 结构，集成源文档和对比视图 |
| `frontend/src/components/ProjectLibrary/ProjectLibrary.module.css` | 新增 tab 和对比模式样式 |
| `frontend/package.json` | 新增 react-markdown、@uiw/react-md-editor 依赖 |

---

## Task 1: 后端 — 新增 source_document 字段

**Files:**
- Modify: `backend/app/models/segmented_project.py:24-58`
- Modify: `backend/app/schemas/segmented_project.py:69-93`
- Modify: `backend/app/core/database.py:70-73`

- [ ] **Step 1: 在 SegmentedProject 模型新增 source_document 列**

在 `backend/app/models/segmented_project.py` 的 `SegmentedProject` 类中，`remotion_project_path` 列之后添加：

```python
source_document = Column(Text, nullable=True)  # 源文档 markdown 内容
```

- [ ] **Step 2: 在 Pydantic schema 新增 source_document 字段**

在 `backend/app/schemas/segmented_project.py` 的 `ProjectIn` 类中，`remotion_project_path` 字段之后添加：

```python
source_document: str | None = None
```

- [ ] **Step 3: 新增 P7 迁移语句**

在 `backend/app/core/database.py` 的 `_P6_CLONE_AUDIO_PATHS_ALTER_STMTS` 之后添加：

```python
# P7: source document for library.
_P7_SOURCE_DOCUMENT_ALTER_STMTS = (
    "ALTER TABLE segmented_projects ADD COLUMN source_document TEXT",
)
```

然后在 `init_db()` 函数的 `for stmt in` 链中追加 `+ _P7_SOURCE_DOCUMENT_ALTER_STMTS`。

- [ ] **Step 4: 验证后端编译和测试**

```bash
cd backend && uv run python -c "from app.models.segmented_project import SegmentedProject; print('OK')"
cd backend && uv run --extra test pytest tests/unit/test_segmented_project_service.py -q
```

Expected: 编译通过，测试通过。

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/segmented_project.py backend/app/schemas/segmented_project.py backend/app/core/database.py
git commit -m "feat: add source_document field to SegmentedProject"
```

---

## Task 2: 前端 — 类型和 reducer 更新

**Files:**
- Modify: `frontend/src/types/index.ts:397-426`
- Modify: `frontend/src/hooks/useSegmentedProject.ts`

- [ ] **Step 1: SegmentedProject 类型新增 source_document**

在 `frontend/src/types/index.ts` 的 `SegmentedProject` 接口中，`remotion_project_path` 字段之后添加：

```typescript
source_document?: string | null;
```

- [ ] **Step 2: 新增 SET_SOURCE_DOCUMENT action**

在 `frontend/src/hooks/useSegmentedProject.ts` 中：

1. 在 Action 联合类型中新增：

```typescript
| { type: 'SET_SOURCE_DOCUMENT'; text: string }
```

2. 在 reducer 中新增 case（在 `SET_PROJECT_META` case 附近）：

```typescript
case 'SET_SOURCE_DOCUMENT':
  return { project: { ...p, source_document: action.text, updated_at: new Date().toISOString() } };
```

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/hooks/useSegmentedProject.ts
git commit -m "feat: add source_document to frontend types and reducer"
```

---

## Task 3: 前端 — 安装依赖

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装 react-markdown 和 @uiw/react-md-editor**

```bash
cd frontend && npm install react-markdown @uiw/react-md-editor
```

- [ ] **Step 2: 验证安装**

```bash
cd frontend && node -e "require('react-markdown'); require('@uiw/react-md-editor'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "feat: add react-markdown and @uiw/react-md-editor dependencies"
```

---

## Task 4: 前端 — SourceDocumentView 组件

**Files:**
- Create: `frontend/src/components/ProjectLibrary/SourceDocumentView.tsx`
- Create: `frontend/src/components/ProjectLibrary/SourceDocumentView.module.css`

- [ ] **Step 1: 创建 SourceDocumentView.module.css**

```css
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 500px;
}

.editor {
  flex: 1;
  min-height: 400px;
}

.editor :global(.w-md-editor) {
  border: none;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
}

.editor :global(.w-md-editor-content) {
  min-height: 400px;
}

.bottomBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border-light);
  background: var(--color-surface);
}

.stats {
  display: flex;
  gap: 16px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.ghostButton {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
}

.ghostButton:hover {
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
}
```

- [ ] **Step 2: 创建 SourceDocumentView.tsx**

```tsx
import { useCallback, useRef } from 'react';
import MDEditor from '@uiw/react-md-editor';
import styles from './SourceDocumentView.module.css';

interface SourceDocumentViewProps {
  content: string;
  onChange: (text: string) => void;
  onCompare: () => void;
}

function countChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

export function SourceDocumentView({ content, onChange, onCompare }: SourceDocumentViewProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleChange = useCallback((value: string | undefined) => {
    const text = value ?? '';
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(text), 500);
  }, [onChange]);

  return (
    <div className={styles.container} data-color-mode="light">
      <div className={styles.editor}>
        <MDEditor
          value={content}
          onChange={handleChange}
          preview="live"
          height="100%"
          visibleDragbar={false}
          hideToolbar={false}
        />
      </div>
      <div className={styles.bottomBar}>
        <button type="button" className={styles.ghostButton} onClick={onCompare}>
          对比查看
        </button>
        <div className={styles.stats}>
          <span>{countChars(content)} 字</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ProjectLibrary/SourceDocumentView.tsx frontend/src/components/ProjectLibrary/SourceDocumentView.module.css
git commit -m "feat: add SourceDocumentView component with MDEditor"
```

---

## Task 5: 前端 — CompareView 组件

**Files:**
- Create: `frontend/src/components/ProjectLibrary/CompareView.tsx`
- Create: `frontend/src/components/ProjectLibrary/CompareView.module.css`

- [ ] **Step 1: 创建 CompareView.module.css**

```css
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 500px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-light);
}

.headerTitle {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.ghostButton {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
}

.ghostButton:hover {
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
}

.columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex: 1;
  overflow: hidden;
}

.column {
  overflow-y: auto;
  padding: 24px;
}

.column:first-child {
  border-right: 1px solid var(--color-border-light);
}

.columnLabel {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 16px;
}

.content {
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--color-text-primary);
}

.content h1,
.content h2,
.content h3 {
  margin: 1.2em 0 0.6em;
  font-weight: 600;
}

.content p {
  margin: 0.6em 0;
}

.content ul,
.content ol {
  padding-left: 1.5em;
  margin: 0.6em 0;
}

.content blockquote {
  margin: 0.6em 0;
  padding: 0.5em 1em;
  border-left: 3px solid var(--color-border);
  color: var(--color-text-secondary);
}
```

- [ ] **Step 2: 创建 CompareView.tsx**

```tsx
import Markdown from 'react-markdown';
import styles from './CompareView.module.css';

interface CompareViewProps {
  sourceDocument: string;
  narrationText: string;
  onBack: () => void;
}

export function CompareView({ sourceDocument, narrationText, onBack }: CompareViewProps) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>对比查看</span>
        <button type="button" className={styles.ghostButton} onClick={onBack}>
          ← 返回
        </button>
      </div>
      <div className={styles.columns}>
        <div className={styles.column}>
          <span className={styles.columnLabel}>源文档</span>
          <div className={styles.content}>
            <Markdown>{sourceDocument || '*（空）*'}</Markdown>
          </div>
        </div>
        <div className={styles.column}>
          <span className={styles.columnLabel}>旁白文档</span>
          <div className={styles.content}>
            <Markdown>{narrationText || '*（空）*'}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ProjectLibrary/CompareView.tsx frontend/src/components/ProjectLibrary/CompareView.module.css
git commit -m "feat: add CompareView component with side-by-side markdown rendering"
```

---

## Task 6: 前端 — ProjectLibrary 重构为 tab 结构

**Files:**
- Modify: `frontend/src/components/ProjectLibrary/ProjectLibrary.tsx`
- Modify: `frontend/src/components/ProjectLibrary/ProjectLibrary.module.css`

这是核心改动。将 ProjectLibrary 从单视图重构为 tab 切换结构。

- [ ] **Step 1: 更新 ProjectLibraryProps 接口**

在 `ProjectLibrary.tsx` 中，扩展 props 接口：

```typescript
interface ProjectLibraryProps {
  chapters: Chapter[];
  activeChapterId?: string;
  sourceDocument?: string | null;
  onSelectChapter: (id: string) => void;
  onRenameChapter: (id: string, name: string) => void;
  onUpdateChapterText: (id: string, text: string) => void;
  onUpdateChapterDesignTitle: (id: string, designTitle: string) => void;
  onUpdateSourceDocument?: (text: string) => void;
  onAddChapter: (name?: string) => void;
  onDeleteChapter: (id: string) => void;
  onEnterStudio: (chapterId: string) => void;
  onModeChange?: (mode: 'overview' | 'chapter' | 'fulltext') => void;
}
```

新增 `sourceDocument` 和 `onUpdateSourceDocument` props。

- [ ] **Step 2: 新增 tab 和对比状态**

在组件内部新增状态：

```typescript
type LibraryTab = 'source' | 'narration';

const [activeTab, setActiveTab] = useState<LibraryTab>('narration');
const [comparing, setComparing] = useState(false);
```

- [ ] **Step 3: 导入新组件和依赖**

在文件顶部添加：

```tsx
import Markdown from 'react-markdown';
import { SourceDocumentView } from './SourceDocumentView';
import { CompareView } from './CompareView';
```

- [ ] **Step 4: 重构 return 结构**

将现有的 return 包裹在 tab 结构中。整体结构变为：

```tsx
return (
  <section className={styles.root}>
    {/* Header with tabs */}
    <header className={styles.libraryHeader}>
      <div>
        <span className={styles.kicker}>Library</span>
        <h2>文本库</h2>
      </div>
      <div className={styles.headerActions}>
        <div className={styles.tabBar}>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === 'source' ? styles.tabActive : ''}`}
            onClick={() => { setActiveTab('source'); setComparing(false); }}
          >
            源文档
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === 'narration' ? styles.tabActive : ''}`}
            onClick={() => { setActiveTab('narration'); setComparing(false); }}
          >
            旁白文档
          </button>
        </div>
        {/* Narration-only actions */}
        {activeTab === 'narration' && !comparing && (
          <>
            <button type="button" className={styles.ghostButton} onClick={() => setMode('fulltext')}>查看全文</button>
            <button type="button" className={styles.primaryButton} onClick={() => setCreatingChapter(true)}>新建章节</button>
          </>
        )}
      </div>
    </header>

    {/* Content */}
    {comparing ? (
      <CompareView
        sourceDocument={sourceDocument ?? ''}
        narrationText={chapters.map(ch => chapterText(ch)).filter(Boolean).join('\n\n')}
        onBack={() => setComparing(false)}
      />
    ) : activeTab === 'source' ? (
      <SourceDocumentView
        content={sourceDocument ?? ''}
        onChange={(text) => onUpdateSourceDocument?.(text)}
        onCompare={() => setComparing(true)}
      />
    ) : (
      /* 现有的旁白文档视图逻辑（overview / chapter / fulltext）保持不变 */
      <>
        {/* 现有代码 */}
      </>
    )}
  </section>
);
```

- [ ] **Step 5: 更新 CSS 新增 tab 样式**

在 `ProjectLibrary.module.css` 中添加：

```css
.tabBar {
  display: flex;
  gap: 2px;
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  padding: 2px;
}

.tab {
  padding: 6px 16px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.tab:hover {
  color: var(--color-text-primary);
}

.tabActive {
  background: var(--color-surface);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-sm);
}

.ghostButton {
  padding: 6px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
}

.ghostButton:hover {
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
}
```

- [ ] **Step 6: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ProjectLibrary/ProjectLibrary.tsx frontend/src/components/ProjectLibrary/ProjectLibrary.module.css
git commit -m "feat: refactor ProjectLibrary with tab structure for source/narration"
```

---

## Task 7: 前端 — TTSSynthesis 接入 source_document

**Files:**
- Modify: `frontend/src/pages/TTSSynthesis.tsx`

- [ ] **Step 1: 传递 sourceDocument 给 ProjectLibrary**

在 `TTSSynthesis.tsx` 中找到 `<ProjectLibrary` 的使用位置，添加 props：

```tsx
<ProjectLibrary
  chapters={project.chapters}
  activeChapterId={project.active_chapter_id}
  sourceDocument={project.source_document}
  onSelectChapter={handleSelectChapter}
  onRenameChapter={(id, name) => dispatch({ type: 'RENAME_CHAPTER', id, name })}
  onUpdateChapterText={(id, text) => {
    dispatch({ type: 'SET_CHAPTER_META_BY_ID', id, meta: { original_text: text } });
  }}
  onUpdateChapterDesignTitle={(id, designTitle) => {
    dispatch({ type: 'SET_CHAPTER_META_BY_ID', id, meta: { design_title: designTitle } });
  }}
  onUpdateSourceDocument={(text) => dispatch({ type: 'SET_SOURCE_DOCUMENT', text })}
  onAddChapter={handleAddChapter}
  onDeleteChapter={handleDeleteChapter}
  onEnterStudio={(chapterId) => {
    handleSelectChapter(chapterId);
    setProjectSection('studio');
  }}
  onModeChange={(m) => setLibraryFulltext(m === 'fulltext')}
/>
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/TTSSynthesis.tsx
git commit -m "feat: wire source_document through TTSSynthesis to ProjectLibrary"
```

---

## Task 8: 前端 — 旁白文档 markdown 渲染增强

**Files:**
- Modify: `frontend/src/components/ProjectLibrary/ProjectLibrary.tsx`

- [ ] **Step 1: 在 fulltext 模式使用 react-markdown 渲染**

将 fulltext 模式的只读 `<textarea>` 替换为 `react-markdown` 渲染：

```tsx
if (mode === 'fulltext') {
  const allText = chapters.map(ch => chapterText(ch)).filter(Boolean).join('\n\n');
  // ... existing header and metrics ...
  return (
    <section className={styles.chapterEditorRoot}>
      {/* header 不变 */}
      <div className={styles.markdownPreview}>
        <Markdown>{allText || '*尚未填写任何章节全文。*'}</Markdown>
      </div>
      {/* bottomBar 不变 */}
    </section>
  );
}
```

- [ ] **Step 2: 在 chapter 模式添加预览切换**

在 chapter 模式的 textarea 旁边添加一个预览按钮，点击后用 react-markdown 渲染当前章节文本：

```tsx
const [showPreview, setShowPreview] = useState(false);
```

在 chapter 模式的编辑区域：

```tsx
{showPreview ? (
  <div className={styles.markdownPreview}>
    <Markdown>{text || '*尚未填写章节全文。*'}</Markdown>
  </div>
) : (
  <textarea
    className={styles.manuscriptEditor}
    aria-label="章节全文"
    value={text}
    onChange={(event) => onUpdateChapterText(activeChapter.id, event.target.value)}
    placeholder="在这里维护本章完整旁白稿。进入工作室后再切分为语音段落。"
  />
)}
```

在底部栏添加切换按钮：

```tsx
<button
  type="button"
  className={styles.ghostButton}
  onClick={() => setShowPreview(!showPreview)}
>
  {showPreview ? '编辑' : '预览'}
</button>
```

- [ ] **Step 3: 添加 markdownPreview 样式**

在 `ProjectLibrary.module.css` 中添加：

```css
.markdownPreview {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--color-text-primary);
}

.markdownPreview h1,
.markdownPreview h2,
.markdownPreview h3 {
  margin: 1.2em 0 0.6em;
  font-weight: 600;
}

.markdownPreview p {
  margin: 0.6em 0;
}

.markdownPreview ul,
.markdownPreview ol {
  padding-left: 1.5em;
  margin: 0.6em 0;
}

.markdownPreview blockquote {
  margin: 0.6em 0;
  padding: 0.5em 1em;
  border-left: 3px solid var(--color-border);
  color: var(--color-text-secondary);
}
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ProjectLibrary/ProjectLibrary.tsx frontend/src/components/ProjectLibrary/ProjectLibrary.module.css
git commit -m "feat: enhance narration document with react-markdown rendering"
```

---

## Task 9: 端到端验证

- [ ] **Step 1: 启动后端并验证迁移**

```bash
cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8002 --reload &
sleep 3
curl -s http://127.0.0.1:8002/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 2: 验证 API 返回 source_document 字段**

```bash
# 获取项目列表
curl -s http://127.0.0.1:8002/api/segmented-projects | python3 -m json.tool | head -20
```

Expected: 项目对象中包含 `"source_document": null` 字段。

- [ ] **Step 3: 启动前端并验证编译**

```bash
cd frontend && npm run build
```

Expected: 构建成功，无错误。

- [ ] **Step 4: 手动验证 UI**

1. 打开前端，进入一个项目
2. 点击「文本库」
3. 确认顶部有「源文档 | 旁白文档」tab
4. 切换到「源文档」tab → 看到 markdown 编辑器
5. 输入一些 markdown 文本 → 确认自动保存
6. 切换到「旁白文档」tab → 看到现有章节视图
7. 点击「查看全文」→ 确认用 react-markdown 渲染
8. 在旁白文档 tab 点击「打开文本」→ 确认有「预览」按钮
9. 切换到「源文档」tab → 点击「对比查看」→ 确认左右分栏显示

- [ ] **Step 5: 运行后端测试**

```bash
cd backend && uv run --extra test pytest -q
```

Expected: 所有测试通过。

- [ ] **Step 6: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: polish source/narration library integration"
```
