# Workflow Frontend UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现工作流前端 3 个页面：WorkflowHub（Run 列表）、ReviewEditor（脚本审批）、WorkflowRunDetail（阶段详情），以及在 ProjectShell 中添加 Workflow 导航。

**Architecture:** 新增 `frontend/src/components/Workflow/` 目录，包含 3 个主要组件。集成到现有 ProjectShell 导航系统中。使用 CSS Modules 样式。

**Tech Stack:** React 19, TypeScript, CSS Modules (camelCase)

**Spec:** `docs/superpowers/specs/2026-07-10-narration-workflow-design.md` 第 8 章

**Depends on:**
- `2026-07-10-workflow-frontend-foundation.md` (类型、API 客户端、i18n、SSE hook)

## Global Constraints

- CSS Modules 使用 camelCase 命名（`styles.workflowHub`）
- 所有 UI 文本使用 `t('workflow.xxx')` 翻译
- 组件文件放在 `frontend/src/components/Workflow/` 目录
- 遵循现有组件模式（函数组件 + hooks）
- 主色调使用 warm amber（`#c47a3a`），不引入紫色

---

### Task 1: 创建 WorkflowHub 组件

**Files:**
- Create: `frontend/src/components/Workflow/WorkflowHub.tsx`
- Create: `frontend/src/components/Workflow/WorkflowHub.module.css`

**Interfaces:**
- Produces: `WorkflowHub` component (props: `projectId: string`)
- Consumes: `workflowApi.list()`, `workflowApi.start()`, `workflowApi.cancel()`
- Consumes: `useTranslation()`, `useWorkflowStream()`

- [ ] **Step 1: 创建 CSS Module**

```css
/* frontend/src/components/Workflow/WorkflowHub.module.css */
.workflowHub {
  padding: 24px;
  max-width: 960px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.title {
  font-size: 24px;
  font-weight: 600;
  color: #1a1a1a;
}

.newRunButton {
  padding: 8px 16px;
  background: #c47a3a;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.newRunButton:hover {
  background: #a86530;
}

.newRunButton:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.runCard {
  background: white;
  border: 1px solid #e8e0d8;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}

.runHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.statusBadge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.statusRunning {
  background: #e3f2fd;
  color: #1976d2;
}

.statusInterrupted {
  background: #fff3e0;
  color: #f57c00;
}

.statusCompleted {
  background: #e8f5e9;
  color: #388e3c;
}

.statusFailed {
  background: #ffebee;
  color: #d32f2f;
}

.statusCancelled {
  background: #f5f5f5;
  color: #757575;
}

.stagesRow {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.stageChip {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  text-align: center;
  font-size: 12px;
  background: #f5f5f5;
  color: #666;
}

.stageChipCompleted {
  background: #e8f5e9;
  color: #388e3c;
}

.stageChipRunning {
  background: #e3f2fd;
  color: #1976d2;
}

.stageChipInterrupted {
  background: #fff3e0;
  color: #f57c00;
}

.stageChipFailed {
  background: #ffebee;
  color: #d32f2f;
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.actionButton {
  padding: 6px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.actionButton:hover {
  background: #f5f5f5;
  border-color: #c47a3a;
}

.actionButton.primary {
  background: #c47a3a;
  color: white;
  border-color: #c47a3a;
}

.actionButton.primary:hover {
  background: #a86530;
}

.actionButton.danger {
  color: #d32f2f;
  border-color: #d32f2f;
}

.actionButton.danger:hover {
  background: #ffebee;
}

.emptyState {
  text-align: center;
  padding: 48px;
  color: #999;
}
```

- [ ] **Step 2: 创建 WorkflowHub 组件**

