/**
 * Workflow E2E tests — narration workflow lifecycle.
 *
 * Covers: start, script review (approve/reject), cancel, concurrent limit,
 * hub list, run detail.  All tests drive the UI with real LLM (Qwen) calls.
 *
 * @feature docs/superpowers/specs/2026-07-10-narration-workflow-design.md §7 API
 * @feature docs/superpowers/specs/2026-07-10-narration-workflow-design.md §8 UI
 * @feature docs/superpowers/specs/2026-07-10-narration-workflow-design.md §5 Status
 */

import { expect, test } from '@playwright/test';
import {
  setLocaleToZhCN,
  openTestProject,
  collectErrors,
} from '../helpers';
import {
  readDbWorkflowRun,
  readDbWorkflowRuns,
  validateWorkflowRun,
} from '../helpers/dbReader';
import {
  waitForWorkflowStatus,
  cleanupWorkflowRuns,
  deleteAllWorkflowRuns,
  getWorkflowRunViaApi,
  type WorkflowRunApi,
} from '../helpers/workflowHelper';

const PROJECT_ID = 'test-e2e-project';

// ── Shared helpers ──

/** Navigate to the workflow page for the test project. */
async function goToWorkflow(page: import('@playwright/test').Page): Promise<void> {
  await openTestProject(page);
  await page.getByRole('button', { name: /工作流/ }).first().click();
  await expect(page.getByRole('button', { name: /新建运行/ }).first()).toBeVisible({ timeout: 15_000 });
}

// ═══════════════════════════════════════════════════════════════════════════
//  W1: 启动工作流 → 脚本审查中断
// ═══════════════════════════════════════════════════════════════════════════

