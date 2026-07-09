/**
 * Dialogue prosody E2E test
 *
 * @feature docs/feature-spec.md §4.6 Voices — Role Management — create cast role
 * @feature docs/feature-spec.md §4.4 Segment Kind — dialogue segments
 * @feature docs/feature-spec.md §4.4 Emotion System — emotion types per segment
 */
import { expect, test } from '@playwright/test';
import {
  goToRolePage,
  goToStudio,
  readBackendProject,
  interceptPostResponse,
  setLocaleToZhCN,
  validateChapter,
  validateSegment,
} from '../helpers';
import { verifyDbWithScreenshot } from '../helpers/dualReadSnapshot';

// @feature §4.6 Voices — Role Management — create role, assign to dialogue segment
// @feature §4.4 Segment Kind — dialogue view with role assignment
test('创建角色并打开对话视图', async ({ page }) => {
  await setLocaleToZhCN(page);
  const roleName = `林夏-${Date.now()}`;

  // ── Step 1: Open project role page and launch role library dialog ──
  await goToRolePage(page);
  await page.getByRole('button', { name: /角色库/ }).click();
  await expect(page.getByRole('dialog', { name: /全局角色库/ })).toBeVisible();

  // ── Step 2: Intercept role creation and save the role ──
  const createRolePromise = interceptPostResponse(page, '/api/roles');

  await page.getByLabel(/角色名/).fill(roleName);
  await page.getByLabel(/默认音色/).fill('zh-CN-XiaoxiaoNeural');
  await page.locator('label', { hasText: /Edge voice/ }).locator('input').fill('zh-CN-XiaoxiaoNeural');
  await page.getByRole('button', { name: /保存角色/ }).click();

  await expect(page.locator('[role="dialog"]').getByText(roleName).first()).toBeVisible();

  // ── Step 3: Data-layer verification: API response contains valid role data ──
  const createResponse = await createRolePromise;
  expect(createResponse.status).toBe(201);
  expect(createResponse.body).toBeTruthy();

  const roleBody = createResponse.body as Record<string, unknown>;
  expect(roleBody.name).toBe(roleName);
  expect(roleBody.voice).toBeTruthy();

  const voice = roleBody.voice as Record<string, unknown>;
  expect(voice.voice).toBe('zh-CN-XiaoxiaoNeural');

  // ── Step 4: Close role library and switch to studio ──
  await page.getByRole('button', { name: /关闭/ }).click();
  await goToStudio(page);

  // ── Step 5: Switch to dialogue mode ──
  // Expand "配音模式" sidebar section (collapsed by default in compact mode)
  await page.locator('[class*="sidebarSectionHeader"]').filter({ hasText: /配音模式/ }).click();
  // Click "对话" inside sidebar mode switch
  await page.locator('[class*="sidebarModeSwitch"]').getByRole('button', { name: '对话' }).click();

  // ── Step 6: Toggle first segment from narration to dialogue ──
  // In dialogue mode, each segment shows a roleStrip with kind toggle
  const firstRoleStrip = page.locator('[class*="roleStrip"]').first();
  await expect(firstRoleStrip).toBeVisible({ timeout: 10_000 });

  // Initial narration state: badge shows "旁白", toggle says "对话"
  // Click the toggle to switch to dialogue kind
  await firstRoleStrip.getByRole('button', { name: '对话' }).click();

  // After toggle: badge should show "对话", role <select> appears
  await expect(firstRoleStrip.locator('[class*="kindBadge"]')).toHaveText('对话');
  await expect(firstRoleStrip.locator('select')).toBeVisible();

  // ── Step 7: Data-layer verification: project has a dialogue segment ──
  await page.waitForTimeout(1_500);
  const project = await readBackendProject(page, 'test-e2e-project');
  expect(project).toBeTruthy();
  expect(project!.chapters.length).toBeGreaterThan(0);

  const activeChapter = project!.chapters.find(
    (ch) => ch.id === (project!.active_chapter_id ?? project!.chapters[0]?.id),
  );
  expect(activeChapter).toBeTruthy();
  validateChapter(activeChapter!);

  const dialogueSegments = activeChapter!.segments.filter(s => s.segment_kind === 'dialogue');
  expect(dialogueSegments.length).toBeGreaterThan(0, 'Expected at least one dialogue segment');
  for (const seg of activeChapter!.segments) {
    validateSegment(seg);
  }

  await verifyDbWithScreenshot(page, 'test-e2e-project', 'dialogue-prosody-dbProject');

  // ── Step 8: Cleanup — restore first segment to narration kind ──
  // This test sets segment_kind=dialogue + voice.source=role on the
  // first segment.  Later tests (batch-export, voice-lock) expect clean
  // narration segments, so we reset the state here.
  const segToReset = dialogueSegments[0];
  if (segToReset) {
    const activeCh = activeChapter!;
    await page.evaluate(
      async ({ projectId, chapterId, segId }) => {
        await fetch(
          `/api/segmented-projects/${projectId}/chapters/${chapterId}/segments/${segId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segment_kind: 'narration', voice: { source: 'chapter' }, role_id: null }),
          },
        );
      },
      { projectId: project!.id, chapterId: activeCh.id, segId: segToReset.id },
    );
  }
});
