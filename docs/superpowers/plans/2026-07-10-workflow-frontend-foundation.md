# Workflow Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立工作流前端基础设施：TypeScript 类型定义、API 客户端、i18n 翻译、SSE 流式订阅 hook。

**Architecture:** 在现有 `types/index.ts` 中添加工作流类型，在 `services/api.ts` 中添加 `workflowApi`，在 i18n 文件中添加翻译 key，创建 `useWorkflowStream` hook 处理 SSE。

**Tech Stack:** TypeScript, React, axios, EventSource/fetch

**Spec:** `docs/superpowers/specs/2026-07-10-narration-workflow-design.md` 第 8、9、13 章

**Depends on:** `2026-07-10-workflow-backend-api.md` (API 端点定义)

## Global Constraints

- 遵循现有 TypeScript 类型定义模式（`types/index.ts`）
- API 客户端使用 `axios`（`services/api.ts` 模式）
- i18n key 遵循 `workflow.{page}.{element}` 命名规范
- CSS Modules 使用 camelCase 命名

---

### Task 1: 添加工作流 TypeScript 类型

**Files:**
- Modify: `frontend/src/types/index.ts`

**Interfaces:**
- Produces: `WorkflowStage`, `WorkflowRun`, `WorkflowInterruptPayload`, `WorkflowReviewDimension`, `WorkflowReviewResult`

- [ ] **Step 1: 添加类型定义**

在 `frontend/src/types/index.ts` 末尾添加：

```typescript
// ── Workflow Types ──

export type WorkflowStatus = 'running' | 'interrupted' | 'completed' | 'failed' | 'cancelled';
export type WorkflowStageName = 'gen_script' | 'script_review' | 'split_segment' | 'synthesis';

export interface WorkflowStage {
  name: WorkflowStageName;
  status: 'pending' | 'running' | 'completed' | 'failed';
  duration_sec: number | null;
}

export interface WorkflowRun {
  id: string;
  project_id: string;
  thread_id: string;
  status: WorkflowStatus;
  current_stage: WorkflowStageName;
  stages: WorkflowStage[];
  interrupt_payload?: WorkflowInterruptPayload;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowInterruptPayload {
  script: string;
  review: WorkflowReviewResult;
  available_actions: ('approve' | 'reject')[];
}

export interface WorkflowReviewDimension {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  comment: string;
  suggestion: string | null;
}

export interface WorkflowReviewResult {
  dimensions: WorkflowReviewDimension[];
  overall_score: number;
  overall_comment: string;
  has_critical_issue: boolean;
}

export interface WorkflowStartRequest {
  source_document?: string;
}

export interface WorkflowResumeRequest {
  stage: WorkflowStageName;
  action: 'approve' | 'reject';
  edited_script?: string;
  comment?: string;
  feedback?: string;
}

export interface WorkflowReplayRequest {
  from_stage: WorkflowStageName;
}

export interface WorkflowForkRequest {
  from_stage: WorkflowStageName;
  state_override: Record<string, unknown>;
}

// SSE 事件类型
export interface WorkflowSSEEvent {
  type: 'stage_start' | 'stage_progress' | 'stage_complete' | 'interrupt' | 'error' | 'workflow_complete';
  data: Record<string, unknown>;
}
```

- [ ] **Step 2: 验证类型编译**

Run: `cd frontend && npx tsc --noEmit`

Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(workflow): add TypeScript types for workflow feature"
```

---

### Task 2: 添加工作流 API 客户端

**Files:**
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Produces: `workflowApi` object with methods: `start()`, `list()`, `get()`, `resume()`, `replay()`, `fork()`, `cancel()`

- [ ] **Step 1: 添加 workflowApi**

在 `frontend/src/services/api.ts` 中添加：

```typescript
import type {
  WorkflowRun,
  WorkflowStartRequest,
  WorkflowResumeRequest,
  WorkflowReplayRequest,
  WorkflowForkRequest,
} from '../types';