```tsx
// frontend/src/components/Workflow/WorkflowHub.tsx
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { workflowApi } from '../../services/api';
import { useWorkflowStream } from '../../hooks/useWorkflowStream';
import type { WorkflowRun, WorkflowStatus, WorkflowStageName } from '../../types';
import styles from './WorkflowHub.module.css';

interface WorkflowHubProps {
  projectId: string;
  onViewRun?: (runId: string) => void;
  onViewReview?: (runId: string) => void;
}

const STAGES: WorkflowStageName[] = ['gen_script', 'script_review', 'split_segment', 'synthesis'];

export function WorkflowHub({ projectId, onViewRun, onViewReview }: WorkflowHubProps) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const data = await workflowApi.list(projectId);
      setRuns(data);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // 订阅活跃工作流的 SSE
  useWorkflowStream(projectId, activeRunId, {
    onStageComplete: () => fetchRuns(),
    onComplete: () => { fetchRuns(); setActiveRunId(null); },
    onError: () => fetchRuns(),
    onInterrupt: () => fetchRuns(),
  });

  const handleStart = async () => {
    try {
      const run = await workflowApi.start(projectId);
      setActiveRunId(run.id);
      await fetchRuns();
    } catch (err: any) {
      if (err.response?.status === 409) {
        alert(t('workflow.hub.activeWorkflowExists'));
      }
    }
  };

  const handleCancel = async (runId: string) => {
    if (!confirm(t('workflow.hub.confirmCancel'))) return;
    await workflowApi.cancel(projectId, runId);
    await fetchRuns();
  };

  const hasActive = runs.some(r => r.status === 'running' || r.status === 'interrupted');

  const statusClass = (status: WorkflowStatus) => {
    switch (status) {
      case 'running': return styles.statusRunning;
      case 'interrupted': return styles.statusInterrupted;
      case 'completed': return styles.statusCompleted;
      case 'failed': return styles.statusFailed;
      case 'cancelled': return styles.statusCancelled;
    }
  };

  const stageClass = (run: WorkflowRun, stage: WorkflowStageName) => {
    const s = run.stages.find(s => s.name === stage);
    if (!s) return '';
    switch (s.status) {
      case 'completed': return styles.stageChipCompleted;
      case 'running': return styles.stageChipRunning;
      case 'failed': return styles.stageChipFailed;
      default: return '';
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className={styles.workflowHub}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t('workflow.hub.title')}</h2>
        <button
          className={styles.newRunButton}
          onClick={handleStart}
          disabled={hasActive}
        >
          ▶ {t('workflow.common.newRun')}
        </button>
      </div>

      {runs.length === 0 ? (
        <div className={styles.emptyState}>{t('workflow.hub.noRuns')}</div>
      ) : (
        runs.map(run => (
          <div key={run.id} className={styles.runCard}>
            <div className={styles.runHeader}>
              <span className={`${styles.statusBadge} ${statusClass(run.status)}`}>
                ● {t(`workflow.status.${run.status}`)}
                {run.status === 'interrupted' && ` @ ${t(`workflow.stage.${run.current_stage}`)}`}
              </span>
              <span style={{ fontSize: 12, color: '#999' }}>
                {t('workflow.hub.startedAt', { time: new Date(run.created_at).toLocaleString() })}
              </span>
            </div>

            <div className={styles.stagesRow}>
              {STAGES.map(stage => (
                <div
                  key={stage}
                  className={`${styles.stageChip} ${stageClass(run, stage)}`}
                >
                  {t(`workflow.stage.${stage}`)}
                </div>
              ))}
            </div>

            <div className={styles.actions}>
              {run.status === 'interrupted' && (
                <button
                  className={`${styles.actionButton} ${styles.primary}`}
                  onClick={() => onViewReview?.(run.id)}
                >
                  {t('workflow.hub.viewReview')}
                </button>
              )}
              {(run.status === 'completed' || run.status === 'failed') && (
                <button
                  className={styles.actionButton}
                  onClick={() => onViewRun?.(run.id)}
                >
                  {t('workflow.hub.viewDetail')}
                </button>
              )}
              {(run.status === 'running' || run.status === 'interrupted') && (
                <button
                  className={`${styles.actionButton} ${styles.danger}`}
                  onClick={() => handleCancel(run.id)}
                >
                  {t('workflow.common.cancel')}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 3: 验证编译**

Run: `cd frontend && npx tsc --noEmit`

Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Workflow/WorkflowHub.tsx frontend/src/components/Workflow/WorkflowHub.module.css
git commit -m "feat(workflow): add WorkflowHub component"
```

