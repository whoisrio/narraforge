/**
 * Transcription hub E2E tests
 *
 * Covers navigation to the transcription page, upload area visibility, and engine configuration.
 *
 * @feature docs/feature-spec.md §5 Transcription Hub
 * @feature docs/feature-spec.md §5.2 Engine Support (Whisper, FunASR)
 * @feature docs/feature-spec.md §5.3 Transcription Parameters
 */
import { expect, test } from '@playwright/test';
import { collectErrors, setLocaleToZhCN, enterWorkspace } from '../helpers';

test.describe('语音转写', () => {
  // @feature §5.1 Layout — two-column layout with AudioDropzone
  // @feature §5.4 Input Methods — single file drag-and-drop
  test('导航到转写页面并显示上传区域', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    await page.goto('/');
    await enterWorkspace(page);
    await expect(page.getByText('项目工作台')).toBeVisible({ timeout: 10_000 });

    // Click "字幕识别" in sidebar navigation
    await page.getByRole('button', { name: /字幕识别/ }).click();

    // Verify the transcription page loads
    await expect(page.getByRole('heading', { name: /字幕识别/ })).toBeVisible({ timeout: 10_000 });

    // Verify upload area is visible — the audio dropzone
    await expect(page.getByText(/拖放音频到此处|拖拽音频文件到此处/)).toBeVisible({ timeout: 5_000 });

    // Verify engine configuration is visible in the sidebar
    await expect(page.getByText('引擎配置')).toBeVisible();

    expect(errors).toEqual([]);
  });

  // @feature §5.2 Engine Support — Whisper and FunASR engine options
  // @feature §5.3 Transcription Parameters — model size, beam size, VAD
  test('显示引擎配置选项', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    await page.goto('/');
    await enterWorkspace(page);
    await page.getByRole('button', { name: /字幕识别/ }).click();
    await expect(page.getByRole('heading', { name: /字幕识别/ })).toBeVisible({ timeout: 10_000 });

    // Verify engine config section
    await expect(page.getByText('引擎配置')).toBeVisible({ timeout: 5_000 });

    // Verify Whisper and FunASR engine options exist in the engine selector
    // (options inside <select> are hidden until dropdown opens, so check the select element)
    const engineSelect = page.locator('select').filter({ hasText: /Whisper/ });
    await expect(engineSelect).toBeVisible({ timeout: 5_000 });
    const options = await engineSelect.locator('option').allTextContents();
    expect(options.some(o => o.includes('Whisper'))).toBe(true);
    expect(options.some(o => o.includes('FunASR'))).toBe(true);

    // Verify model size selector
    await expect(page.getByText('模型大小')).toBeVisible();

    // VAD toggle is only visible when FunASR engine is selected
    // (skip this check since we haven't selected FunASR)

    expect(errors).toEqual([]);
  });
});