export const workflowApi = {
  /** 启动新工作流 */
  start: (projectId: string, data?: WorkflowStartRequest) =>
    api.post<WorkflowRun>(`/projects/${projectId}/workflow`, data).then(r => r.data),

  /** 获取项目工作流列表 */
  list: (projectId: string) =>
    api.get<WorkflowRun[]>(`/projects/${projectId}/workflow`).then(r => r.data),

  /** 获取单个工作流详情 */
  get: (projectId: string, runId: string) =>
    api.get<WorkflowRun>(`/projects/${projectId}/workflow/${runId}`).then(r => r.data),

  /** 审批恢复 */
  resume: (projectId: string, runId: string, data: WorkflowResumeRequest) =>
    api.post<WorkflowRun>(`/projects/${projectId}/workflow/${runId}/resume`, data).then(r => r.data),

  /** 从指定阶段重放 */
  replay: (projectId: string, runId: string, data: WorkflowReplayRequest) =>
    api.post<WorkflowRun>(`/projects/${projectId}/workflow/${runId}/replay`, data).then(r => r.data),

  /** 从指定阶段分支 */
  fork: (projectId: string, runId: string, data: WorkflowForkRequest) =>
    api.post<WorkflowRun>(`/projects/${projectId}/workflow/${runId}/fork`, data).then(r => r.data),

  /** 取消工作流 */
  cancel: (projectId: string, runId: string) =>
    api.delete<WorkflowRun>(`/projects/${projectId}/workflow/${runId}`).then(r => r.data),
};
```

- [ ] **Step 2: 验证编译**

Run: `cd frontend && npx tsc --noEmit`

Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat(workflow): add workflow API client"
```

---

### Task 3: 添加 i18n 翻译

**Files:**
- Modify: `frontend/src/i18n/zh-CN.ts`
- Modify: `frontend/src/i18n/en-US.ts`

- [ ] **Step 1: 添加 zh-CN 翻译**

在 `frontend/src/i18n/zh-CN.ts` 的 `zhCN` 对象中添加 `workflow` 字段：

```typescript
export const zhCN = {
  // ... existing keys ...
  workflow: {
    common: {
      title: '工作流',
      newRun: '新建运行',
      cancel: '取消',
      confirm: '确认',
      back: '返回',
    },
    stage: {
      gen_script: '生成脚本',
      script_review: '脚本审查',
      split_segment: '段落拆分',
      synthesis: '语音合成',
    },
    status: {
      running: '运行中',
      interrupted: '等待审批',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
    },
    hub: {
      title: '工作流',
      noRuns: '暂无工作流记录',
      startedAt: '启动于 {time}',
      duration: '耗时 {duration}',
      viewReview: '查看审批',
      viewDetail: '查看详情',
      replayFrom: '从 {stage} 重放',
      forkFrom: '从 {stage} 分支编辑',
      startNewRun: '全新运行',
      exportAudio: '导出音频',
      confirmCancel: '确认取消此工作流？',
      activeWorkflowExists: '项目已有运行中的工作流',
    },
    review: {
      title: '脚本审批',
      llmReview: 'LLM Review 反馈',
      overallScore: '总评',
      scriptEditor: '旁白脚本（可编辑）',
      wordCount: '字数',
      estimatedDuration: '预估时长',
      chapterCount: '章节',
      segmentCount: '段落',
      directorNote: '导演备注（可选，存入记忆供下次参考）',
      directorNotePlaceholder: '输入导演备注...',
      reject: '拒绝并反馈',
      approve: '批准',
      approveAndEdit: '批准并编辑',
      rejectFeedbackTitle: '请输入拒绝原因',
      rejectFeedbackPlaceholder: '描述需要改进的地方...',
      rejectFeedbackRequired: '拒绝时必须填写反馈原因',
      dimension: {
        contentFidelity: '内容忠实度',
        colloquialism: '口语化与可讲度',
        structure: '结构清晰度与节奏',
        terminology: '术语与比喻的恰当性',
        attraction: '吸引力',
        duration: '时长',
      },
      dimensionStatus: {
        pass: '通过',
        warn: '建议改进',
        fail: '必须修改',
      },
      criticalIssueWarning: '⚠️ 内容忠实度存在严重问题，请务必修正后再通过',
    },
    detail: {
      title: '工作流详情',
      runId: 'Run #{id}',
      project: '项目',
      startedAt: '启动',
      totalDuration: '总耗时',
      outputSummary: '输出摘要',
      viewOutput: '查看输出',
      replayFromHere: '从这里重放',
      forkFromHere: '从这里分支编辑',
      reviewResult: '审批结果',
      reviewScore: 'LLM 评分',
      reviewDimensions: '维度',
      directorNote: '导演备注',
      segments: '个段落',
      emotionDistribution: '情绪分布',
      roleDistribution: '角色',
      audioFiles: '个音频',
      totalAudioDuration: '总时长',
      engine: '引擎',
      playAll: '播放全部',
      confirmReplay: '确认从 {stage} 重放？将覆盖后续阶段的输出',
      confirmFork: '确认从 {stage} 分支编辑？',
    },
    action: {
      replay: '重放',
      fork: '分支编辑',
      startNewRun: '全新运行',
      exportAudio: '导出音频',
    },
  },
};
```