---

### Task 2: 创建 ReviewEditor 组件

**Files:**
- Create: `frontend/src/components/Workflow/ReviewEditor.tsx`
- Create: `frontend/src/components/Workflow/ReviewEditor.module.css`

**Interfaces:**
- Produces: `ReviewEditor` component (props: `projectId: string, runId: string, onBack: () => void`)
- Consumes: `workflowApi.get()`, `workflowApi.resume()`

- [ ] **Step 1: 创建 CSS Module**

```css
/* frontend/src/components/Workflow/ReviewEditor.module.css */
.reviewEditor {
  padding: 24px;
  max-width: 960px;
  margin: 0 auto;
}

.backButton {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: none;
  border: none;
  cursor: pointer;
  color: #666;
  font-size: 14px;
  margin-bottom: 16px;
}

.backButton:hover {
  color: #c47a3a;
}

.title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 24px;
  color: #1a1a1a;
}

.section {
  background: white;
  border: 1px solid #e8e0d8;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 16px;
}

.sectionTitle {
  font-size: 14px;
  font-weight: 600;
  color: #666;
  margin-bottom: 12px;
}

.overallScore {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.scoreStars {
  font-size: 20px;
}

.scoreValue {
  font-size: 24px;
  font-weight: 700;
  color: #c47a3a;
}

.overallComment {
  font-size: 14px;
  color: #666;
}

.dimensionList {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dimension {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.dimensionIcon {
  font-size: 16px;
  min-width: 20px;
  text-align: center;
}

.dimensionContent {
  flex: 1;
}

.dimensionName {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 2px;
}

.dimensionComment {
  font-size: 13px;
  color: #666;
}

.dimensionSuggestion {
  font-size: 13px;
  color: #c47a3a;
  margin-top: 4px;
}

.criticalWarning {
  background: #ffebee;
  border: 1px solid #ef9a9a;
  border-radius: 8px;
  padding: 12px;
  color: #c62828;
  font-size: 14px;
  margin-bottom: 16px;
}

.scriptEditor {
  width: 100%;
  min-height: 300px;
  padding: 16px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
}

.stats {
  display: flex;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid #f0f0f0;
  margin-top: 12px;
  font-size: 12px;
  color: #999;
}

.directorNoteInput {
  width: 100%;
  min-height: 60px;
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  font-family: inherit;
  font-size: 14px;
  resize: vertical;
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
}

.actionButton {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.rejectButton {
  background: white;
  border: 1px solid #d32f2f;
  color: #d32f2f;
}

.rejectButton:hover {
  background: #ffebee;
}

.approveButton {
  background: #c47a3a;
  border: none;
  color: white;
}

.approveButton:hover {
  background: #a86530;
}

.approveEditButton {
  background: white;
  border: 1px solid #c47a3a;
  color: #c47a3a;
}

.approveEditButton:hover {
  background: #fff3e0;
}
```

- [ ] **Step 2: 创建 ReviewEditor 组件**

