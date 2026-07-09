/**
 * Shared navigation helpers for E2E tests.
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { setLocaleToZhCN } from './locale';

/** Click "进入工作台" on the landing page to enter the workspace. */
export async function enterWorkspace(page: Page): Promise<void> {
  // The landing page has two "进入工作台" buttons (hero + bottom CTA).
  // Use .first() to avoid strict mode violation when multiple elements match.
  const cta = page.getByRole('button', { name: /进入工作台/ }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();
  // Wait for workspace to load — the sidebar or project hub should appear
  await expect(page.getByRole('button', { name: /音色设计|项目|字幕识别/ }).first()).toBeVisible({ timeout: 15_000 });
}

/** Navigate from / to the test project's overview page. */
export async function openTestProject(page: Page): Promise<void> {
  await setLocaleToZhCN(page);
  await page.goto('/');
  await enterWorkspace(page);
  // Multiple projects named "test" may exist — use .first() to select the seeded one.
  const openBtn = page.getByRole('button', { name: /打开 test/ }).first();
  await expect(openBtn).toBeVisible({ timeout: 15_000 });
  await openBtn.click();
  await expect(page.getByText('第1章 夜路', { exact: true })).toBeVisible({ timeout: 15_000 });
}

/** Navigate from / to the test project's role management page. */
export async function goToRolePage(page: Page): Promise<void> {
  await openTestProject(page);
  await page.getByRole('button', { name: /◌ 角色/ }).first().click();
  await expect(page.getByRole('heading', { name: /角色管理/ })).toBeVisible({ timeout: 10_000 });
}

/** Navigate from / to the test project's studio page. */
export async function goToStudio(page: Page): Promise<void> {
  await openTestProject(page);
  await page.getByRole('button', { name: /◉ 工作室/ }).first().click();
  // TTSSynthesis uses the static `t` function (English) for some labels.
  await expect(page.getByRole('button', { name: /批量合成|Batch Synthesize/ }).first()).toBeVisible({ timeout: 15_000 });
}

/** Navigate from / to the voice design page. */
export async function goToVoiceDesign(page: Page): Promise<void> {
  await setLocaleToZhCN(page);
  await page.goto('/');
  await enterWorkspace(page);
  await page.getByRole('button', { name: /音色设计/ }).first().click();
  await expect(page.getByRole('heading', { name: /音色设计/ })).toBeVisible({ timeout: 10_000 });
}

/** Navigate from / to the test project's library page. */
export async function goToLibrary(page: Page): Promise<void> {
  await openTestProject(page);
  await page.getByRole('button', { name: /文本库/ }).first().click();
}
