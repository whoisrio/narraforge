/**
 * Settings - Remotion scaffold root global setting E2E.
 *
 * Verifies the full stack: UI input -> backend PUT (validation + persist) ->
 * API GET + DB dual-read -> UI 回显 after reload -> 测试路径 button.
 *
 * @feature docs/superpowers/specs/2026-07-25-remotion-root-global-setting-design.md
 */
import { expect, test } from '@playwright/test';
import { E2E_BACKEND_URL } from '../helpers/ports';
import { collectErrors, setLocaleToZhCN, enterWorkspace } from '../helpers';
import { readDbSystemConfig } from '../helpers/dbReader';
import * as os from 'node:os';
import * as path from 'node:path';

const BACKEND = E2E_BACKEND_URL;

/** Scope to the AnimationRootSetting <section> on the /settings page. */
function animRootSection(page: import('@playwright/test').Page) {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Remotion 脚手架根目录/ }) });
}

test.describe('设置 · Remotion 脚手架根目录', () => {
  test('UI 设置路径并持久化（API + DB 双层验证 + 回显 + 测试路径）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    await page.goto('/');
    await enterWorkspace(page);

    // Navigate to the global 设置 (ModelConfig) page.
    await page
      .locator('aside[aria-label="Global navigation"]')
      .getByRole('button', { name: /设置/ })
      .click();

    const section = animRootSection(page);
    await expect(section).toBeVisible({ timeout: 10_000 });

    // ── BEFORE: API reports null (or whatever was there); capture it ──
    const beforeResp = await page.request.get(`${BACKEND}/api/config/animation-root`);
    expect(beforeResp.ok()).toBeTruthy();
    const beforeJson = await beforeResp.json();

    const targetPath = path.join(os.tmpdir(), `narraforge-e2e-anim-root-${Date.now()}`);

    // ── ACTION: fill path + save ──
    const input = section.getByLabel('根目录路径');
    await input.fill(targetPath);
    await section.getByRole('button', { name: '保存' }).click();

    // UI success feedback
    await expect(section.getByText('已保存')).toBeVisible({ timeout: 5_000 });

    // ── DUAL-READ: API layer ──
    const apiResp = await page.request.get(`${BACKEND}/api/config/animation-root`);
    expect(apiResp.ok()).toBeTruthy();
    const apiJson = await apiResp.json();
    expect(apiJson.value).toBe(targetPath);

    // ── DUAL-READ: DB layer (raw system_configs row) ──
    const dbValue = await readDbSystemConfig('animation_root_folder');
    expect(dbValue).toBe(targetPath);

    // Sanity: the value actually changed (not a stale read).
    expect(beforeJson.value).not.toBe(targetPath);

    // ── 回显: reload and confirm the input still shows the saved value ──
    await page.reload();
    await enterWorkspace(page);
    await page
      .locator('aside[aria-label="Global navigation"]')
      .getByRole('button', { name: /设置/ })
      .click();
    await expect(animRootSection(page).getByLabel('根目录路径')).toHaveValue(targetPath, {
      timeout: 10_000,
    });

    // ── 测试路径 button: probes the path without saving ──
    const section2 = animRootSection(page);
    await section2.getByRole('button', { name: '测试路径' }).click();
    await expect(section2.getByText('路径可用')).toBeVisible({ timeout: 5_000 });

    expect(errors).toEqual([]);
  });
});