```tsx
// frontend/src/components/Workflow/ReviewEditor.tsx
import { useState, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { workflowApi } from '../../services/api';
import type { WorkflowRun, WorkflowReviewResult, WorkflowReviewDimension } from '../../types';
import styles from './ReviewEditor.module.css';

interface ReviewEditorProps {
  projectId: string;
  runId: string;
  onBack: () => void;
  onComplete?: () => void;
}

const DIMENSION_ICONS: Record<string, string> = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
};

export function ReviewEditor({ projectId, runId, onBack, onComplete }: ReviewEditorProps) {
  const { t } = useTranslation();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [script, setScript] = useState('');
  const [directorNote, setDirectorNote] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    workflowApi.get(projectId, runId).then(r => {
      setRun(r);
      if (r.interrupt_payload) {
        setScript(r.interrupt_payload.script);
      }
    });
  }, [projectId, runId]);

  if (!run || !run.interrupt_payload) return <div>Loading...</div>;

  const review = run.interrupt_payload.review as WorkflowReviewResult;

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      await workflowApi.resume(projectId, runId, {
        stage: 'script_review',
        action: 'approve',
        edited_script: script !== run.interrupt_payload!.script ? script : undefined,
        comment: directorNote || undefined,
      });
      onComplete?.();
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectFeedback.trim()) return;
    setSubmitting(true);
    try {
      await workflowApi.resume(projectId, runId, {
        stage: 'script_review',
        action: 'reject',
        feedback: rejectFeedback,
      });
      onComplete?.();
    } finally {
      setSubmitting(false);
    }
  };

  const wordCount = script.length;
  const estimatedMinutes = Math.ceil(wordCount / 180);

  return (
    <div className={styles.reviewEditor}>
      <button className={styles.backButton} onClick={onBack}>
        ← {t('workflow.common.back')}
      </button>

      <h2 className={styles.title}>
        {t('workflow.review.title')} — Run #{run.id.slice(0, 8)}
      </h2>

      {/* LLM Review 反馈 */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('workflow.review.llmReview')}</div>

        <div className={styles.overallScore}>
          <span className={styles.scoreStars}>
            {'⭐'.repeat(review.overall_score)}{'☆'.repeat(5 - review.overall_score)}
          </span>
          <span className={styles.scoreValue}>{review.overall_score}/5</span>
          <span className={styles.overallComment}>{review.overall_comment}</span>
        </div>

        {review.has_critical_issue && (
          <div className={styles.criticalWarning}>
            {t('workflow.review.criticalIssueWarning')}
          </div>
        )}

        <div className={styles.dimensionList}>
          {review.dimensions.map((dim: WorkflowReviewDimension) => (
            <div key={dim.name} className={styles.dimension}>
              <span className={styles.dimensionIcon}>{DIMENSION_ICONS[dim.status]}</span>
              <div className={styles.dimensionContent}>
                <div className={styles.dimensionName}>{dim.name}</div>
                <div className={styles.dimensionComment}>{dim.comment}</div>
                {dim.suggestion && (
                  <div className={styles.dimensionSuggestion}>
                    → {dim.suggestion}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 旁白脚本编辑器 */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('workflow.review.scriptEditor')}</div>
        <textarea
          className={styles.scriptEditor}
          value={script}
          onChange={e => setScript(e.target.value)}
        />
        <div className={styles.stats}>
          <span>{t('workflow.review.wordCount')}: {wordCount}</span>
          <span>{t('workflow.review.estimatedDuration')}: {estimatedMinutes}min</span>
        </div>
      </div>

      {/* 导演备注 */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('workflow.review.directorNote')}</div>
        <textarea
          className={styles.directorNoteInput}
          value={directorNote}
          onChange={e => setDirectorNote(e.target.value)}
          placeholder={t('workflow.review.directorNotePlaceholder')}
        />
      </div>

      {/* 拒绝反馈输入 */}
      {showRejectInput && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('workflow.review.rejectFeedbackTitle')}</div>
          <textarea
            className={styles.directorNoteInput}
            value={rejectFeedback}
            onChange={e => setRejectFeedback(e.target.value)}
            placeholder={t('workflow.review.rejectFeedbackPlaceholder')}
          />
        </div>
      )}

      {/* 操作按钮 */}
      <div className={styles.actions}>
        {showRejectInput ? (
          <>
            <button
              className={`${styles.actionButton} ${styles.rejectButton}`}
              onClick={handleReject}
              disabled={submitting || !rejectFeedback.trim()}
            >
              {t('workflow.review.reject')}
            </button>
            <button
              className={styles.actionButton}
              onClick={() => setShowRejectInput(false)}
            >
              {t('workflow.common.cancel')}
            </button>
          </>
        ) : (
          <>
            <button
              className={`${styles.actionButton} ${styles.rejectButton}`}
              onClick={() => setShowRejectInput(true)}
            >
              ❌ {t('workflow.review.reject')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.approveButton}`}
              onClick={handleApprove}
              disabled={submitting}
            >
              ✅ {t('workflow.review.approve')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.approveEditButton}`}
              onClick={handleApprove}
              disabled={submitting}
            >
              ✅ {t('workflow.review.approveAndEdit')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证编译**

Run: `cd frontend && npx tsc --noEmit`

Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Workflow/ReviewEditor.tsx frontend/src/components/Workflow/ReviewEditor.module.css
git commit -m "feat(workflow): add ReviewEditor component with structured review display"
```

