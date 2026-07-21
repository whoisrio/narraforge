/**
 * Workflow-specific E2E test helpers.
 *
 * Provides polling, cleanup, and API-level read helpers for workflow tests.
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8002';

/** WorkflowRun shape returned by the backend API. */
export interface WorkflowRunApi {
  id: string;
  project_id: string;
  thread_id: string;
  status: string;
  current_stage: string;
  stages: Array<{ name: string; status: string; duration_sec: number | null }>;
  interrupt_payload?: Record<string, unknown>;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Poll the workflow API until the run reaches *targetStatus*.
 * Returns the final WorkflowRun object.
 * Throws if the run reaches a terminal status that is NOT the target.
 *
 * Logs progress to console every poll cycle so the user can see what's happening.
 */
export async function waitForWorkflowStatus(
  page: Page,
  projectId: string,
  runId: string,
  targetStatus: string,
  timeoutMs = 180_000,
): Promise<WorkflowRunApi> {
  const pollInterval = 3_000;
  const start = Date.now();
  let lastStatus = '';
  let lastStage = '';
  let pollCount = 0;

  while (Date.now() - start < timeoutMs) {
    const resp = await page.request.get(`${BASE_URL}/api/projects/${projectId}/workflow/${runId}`);
    if (resp.ok()) {
      const run: WorkflowRunApi = await resp.json();
      pollCount++;

      // Log on status/stage change or every 10 polls (~30s)
      if (run.status !== lastStatus || run.current_stage !== lastStage || pollCount % 10 === 0) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(`[workflow] poll #${pollCount} (${elapsed}s): status=${run.status} stage=${run.current_stage} → waiting for ${targetStatus}`);
        lastStatus = run.status;
        lastStage = run.current_stage;
      }

      if (run.status === targetStatus) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(`[workflow] ✅ reached "${targetStatus}" after ${elapsed}s`);
        return run;
      }
      // If the run reached a different terminal status, fail fast.
      if (['completed', 'failed', 'cancelled'].includes(run.status) && run.status !== targetStatus) {
        throw new Error(
          `Workflow run ${runId} reached terminal status "${run.status}" (expected "${targetStatus}"). ` +
          `Error: ${run.error ?? 'none'}`,
        );
      }
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }

  throw new Error(`Workflow run ${runId} did not reach "${targetStatus}" within ${timeoutMs}ms`);
}

/**
 * Cancel all running/interrupted workflow runs for a project.
 * Called in test setup to ensure a clean slate.
 */
export async function cleanupWorkflowRuns(page: Page, projectId: string): Promise<void> {
  const resp = await page.request.get(`${BASE_URL}/api/projects/${projectId}/workflow`);
  if (!resp.ok()) return;

  const runs: WorkflowRunApi[] = await resp.json();
  for (const run of runs) {
    if (run.status === 'running' || run.status === 'interrupted') {
      await page.request.delete(`${BASE_URL}/api/projects/${projectId}/workflow/${run.id}`).catch(() => {});
    }
  }
}

/**
 * Delete all workflow runs for a project (including failed/completed).
 * Used in beforeEach to ensure a completely clean state.
 */
export async function deleteAllWorkflowRuns(page: Page, projectId: string): Promise<void> {
  const resp = await page.request.get(`${BASE_URL}/api/projects/${projectId}/workflow`);
  if (!resp.ok()) return;

  const runs: WorkflowRunApi[] = await resp.json();
  for (const run of runs) {
    await page.request.delete(`${BASE_URL}/api/projects/${projectId}/workflow/${run.id}/delete`).catch(() => {});
  }
}

/**
 * Start a workflow via the backend API and return the created run.
 * Used when a test needs a workflow in a specific state without going through the UI.
 */
export async function startWorkflowViaApi(
  page: Page,
  projectId: string,
  sourceDocument?: string,
): Promise<WorkflowRunApi> {
  const resp = await page.request.post(`${BASE_URL}/api/projects/${projectId}/workflow`, {
    data: sourceDocument ? { source_document: sourceDocument } : {},
  });
  if (!resp.ok()) {
    throw new Error(`Failed to start workflow: ${resp.status()} ${await resp.text()}`);
  }
  return resp.json();
}

/**
 * Resume a workflow via the backend API.
 */
export async function resumeWorkflowViaApi(
  page: Page,
  projectId: string,
  runId: string,
  data: { stage: string; action: string; edited_script?: string; comment?: string; feedback?: string },
): Promise<WorkflowRunApi> {
  const resp = await page.request.post(`${BASE_URL}/api/projects/${projectId}/workflow/${runId}/resume`, { data });
  if (!resp.ok()) {
    throw new Error(`Failed to resume workflow: ${resp.status()} ${await resp.text()}`);
  }
  return resp.json();
}

/**
 * Get a single workflow run via the backend API.
 */
export async function getWorkflowRunViaApi(
  page: Page,
  projectId: string,
  runId: string,
): Promise<WorkflowRunApi> {
  const resp = await page.request.get(`${BASE_URL}/api/projects/${projectId}/workflow/${runId}`);
  if (!resp.ok()) {
    throw new Error(`Failed to get workflow run: ${resp.status()} ${await resp.text()}`);
  }
  return resp.json();
}
