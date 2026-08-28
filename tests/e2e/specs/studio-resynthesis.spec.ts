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
  goToLibrary,
  goToStudio,
  readBackendProject,
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

    // ── Click "⚡ 批量合成" button, then choose "重新合成全部" from the menu ──
    const batchBtn = page.getByRole('button', { name: /批量合成|Batch Synthesize/ });
    await expect(batchBtn).toBeVisible({ timeout: 10_000 });
    await batchBtn.click();
    const regenerateAllItem = page.getByRole('button', { name: /重新合成全部|Regenerate All/ });
    await expect(regenerateAllItem).toBeVisible({ timeout: 15_000 });
    await regenerateAllItem.click();

    // ── Verify confirm dialog appears with correct text ──
    // Look for any dialog/overlay containing "重新生成" (the confirm button label)
    const confirmBtn = page.getByRole('alertdialog').locator('button').filter({ hasText: /重新生成|Regenerate/ }).first();
    await expect(confirmBtn).toBeVisible({ timeout: 15_000 });

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

  test('重新合成全部跑完整流程：无 409 stale_payload 噪音（optimistic-lock 回归）', async ({ page }) => {
    test.setTimeout(120_000);
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await goToStudio(page);
    await page.waitForTimeout(1_000);

    // 批量合成 → 重新合成全部 → 确认（走 doRegenerateAll：CLEAR_SEGMENT_AUDIO + MARK_QUEUED + 逐段合成）
    await page.getByRole('button', { name: /批量合成|Batch Synthesize/ }).click();
    await page.getByRole('button', { name: /重新合成全部|Regenerate All/ }).click();
    const confirmBtn = page.getByRole('alertdialog').locator('button').filter({ hasText: /重新生成|Regenerate/ }).first();
    await expect(confirmBtn).toBeVisible({ timeout: 15_000 });
    await confirmBtn.click();

    // 等完成 toast（3 段 edge_tts 顺序合成）
    await expect(page.getByText('全部生成完成')).toBeVisible({ timeout: 90_000 });

    // 后端 3 段都有真实音频
    await expect.poll(async () => {
      const p = await readBackendProject(page, 'test-e2e-project');
      return p?.chapters.flatMap((c) => c.segments)
        .filter((s) => !!s.audio?.current?.path && s.audio.current.file_exists !== false)
        .length ?? 0;
    }, { timeout: 15_000 }).toBe(3);

    // 核心断言：全程无 409 stale_payload 等 console 错误（旧实现反复弹"检测到项目已在别处更新"）
    expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });

  test('编辑章节标题后立即重新合成全部：不报"检测到项目已在别处更新"（409 恢复循环回归）', async ({ page }) => {
    test.setTimeout(120_000);
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    // 用户场景复现：先在文本库改章节标题（RENAME_CHAPTER → 整包 PUT 防抖中的脏草稿），
    // 不等 PUT 落库立刻跑「重新合成全部」。旧实现：PUT 撞上合成端点推进的服务端版本
    // → 409 → 恢复 LOAD_PROJECT 又触发 markDirty → 再 409，toast 循环。
    await goToLibrary(page);
    await page.getByRole('button', { name: '章节', exact: true }).click();
    await page.getByRole('button', { name: '打开文本' }).first().click();
    const titleInput = page.getByRole('textbox', { name: '章节标题' });
    await expect(titleInput).toBeVisible({ timeout: 10_000 });
    await titleInput.fill('第1章 夜路·改');

    // 立刻切工作室启动批量合成（不等待防抖 PUT）
    await page.getByRole('button', { name: /◉ 工作室/ }).first().click();
    await page.getByRole('button', { name: /批量合成|Batch Synthesize/ }).click();
    await page.getByRole('button', { name: /重新合成全部|Regenerate All/ }).click();
    const confirmBtn = page.getByRole('alertdialog').locator('button').filter({ hasText: /重新生成|Regenerate/ }).first();
    await expect(confirmBtn).toBeVisible({ timeout: 15_000 });
    await confirmBtn.click();

    // 跑完 3 段合成
    await expect(page.getByText('全部生成完成')).toBeVisible({ timeout: 90_000 });

    // 章节标题修改最终落库（入口 flush 保证不丢）
    await expect.poll(async () => {
      const p = await readBackendProject(page, 'test-e2e-project');
      return p?.chapters[0]?.name ?? '';
    }, { timeout: 15_000 }).toBe('第1章 夜路·改');

    // 核心断言：全程无恢复 toast、无 409
    await expect(page.getByText(/检测到项目已在别处更新/)).toHaveCount(0);
    expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });
});