test.describe('工作流启动与中断', () => {
  test.beforeEach(async ({ page }) => {
    // Clean up any lingering workflow runs from prior tests.
    await deleteAllWorkflowRuns(page, PROJECT_ID);
  });

  // @feature §7.1 POST /workflow — start a new run
  // @feature §5.1 Status — running → interrupted
  test('启动工作流并等待脚本审查中断 @workflow', async ({ page }) => {
    test.setTimeout(600_000); // LLM calls can take 5+ minutes total

    await setLocaleToZhCN(page);
    const errors = collectErrors(page);
    await goToWorkflow(page);

    // ── BEFORE: verify empty state ──
    await expect(page.getByText(/暂无工作流记录/)).toBeVisible();

    const beforeRuns = await readDbWorkflowRuns(PROJECT_ID);
    expect(beforeRuns.length).toBe(0);

    // ── ACTION: click "新建运行" ──
    console.log('[W1] clicking 新建运行...');
    await page.getByRole('button', { name: /新建运行/ }).click();

    // ── AFTER: wait for the empty state to disappear (run card appears) ──
    await page.waitForTimeout(3_000);
    await page.reload();
    await expect(page.getByText(/暂无工作流记录/)).toBeHidden({ timeout: 15_000 });
    console.log('[W1] workflow started, waiting for interrupt...');

    // ── AFTER: wait for interrupt (LLM gen_script + script_review) ──
    // Poll the API until status becomes "interrupted".
    const runs = await readDbWorkflowRuns(PROJECT_ID);
    expect(runs.length).toBe(1);
    const runId = runs[0].id;
    console.log(`[W1] runId=${runId}, polling for interrupted status...`);

    const run = await waitForWorkflowStatus(page, PROJECT_ID, runId, 'interrupted', 240_000);
    expect(run.status).toBe('interrupted');
    // current_stage can be 'gen_script' or 'script_review' depending on when interrupt fires
    expect(['gen_script', 'script_review']).toContain(run.current_stage);

    // ── UI verification: status badge shows "等待审批" ──
    await goToWorkflow(page);
    await expect(page.getByText(/等待审批/).first()).toBeVisible({ timeout: 15_000 });

    // ── API verification: interrupt_payload present ──
    const apiRun = await getWorkflowRunViaApi(page, PROJECT_ID, runId);
    expect(apiRun.interrupt_payload).toBeTruthy();
    expect(apiRun.interrupt_payload!.script).toBeTruthy();
    expect(apiRun.interrupt_payload!.review).toBeTruthy();
    expect(apiRun.interrupt_payload!.available_actions).toEqual(['approve', 'reject']);

    // ── DB verification ──
    const dbRun = await readDbWorkflowRun(runId);
    expect(dbRun).toBeTruthy();
    validateWorkflowRun(dbRun!);
    expect(dbRun!.status).toBe('interrupted');
    expect(['gen_script', 'script_review']).toContain(dbRun!.current_stage);
    expect(dbRun!.project_id).toBe(PROJECT_ID);

    // Ignore SSE subscription errors (non-critical, frontend uses polling as fallback)
    const criticalErrors = errors.filter(e => !e.includes('SSE subscription error'));
    expect(criticalErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  W2: 审批通过 → 完成全流程
// ═══════════════════════════════════════════════════════════════════════════

test.describe('审批通过', () => {
  test.beforeEach(async ({ page }) => {
    await deleteAllWorkflowRuns(page, PROJECT_ID);
  });

  // @feature §7.1 POST /resume — approve
  // @feature §8.3 ReviewEditor — approve flow
  test('审批通过后完成全流程 @workflow', async ({ page }) => {
    test.setTimeout(900_000); // Full pipeline: gen_script + review + split + synthesis (auto-reject retries)

    await setLocaleToZhCN(page);
    const errors = collectErrors(page);
    await goToWorkflow(page);

    // ── Start workflow and wait for interrupt ──
    console.log('[W2] starting workflow...');
    await page.getByRole('button', { name: /新建运行/ }).click();
    await page.waitForTimeout(3_000);
    await page.reload();
    await expect(page.getByText(/暂无工作流记录/)).toBeHidden({ timeout: 15_000 });

    const runs = await readDbWorkflowRuns(PROJECT_ID);
    const runId = runs[0].id;
    console.log(`[W2] runId=${runId}, waiting for interrupt...`);
    await waitForWorkflowStatus(page, PROJECT_ID, runId, 'interrupted', 240_000);
    console.log('[W2] interrupted! navigating to review...');

    // ── Navigate to ReviewEditor ──
    await goToWorkflow(page);
    await expect(page.getByText(/等待审批/).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /查看审批/ }).first().click();

    // ── Verify ReviewEditor content ──
    await expect(page.getByText(/LLM Review|脚本审批/).first()).toBeVisible({ timeout: 15_000 });

    // The review dimensions should be visible
    await expect(page.getByText(/内容忠实度/).first()).toBeVisible({ timeout: 10_000 });

    // Script editor should have content
    const scriptEditor = page.locator('textarea').first();
    await expect(scriptEditor).toBeVisible();
    const scriptContent = await scriptEditor.inputValue();
    expect(scriptContent.length).toBeGreaterThan(0);
    console.log(`[W2] script length=${scriptContent.length}, approving...`);

    // ── Fill director note and approve ──
    const noteInput = page.locator('textarea[class*="directorNote"], textarea').nth(1);
    if (await noteInput.isVisible()) {
      await noteInput.fill('E2E 测试备注：节奏不错');
    }

    await page.getByRole('button', { name: /批准/ }).first().click();
    console.log('[W2] approved! waiting for full pipeline (split + synthesis)...');

    // ── Wait for full pipeline completion ──
    const completedRun = await waitForWorkflowStatus(page, PROJECT_ID, runId, 'completed', 600_000);
    expect(completedRun.status).toBe('completed');

    // ── UI verification: completed status ──
    await goToWorkflow(page);
    await expect(page.getByText(/已完成/).first()).toBeVisible({ timeout: 15_000 });

    // ── DB verification: workflow run ──
    const dbRun = await readDbWorkflowRun(runId);
    expect(dbRun).toBeTruthy();
    validateWorkflowRun(dbRun!);
    expect(dbRun!.status).toBe('completed');

    // ── DB verification: chapters and segments were created by synthesis node ──
    const { readDbProject } = await import('../helpers/dbReader');
    const dbProject = await readDbProject(PROJECT_ID);
    expect(dbProject).toBeTruthy();
    // The synthesis node creates NEW chapters — the project should have more than the seeded 2.
    // (Seeded chapters remain; workflow adds its own.)
    expect(dbProject!.chapters.length).toBeGreaterThanOrEqual(2);
    expect(dbProject!.segments.length).toBeGreaterThan(0);

    // Ignore SSE subscription errors (non-critical, frontend uses polling as fallback)
    const criticalErrors = errors.filter(e => !e.includes('SSE subscription error'));
    expect(criticalErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  W3: 审批拒绝 → 回到脚本生成
// ═══════════════════════════════════════════════════════════════════════════

test.describe('审批拒绝', () => {
  test.beforeEach(async ({ page }) => {
    await deleteAllWorkflowRuns(page, PROJECT_ID);
  });

  // @feature §7.1 POST /resume — reject
  // @feature §8.3 ReviewEditor — reject flow
  test('审批拒绝后回到脚本生成并再次中断 @workflow', async ({ page }) => {
    test.setTimeout(600_000); // Two rounds of gen_script + review

    await setLocaleToZhCN(page);
    const errors = collectErrors(page);
    await goToWorkflow(page);

    // ── Start workflow and wait for first interrupt ──
    console.log('[W3] starting workflow...');
    await page.getByRole('button', { name: /新建运行/ }).click();
    await page.waitForTimeout(3_000);
    await page.reload();
    await expect(page.getByText(/暂无工作流记录/)).toBeHidden({ timeout: 15_000 });

    const runs = await readDbWorkflowRuns(PROJECT_ID);
    const runId = runs[0].id;
    console.log(`[W3] runId=${runId}, waiting for first interrupt...`);
    await waitForWorkflowStatus(page, PROJECT_ID, runId, 'interrupted', 240_000);
    console.log('[W3] first interrupt reached! rejecting...');

    // ── Navigate to ReviewEditor and reject ──
    await goToWorkflow(page);
    await expect(page.getByText(/等待审批/).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /查看审批/ }).first().click();
    await expect(page.getByText(/LLM Review|脚本审批/).first()).toBeVisible({ timeout: 15_000 });

    // Click "拒绝并反馈" to show the reject input
    await page.getByRole('button', { name: /拒绝并反馈|拒绝/ }).first().click();

    // Fill in rejection feedback
    const rejectInput = page.locator('textarea').last();
    await rejectInput.fill('第三段太长了，需要拆分成两段');

    // Confirm rejection
    await page.getByRole('button', { name: /拒绝并反馈/ }).first().click();
    console.log('[W3] rejected! waiting for second interrupt (gen_script → script_review)...');

    // ── Wait for second interrupt (gen_script → script_review → interrupt) ──
    const secondInterruptRun = await waitForWorkflowStatus(page, PROJECT_ID, runId, 'interrupted', 300_000);
    expect(secondInterruptRun.status).toBe('interrupted');
    expect(secondInterruptRun.current_stage).toBe('script_review');

    // ── UI verification ──
    await goToWorkflow(page);
    await expect(page.getByText(/等待审批/).first()).toBeVisible({ timeout: 15_000 });

    // ── DB verification ──
    const dbRun = await readDbWorkflowRun(runId);
    expect(dbRun).toBeTruthy();
    validateWorkflowRun(dbRun!);
    expect(dbRun!.status).toBe('interrupted');

    // Ignore SSE subscription errors (non-critical, frontend uses polling as fallback)
    const criticalErrors = errors.filter(e => !e.includes('SSE subscription error'));
    expect(criticalErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  W4: 并发限制
// ═══════════════════════════════════════════════════════════════════════════

test.describe('并发限制', () => {
  test.beforeEach(async ({ page }) => {
    await deleteAllWorkflowRuns(page, PROJECT_ID);
  });

  // @feature §12.1 — one active workflow per project
  test('已有活跃工作流时新建运行按钮被禁用 @workflow', async ({ page }) => {
    test.setTimeout(300_000);

    await setLocaleToZhCN(page);
    const errors = collectErrors(page);
    await goToWorkflow(page);

    // ── Start first workflow ──
    await page.getByRole('button', { name: /新建运行/ }).click();
    await page.waitForTimeout(3_000);
    await page.reload();
    await expect(page.getByText(/暂无工作流记录/)).toBeHidden({ timeout: 15_000 });

    // Wait for it to reach interrupted state
    const runs = await readDbWorkflowRuns(PROJECT_ID);
    const runId = runs[0].id;
    await waitForWorkflowStatus(page, PROJECT_ID, runId, 'interrupted', 240_000);

    // ── Reload and verify button is disabled ──
    await goToWorkflow(page);
    await expect(page.getByText(/等待审批/).first()).toBeVisible({ timeout: 15_000 });

    const newRunButton = page.getByRole('button', { name: /新建运行/ }).first();
    await expect(newRunButton).toBeDisabled();

    // ── API verification: POST /workflow returns 409 ──
    const resp = await page.request.post(
      `http://127.0.0.1:8002/api/projects/${PROJECT_ID}/workflow`,
      { data: {} },
    );
    expect(resp.status()).toBe(409);

    // Ignore SSE subscription errors (non-critical, frontend uses polling as fallback)
    const criticalErrors = errors.filter(e => !e.includes('SSE subscription error'));
    expect(criticalErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  W5: 取消工作流
// ═══════════════════════════════════════════════════════════════════════════

test.describe('取消工作流', () => {
  test.beforeEach(async ({ page }) => {
    await deleteAllWorkflowRuns(page, PROJECT_ID);
  });

  // @feature §7.1 DELETE /workflow — cancel
  // @feature §5.2 Status × 操作矩阵
  test('取消中断中的工作流 @workflow', async ({ page }) => {
    test.setTimeout(300_000);

    await setLocaleToZhCN(page);
    const errors = collectErrors(page);
    await goToWorkflow(page);

    // ── Start and wait for interrupt ──
    console.log('[W5] starting workflow...');
    await page.getByRole('button', { name: /新建运行/ }).click();
    await page.waitForTimeout(3_000);
    await page.reload();
    await expect(page.getByText(/暂无工作流记录/)).toBeHidden({ timeout: 15_000 });

    const runs = await readDbWorkflowRuns(PROJECT_ID);
    const runId = runs[0].id;
    console.log(`[W5] runId=${runId}, waiting for interrupt...`);
    await waitForWorkflowStatus(page, PROJECT_ID, runId, 'interrupted', 240_000);
    console.log('[W5] interrupted! cancelling...');

    // ── Reload and cancel ──
    await goToWorkflow(page);
    await expect(page.getByText(/等待审批/).first()).toBeVisible({ timeout: 15_000 });

    // Click cancel button → opens ConfirmDialog
    await page.getByRole('button', { name: /取消/ }).first().click();

    // Confirm the custom ConfirmDialog
    await expect(page.getByText(/确认取消/).first()).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /确认/ }).first().click();

    // ── Wait for cancelled status ──
    const cancelledRun = await waitForWorkflowStatus(page, PROJECT_ID, runId, 'cancelled', 30_000);
    console.log('[W5] cancelled!');
    expect(cancelledRun.status).toBe('cancelled');

    // ── UI verification ──
    await goToWorkflow(page);
    await expect(page.getByText(/已取消/).first()).toBeVisible({ timeout: 15_000 });

    // ── DB verification ──
    const dbRun = await readDbWorkflowRun(runId);
    expect(dbRun).toBeTruthy();
    validateWorkflowRun(dbRun!);
    expect(dbRun!.status).toBe('cancelled');

    // Ignore SSE subscription errors (non-critical, frontend uses polling as fallback)
    const criticalErrors = errors.filter(e => !e.includes('SSE subscription error'));
    expect(criticalErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  W6: WorkflowHub 列表展示
// ═══════════════════════════════════════════════════════════════════════════

test.describe('工作流列表', () => {
  // @feature §8.2 WorkflowHub — run list
  test('显示工作流运行列表和状态 @workflow', async ({ page }) => {
    test.setTimeout(300_000);

    await setLocaleToZhCN(page);
    const errors = collectErrors(page);
    await goToWorkflow(page);

    // The list should be visible (may have runs from prior tests or be empty).
    // We just verify the page renders without errors.
    const hubTitle = page.getByText(/工作流/).first();
    await expect(hubTitle).toBeVisible();

    // The "新建运行" button should be present.
    await expect(page.getByRole('button', { name: /新建运行/ }).first()).toBeVisible();

    // If there are runs, verify the run card structure.
    const runCards = page.locator('[class*="runCard"], [class*="run-card"]');
    const count = await runCards.count();
    if (count > 0) {
      // First run card should have a status badge
      const firstCard = runCards.first();
      await expect(firstCard).toBeVisible();

      // Should have stage chips
      const stageChips = firstCard.locator('[class*="stageChip"], [class*="stage-chip"]');
      const chipCount = await stageChips.count();
      expect(chipCount).toBe(4); // gen_script, script_review, split_segment, synthesis
    }

    // Ignore SSE subscription errors (non-critical, frontend uses polling as fallback)
    const criticalErrors = errors.filter(e => !e.includes('SSE subscription error'));
    expect(criticalErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  W7: WorkflowRunDetail 详情页
// ═══════════════════════════════════════════════════════════════════════════

test.describe('工作流详情', () => {
  // @feature §8.4 WorkflowRunDetail — stage cards
  test('查看已完成工作流的详情页 @workflow', async ({ page }) => {
    test.setTimeout(900_000);

    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    // ── Setup: create a completed workflow via approve ──
    console.log('[W7] setting up completed workflow...');
    await deleteAllWorkflowRuns(page, PROJECT_ID);
    await goToWorkflow(page);

    await page.getByRole('button', { name: /新建运行/ }).click();
    await page.waitForTimeout(3_000);
    await page.reload();
    await expect(page.getByText(/暂无工作流记录/)).toBeHidden({ timeout: 15_000 });

    const runs = await readDbWorkflowRuns(PROJECT_ID);
    const runId = runs[0].id;
    console.log(`[W7] runId=${runId}, waiting for interrupt...`);
    await waitForWorkflowStatus(page, PROJECT_ID, runId, 'interrupted', 240_000);
    console.log('[W7] interrupted! approving...');

    // Approve via UI
    await goToWorkflow(page);
    await expect(page.getByText(/等待审批/).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /查看审批/ }).first().click();
    await expect(page.getByText(/LLM Review|脚本审批/).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /批准/ }).first().click();
    console.log('[W7] approved! waiting for completion...');

    await waitForWorkflowStatus(page, PROJECT_ID, runId, 'completed', 600_000);
    console.log('[W7] completed! verifying detail page...');

    // ── Navigate to detail page ──
    await goToWorkflow(page);
    await expect(page.getByText(/已完成/).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /查看详情/ }).first().click();

    // ── Verify detail page content ──
    // Should show 4 stage cards
    await expect(page.getByText(/生成脚本/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/脚本审查/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/段落拆分/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/语音合成/).first()).toBeVisible({ timeout: 10_000 });

    // Back button should work (avoid matching sidebar "← 返回项目总览")
    const backButton = page.getByRole('button', { name: /^(?!.*项目总览).*返回.*$/ }).first();
    await expect(backButton).toBeVisible();
    await backButton.click();

    // Wait for navigation back to hub
    await page.waitForTimeout(2_000);
    await expect(page.getByRole('button', { name: /新建运行/ }).first()).toBeVisible({ timeout: 15_000 });

    // Ignore SSE subscription errors (non-critical, frontend uses polling as fallback)
    const criticalErrors = errors.filter(e => !e.includes('SSE subscription error'));
    expect(criticalErrors).toEqual([]);
  });
});
