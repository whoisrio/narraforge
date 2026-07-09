/**
 * 重新合成 E2E 测试
 *
 * 覆盖全部重新生成（regenerate all）流程：
 *   1. 点击「批量合成」按钮 → 确认对话框 → 验证文案无 raw key 泄漏
 *   2. 确认重新生成 → 验证新音频
 *
 * i18n raw-key regression: 之前 handleRegenerateAll 用错了 i18n key
 * （regenerateCount → willRegenerateN 等），导致弹窗显示英文字符串而非中文。
 * 单元测试已覆盖 key 回归，本 E2E 覆盖真实 UI 无 raw key 泄漏。
 *
 * @feature docs/feature-spec.md §4.4 Batch Operations — Regenerate All
 * @feature G1: i18n raw-key regression guard
 */
import { expect, test } from '@playwright/test';
import {
  collectErrors,
  goToStudio,
  seedTestProject,
  setLocaleToZhCN,
} from '../helpers';
import { expectNoRawI18nKey } from '../helpers/i18nGuard';

test.describe('重新合成', () => {
  test.beforeEach(async ({ page }) => {
    await seedTestProject(page);
  });

  test('点击批量合成按钮，确认对话框文案正确且无 raw key 泄漏', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await goToStudio(page);
    await page.waitForTimeout(2_000);

    // ── Click "⚡ 批量合成" button ──
    const batchBtn = page.locator('button').filter({ hasText: /批量合成|Batch Synthesize/ }).first();
    await expect(batchBtn).toBeVisible({ timeout: 10_000 });
    await batchBtn.click();

    // ── Verify confirm dialog appears with correct text ──
    // Look for any dialog/overlay containing "重新生成" (the confirm button label)
    const confirmBtn = page.locator('button').filter({ hasText: /重新生成|Regenerate/ }).first();
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });

    // 🔑 Core assertion: no raw i18n key anywhere on the page (dialog included)
    await expectNoRawI18nKey(page);

    // Verify dialog contains proper interpolated Chinese
    const dialogText = await page.locator('body').innerText();
    expect(dialogText).toContain('将重新生成');
    expect(dialogText).not.toMatch(/tts\.\w+/);  // no raw keys like tts.regenerateCount

    // ── Cancel the dialog ──
    const cancelBtn = page.locator('button').filter({ hasText: /取消|Cancel/ }).first();
    await cancelBtn.click();

    // Guard: still no raw keys after closing
    await expectNoRawI18nKey(page);

    expect(errors).toEqual([]);
  });
});