---

### Task 3: 创建 WorkflowRunDetail 组件

**Files:**
- Create: `frontend/src/components/Workflow/WorkflowRunDetail.tsx`
- Create: `frontend/src/components/Workflow/WorkflowRunDetail.module.css`

**Interfaces:**
- Produces: `WorkflowRunDetail` component (props: `projectId: string, runId: string, onBack: () => void`)
- Consumes: `workflowApi.get()`, `workflowApi.replay()`, `workflowApi.fork()`

- [ ] **Step 1: 创建 CSS Module**

```css
/* frontend/src/components/Workflow/WorkflowRunDetail.module.css */
.runDetail {
  padding: 24px;
  max-width: 960px;
  margin: 0 auto;
}

.backButton {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: none;
  border: none;
  cursor: pointer;
  color: #666;
  font-size: 14px;
  margin-bottom: 16px;
}

.backButton:hover {
  color: #c47a3a;
}

.header {
  margin-bottom: 24px;
}

.title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 8px;
}

.meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: #999;
}

.stageCard {
  background: white;
  border: 1px solid #e8e0d8;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 12px;
}

.stageHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.stageName {
  font-size: 16px;
  font-weight: 600;
}

.stageDuration {
  font-size: 12px;
  color: #999;
}

.stageOutput {
  font-size: 13px;
  color: #666;
  margin-bottom: 12px;
}

.stageActions {
  display: flex;
  gap: 8px;
}

.actionButton {
  padding: 6px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.actionButton:hover {
  background: #f5f5f5;
  border-color: #c47a3a;
}

.statusIcon {
  font-size: 14px;
  margin-right: 8px;
}
```

- [ ] **Step 2: 创建 WorkflowRunDetail 组件**

```tsx
// frontend/src/components/Workflow/WorkflowRunDetail.tsx
import { useState, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { workflowApi } from '../../services/api';
import type { WorkflowRun, WorkflowStageName } from '../../types';
import styles from './WorkflowRunDetail.module.css';

interface WorkflowRunDetailProps {
  projectId: string;
  runId: string;
  onBack: () => void;
}

const STATUS_ICONS: Record<string, string> = {
  completed: '✅',
  running: '🔄',
  failed: '❌',
  interrupted: '⏸️',
  pending: '⏳',
};

export function WorkflowRunDetail({ projectId, runId, onBack }: WorkflowRunDetailProps) {
  const { t } = useTranslation();
  const [run, setRun] = useState<WorkflowRun | null>(null);

  useEffect(() => {
    workflowApi.get(projectId, runId).then(setRun);
  }, [projectId, runId]);

  if (!run) return <div>Loading...</div>;

  const handleReplay = async (stage: WorkflowStageName) => {
    if (!confirm(t('workflow.detail.confirmReplay', { stage: t(`workflow.stage.${stage}`) }))) return;
    await workflowApi.replay(projectId, runId, { from_stage: stage });
    // 刷新
    workflowApi.get(projectId, runId).then(setRun);
  };

  const totalDuration = run.stages.reduce((sum, s) => sum + (s.duration_sec || 0), 0);

  return (
    <div className={styles.runDetail}>
      <button className={styles.backButton} onClick={onBack}>
        ← {t('workflow.common.back')}
      </button>

      <div className={styles.header}>
        <h2 className={styles.title}>
          {t('workflow.detail.runId', { id: run.id.slice(0, 8) })} — {t(`workflow.status.${run.status}`)}
        </h2>
        <div className={styles.meta}>
          <span>{t('workflow.detail.startedAt')}: {new Date(run.created_at).toLocaleString()}</span>
          <span>{t('workflow.detail.totalDuration')}: {Math.round(totalDuration)}s</span>
        </div>
      </div>

      {run.stages.map(stage => (
        <div key={stage.name} className={styles.stageCard}>
          <div className={styles.stageHeader}>
            <span className={styles.stageName}>
              <span className={styles.statusIcon}>{STATUS_ICONS[stage.status]}</span>
              {t(`workflow.stage.${stage.name}`)}
            </span>
            {stage.duration_sec != null && (
              <span className={styles.stageDuration}>{Math.round(stage.duration_sec)}s</span>
            )}
          </div>

          <div className={styles.stageOutput}>
            {stage.status === 'completed' && stage.name === 'gen_script' && (
              <span>{t('workflow.detail.outputSummary')}: ...</span>
            )}
            {stage.status === 'completed' && stage.name === 'script_review' && run.interrupt_payload && (
              <span>
                {t('workflow.detail.reviewScore')}: ⭐{(run.interrupt_payload.review as any)?.overall_score}/5
              </span>
            )}
          </div>

          <div className={styles.stageActions}>
            {(stage.status === 'completed' || stage.status === 'failed') && (
              <>
                <button
                  className={styles.actionButton}
                  onClick={() => handleReplay(stage.name)}
                >
                  🔄 {t('workflow.detail.replayFromHere')}
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 验证编译**

Run: `cd frontend && npx tsc --noEmit`

Expected: 无类型错误

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Workflow/WorkflowRunDetail.tsx frontend/src/components/Workflow/WorkflowRunDetail.module.css
git commit -m "feat(workflow): add WorkflowRunDetail component with stage cards"
```

