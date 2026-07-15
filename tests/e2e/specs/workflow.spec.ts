/**
 * Workflow E2E tests — narration workflow triggered from source document.
 *
 * Covers: trigger from 文本库 · 源文档 tab, drawer opens, stages progress,
 * script review interrupt (approve/reject), re-click shows existing drawer,
 * concurrent limit.
 *
 * @feature docs/superpowers/specs/2026-07-13-langgraph-agent-migration-design.md
 */

import { expect, test } from '@playwright/test';
import {
  setLocaleToZhCN,
  openTestProject,
  collectErrors,
} from '../helpers';
import {
  readAgentThread,
  verifyAgentStateWithScreenshot,
} from '../helpers/langgraphAssertions';

test.describe('Workflow trigger from source document', () => {
  test.beforeEach(async ({ page }) => {
    await setLocaleToZhCN(page);
    await openTestProject(page);
    await collectErrors(page);
  });

  async function goToSourceTab(page: import('@playwright/test').Page) {
    await page.click('button:has-text("文本库")');
    await page.click('text=源文档');
  }

  async function clickGenerateNarration(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: '生成旁白' }).click();
  }

  test('source doc tab shows 生成旁白 trigger button', async ({ page }) => {
    await goToSourceTab(page);
    await expect(page.locator('text=从此源文档生成旁白')).toBeVisible();
    await expect(page.getByRole('button', { name: '生成旁白' })).toBeVisible();
  });

  test('clicking 生成旁白 opens workflow drawer', async ({ page }) => {
    await goToSourceTab(page);
    await clickGenerateNarration(page);

    // Drawer should appear with header and timeline
    await expect(page.locator('text=旁白工作流')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=gen_script')).toBeVisible();
  });

  test('gen_script runs and reaches script_review interrupt', async ({ page }) => {
    await goToSourceTab(page);
    await clickGenerateNarration(page);

    // Wait for gen_script to complete and script_review to interrupt
    await expect(page.locator('text=脚本审查')).toBeVisible({ timeout: 120000 });
    // Review panel should show with score and approve button
    await expect(page.locator('text=批准')).toBeVisible({ timeout: 60000 });
    await expect(page.getByRole('button', { name: '批准' })).toBeVisible();
  });

  test('approve runs split_segment and synthesis', async ({ page }) => {
    await goToSourceTab(page);
    await clickGenerateNarration(page);

    // Wait for interrupt
    await expect(page.getByRole('button', { name: '批准' })).toBeVisible({ timeout: 120000 });
    await page.getByRole('button', { name: '批准' }).click();

    // Should advance through split_segment and synthesis
    await expect(page.locator('text=content_cut').first()).toBeVisible({ timeout: 60000 });
    await expect(page.locator('text=mic').first()).toBeVisible({ timeout: 120000 });
  });

  test('reject loops back to gen_script', async ({ page }) => {
    await goToSourceTab(page);
    await clickGenerateNarration(page);

    // Wait for interrupt
    await expect(page.getByRole('button', { name: '批准' })).toBeVisible({ timeout: 120000 });
    await page.getByRole('button', { name: '拒绝' }).click();

    // Fill feedback and confirm
    await page.fill('textarea[placeholder="描述需要改进的地方..."]', 'fix the intro');
    await page.getByRole('button', { name: '确认拒绝' }).click();

    // Should loop back to gen_script
    await expect(page.locator('text=生成脚本').first()).toBeVisible({ timeout: 60000 });
    // Should reach review again
    await expect(page.getByRole('button', { name: '批准' })).toBeVisible({ timeout: 120000 });
  });

  test('re-click shows existing drawer when workflow is running', async ({ page }) => {
    await goToSourceTab(page);
    await clickGenerateNarration(page);

    // Wait for drawer to appear
    await expect(page.locator('text=旁白工作流')).toBeVisible({ timeout: 15000 });

    // Close the drawer
    await page.locator('button:has(.material-symbols-outlined)').last().click();

    // Click 生成旁白 again - should reopen the same drawer
    await clickGenerateNarration(page);
    await expect(page.locator('text=旁白工作流')).toBeVisible({ timeout: 5000 });
  });
});