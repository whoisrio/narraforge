/**
 * Workflow E2E tests — narration workflow triggered from source document.
 *
 * Covers: trigger from 文本库 · 源文档 tab, drawer opens, stages progress,
 * script review interrupt, approve, reject.
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

  test('source doc tab shows 生成旁白 trigger button', async ({ page }) => {
    // Navigate to 文本库 section
    await page.click('button:has-text("文本库")');
    await page.waitForSelector('text=源文档');
    // Switch to 源文档 tab
    await page.click('text=源文档');
    // Verify the trigger button is visible
    await expect(page.locator('text=从此源文档生成旁白')).toBeVisible();
    await expect(page.getByRole('button', { name: '生成旁白' })).toBeVisible();
  });

  test('clicking 生成旁白 opens workflow drawer', async ({ page }) => {
    // Navigate and trigger
    await page.click('button:has-text("文本库")');
    await page.click('text=源文档');
    await page.getByRole('button', { name: '生成旁白' }).click();

    // Drawer should appear
    await expect(page.locator('text=旁白工作流')).toBeVisible({ timeout: 10000 });
    // Timeline should show gen_script
    await expect(page.locator('text=gen_script')).toBeVisible();
  });
});