---

### Task 4: 集成到 ProjectShell 导航

**Files:**
- Modify: `frontend/src/App.tsx` 或相关导航文件
- Create: `frontend/src/components/Workflow/WorkflowPage.tsx` (容器组件)

- [ ] **Step 1: 创建 WorkflowPage 容器**

```tsx
// frontend/src/components/Workflow/WorkflowPage.tsx
import { useState } from 'react';
import { WorkflowHub } from './WorkflowHub';
import { ReviewEditor } from './ReviewEditor';
import { WorkflowRunDetail } from './WorkflowRunDetail';

interface WorkflowPageProps {
  projectId: string;
}

type WorkflowView = 'hub' | { type: 'review'; runId: string } | { type: 'detail'; runId: string };

export function WorkflowPage({ projectId }: WorkflowPageProps) {
  const [view, setView] = useState<WorkflowView>('hub');

  if (view === 'hub') {
    return (
      <WorkflowHub
        projectId={projectId}
        onViewRun={runId => setView({ type: 'detail', runId })}
        onViewReview={runId => setView({ type: 'review', runId })}
      />
    );
  }

  if (view.type === 'review') {
    return (
      <ReviewEditor
        projectId={projectId}
        runId={view.runId}
        onBack={() => setView('hub')}
        onComplete={() => setView('hub')}
      />
    );
  }

  return (
    <WorkflowRunDetail
      projectId={projectId}
      runId={view.runId}
      onBack={() => setView('hub')}
    />
  );
}
```

- [ ] **Step 2: 添加 Workflow 到 ProjectShell 导航**

在 `frontend/src/i18n/index.tsx` 的 `projectNavItems` 中添加：

```typescript
export const projectNavItems: NavItem[] = [
  { id: 'overview', labelKey: 'projectNav.overview', path: 'overview' },
  { id: 'library', labelKey: 'projectNav.library', path: 'library' },
  { id: 'studio', labelKey: 'projectNav.studio', path: 'studio' },
  { id: 'voices', labelKey: 'projectNav.voices', path: 'voices' },
  { id: 'workflow', labelKey: 'workflow.common.title', path: 'workflow' },  // 新增
  { id: 'settings', labelKey: 'projectNav.settings', path: 'settings' },
];
```

- [ ] **Step 3: 在 ProjectShell 中渲染 WorkflowPage**

在 `ProjectShell` 组件中，当 `activeSection === 'workflow'` 时渲染 `WorkflowPage`。

- [ ] **Step 4: 验证编译**

Run: `cd frontend && npx tsc --noEmit`

Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Workflow/WorkflowPage.tsx frontend/src/i18n/index.tsx
git commit -m "feat(workflow): integrate WorkflowPage into ProjectShell navigation"
```