- [ ] **Step 2: 添加 en-US 翻译**

在 `frontend/src/i18n/en-US.ts` 的 `enUS` 对象中添加对应的英文翻译（结构相同）。

- [ ] **Step 3: 更新 Messages 类型**

确保 `zh-CN.ts` 导出的 `Messages` 类型包含 `workflow` 字段，`en-US.ts` 的 `enUS` 匹配。

- [ ] **Step 4: 验证类型匹配**

Run: `cd frontend && npx tsc --noEmit`

Expected: 无类型错误

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/zh-CN.ts frontend/src/i18n/en-US.ts
git commit -m "feat(workflow): add i18n translations for workflow feature"
```

---

### Task 4: 创建 SSE 流式订阅 Hook

**Files:**
- Create: `frontend/src/hooks/useWorkflowStream.ts`

**Interfaces:**
- Produces: `useWorkflowStream(projectId, runId, callbacks)` hook
- Produces: `parseSSE(text)` utility

- [ ] **Step 1: 创建 useWorkflowStream hook**

```typescript
// frontend/src/hooks/useWorkflowStream.ts
import { useEffect, useRef } from 'react';
import type { WorkflowSSEEvent } from '../types';

interface WorkflowCallbacks {
  onStageStart?: (stage: string) => void;
  onProgress?: (stage: string, chunk: unknown) => void;
  onStageComplete?: (stage: string, output: unknown) => void;
  onInterrupt?: (payload: unknown) => void;
  onError?: (stage: string, error: string) => void;
  onComplete?: (runId: string, results: unknown) => void;
}

/**
 * 解析 SSE 文本为事件数组
 */
export function parseSSE(text: string): WorkflowSSEEvent[] {
  const events: WorkflowSSEEvent[] = [];
  const lines = text.split('\n');

  let currentEvent = '';
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      const data = line.slice(6);
      try {
        events.push({
          type: currentEvent as WorkflowSSEEvent['type'],
          data: JSON.parse(data),
        });
      } catch {
        // 忽略解析错误
      }
    }
  }

  return events;
}

/**
 * 订阅工作流 SSE 流
 */
export function useWorkflowStream(
  projectId: string,
  runId: string | null,
  callbacks: WorkflowCallbacks
) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!runId) return;

    const controller = new AbortController();

    async function subscribe() {
      try {
        const response = await fetch(
          `/api/projects/${projectId}/workflow/${runId}/stream`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          console.error('SSE connection failed:', response.status);
          return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = parseSSE(buffer);
          buffer = '';

          for (const event of events) {
            const cb = callbacksRef.current;
            switch (event.type) {
              case 'stage_start':
                cb.onStageStart?.(event.data.stage as string);
                break;
              case 'stage_progress':
                cb.onProgress?.(event.data.stage as string, event.data.chunk);
                break;
              case 'stage_complete':
                cb.onStageComplete?.(event.data.stage as string, event.data.output);
                break;
              case 'interrupt':
                cb.onInterrupt?.(event.data.payload);
                break;
              case 'error':
                cb.onError?.(event.data.stage as string, event.data.error as string);
                break;
              case 'workflow_complete':
                cb.onComplete?.(event.data.run_id as string, event.data.results);
                break;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('SSE subscription error:', err);
        }
      }
    }

    subscribe();

    return () => controller.abort();
  }, [projectId, runId]);
}
```

- [ ] **Step 2: 验证编译**

Run: `cd frontend && npx tsc --noEmit`

Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useWorkflowStream.ts
git commit -m "feat(workflow): add useWorkflowStream SSE hook"
```
