/**
 * Try 页（/try 获客页）E2E
 *
 * 覆盖：SEO 静态内容渲染、字数上限、完整合成链路（真实 edge_tts）、
 * 历史记录（重复下载/单条删除/一键清空）、「试用完整功能」内容接力。
 *
 * @feature docs/superpowers/specs/2026-08-20-try-page-seo-acquisition-design.md
 */
import { expect, test } from '@playwright/test';
import { enterWorkspace, setLocaleToZhCN } from '../helpers';

const SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog.';

test.describe('Try 页', () => {
  // @feature SEO — 静态内容不依赖 JS 即可见
  test('页面渲染：SEO 静态内容与合成工具', async ({ page }) => {
    await page.goto('/try.html');

    // 静态 SEO 内容
    await expect(page.getByRole('heading', { name: 'Turn any document into natural speech' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible();

    // 工具区挂载
    await expect(page.getByRole('textbox')).toBeVisible();
    await expect(page.getByTestId('char-count')).toHaveText(/0 \/ 3,000/);
    await expect(page.getByRole('button', { name: 'Generate speech' })).toBeDisabled();
    // 声音列表加载（真实后端 /api/tts/edge-voices）
    await expect(page.getByRole('combobox', { name: /voice/i }).locator('option').first()).toBeAttached({ timeout: 15_000 });
  });

  // @feature 音色过滤 — 语言/性别下拉
  test('声音列表支持语言与性别过滤', async ({ page }) => {
    await page.goto('/try.html');
    const voiceCombo = page.getByRole('combobox', { name: 'Voice', exact: true });
    await expect(voiceCombo.locator('option').first()).toBeAttached({ timeout: 15_000 });

    // 默认 English
    await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('English');
    const englishCount = await voiceCombo.locator('option').count();
    expect(englishCount).toBeGreaterThan(0);

    // 切到 Chinese → 选项变化且全部 zh-
    await page.getByRole('combobox', { name: 'Language' }).selectOption('Chinese');
    const zhOptions = voiceCombo.locator('option');
    await expect(zhOptions.first()).toBeAttached();
    const zhValues = await zhOptions.evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    expect(zhValues.length).toBeGreaterThan(0);
    expect(zhValues.every((v) => v.startsWith('zh-'))).toBe(true);

    // 性别过滤 Male → 选项减少且不为 0
    await page.getByRole('combobox', { name: 'Language' }).selectOption('English');
    await page.getByRole('combobox', { name: 'Gender' }).selectOption('Male');
    const maleCount = await voiceCombo.locator('option').count();
    expect(maleCount).toBeGreaterThan(0);
    expect(maleCount).toBeLessThan(englishCount);
  });

  // @feature 字数上限 — 单次 3000 字
  test('超过 3000 字禁止合成', async ({ page }) => {
    await page.goto('/try.html');
    await page.getByRole('textbox').fill('a'.repeat(3001));

    await expect(page.getByRole('button', { name: 'Generate speech' })).toBeDisabled();
    await expect(page.getByText(/This demo supports up to 3,000/)).toBeVisible();
    await expect(page.getByTestId('char-count')).toHaveText(/3,001 \/ 3,000/);
  });

  // @feature 核心链路 — 合成/试听/下载/全部下载/历史
  test('粘贴 → 合成 → 试听 → 下载（每 5 次弹推荐）→ 全部下载 → 历史管理', async ({ page }) => {
    await page.goto('/try.html');
    await expect(page.getByRole('combobox', { name: /voice/i }).locator('option').first()).toBeAttached({ timeout: 15_000 });

    // 合成（真实 edge_tts，本地后端不走限流）
    await page.getByRole('textbox').fill(SAMPLE_TEXT);
    await page.getByRole('button', { name: 'Generate speech' }).click();
    await expect(page.getByTestId('audio-player')).toBeVisible({ timeout: 30_000 });

    // 历史记录出现
    const historyList = page.getByTestId('history-list');
    await expect(historyList).toContainText(SAMPLE_TEXT);

    // 前 4 次下载直接触发，不弹推荐确认（页面停留计数，刷新归零）
    for (let i = 0; i < 4; i++) {
      const directDownloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).first().click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await directDownloadPromise;
    }

    // 第 5 次下载 → 推荐弹窗 → 继续下载
    await page.getByRole('button', { name: 'Download', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/full version/);
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Continue download' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.mp3$/);

    // 确认后再次下载不弹窗
    const download2Promise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).first().click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await download2Promise;

    // 全部下载：打包为单个 zip，不弹推荐确认
    const zipDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download all' }).click();
    const zipDownload = await zipDownloadPromise;
    expect(zipDownload.suggestedFilename()).toMatch(/\.zip$/);
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // 单条删除
    await page.getByRole('button', { name: 'Delete' }).first().click();
    await expect(historyList).not.toBeVisible();
    await expect(page.getByText(/stored only in this browser/)).toBeVisible();

    // 一键清空：再造一条记录后清空
    await page.getByRole('textbox').fill(SAMPLE_TEXT);
    await page.getByRole('button', { name: 'Generate speech' }).click();
    await expect(page.getByTestId('history-list')).toContainText(SAMPLE_TEXT, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Clear all' }).click();
    const clearDialog = page.getByRole('dialog');
    await expect(clearDialog).toContainText(/Clear all recordings/);
    await clearDialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByTestId('history-list')).not.toBeVisible();
  });

  // @feature 转化链路 — 「试用完整功能」内容接力到主应用
  test('「试用完整功能」把文档带入主应用空项目', async ({ page }) => {
    // locale 需在首次导航前注入：跳回主应用时落地页已按 localStorage 渲染，事后设置不会重渲染
    await setLocaleToZhCN(page);
    await page.goto('/try.html');
    await page.getByRole('textbox').fill(SAMPLE_TEXT);
    await page.getByRole('button', { name: 'Try full version' }).first().click();

    // 跳回主应用落地页
    await page.waitForURL(/\/$/);
    await enterWorkspace(page);

    // 新建空项目（创建后自动进入项目工作区）→ 切到工作室 → 接力文本预填进原文
    await page.getByRole('button', { name: /新建项目/ }).click();
    await page.getByLabel(/项目名称/).fill('E2E-Try接力');
    await page.getByRole('button', { name: '创建项目' }).click();
    await page.getByRole('button', { name: /◉ 工作室/ }).click();

    const studioTextarea = page.locator('textarea').first();
    await expect(studioTextarea).toHaveValue(SAMPLE_TEXT, { timeout: 15_000 });
    // 接力一次性消费
    expect(await page.evaluate(() => sessionStorage.getItem('try_handoff_text'))).toBeNull();
  });
});
