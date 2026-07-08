/**
 * Studio batch synthesis and export E2E tests
 *
 * Covers batch synthesize all segments and the export dialog.
 * Uses the before → post-commit verification pattern.
 *
 * @feature docs/feature-spec.md §4.4 Batch Operations (Generate All, Export)
 */
import { expect, test } from '@playwright/test';
import {
  collectErrors,
  goToStudio,
  readBackendProject,
  assertSegmentHasAudio,
  countReadySegments,
  totalSegmentCount,
  validateChapter,
  validateSegment,
} from '../helpers';

test.describe('Studio Batch & Export', () => {
  // @feature §4.4 Batch Operations — Generate All: synthesize all idle/failed segments
  test('batch synthesizes all segments', async ({ page }) => {
    const errors = collectErrors(page);

    await goToStudio(page);

    // ── Step 1: BEFORE action — snapshot IndexedDB state ──

    const segmentRows = page.locator('[class*="compactCard"]');
    const count = await segmentRows.count();
    expect(count).toBeGreaterThan(0);

    await page.waitForTimeout(1_000);
    const projectBefore = await readBackendProject(page, 'test-e2e-project');
    expect(projectBefore).toBeTruthy();
    const totalBefore = totalSegmentCount(projectBefore!);
    const readyBefore = countReadySegments(projectBefore!);

    // Snapshot individual segment statuses
    const chapterBefore = projectBefore!.chapters.find(
      (ch) => ch.id === (projectBefore!.active_chapter_id ?? projectBefore!.chapters[0]?.id),
    );
    expect(chapterBefore).toBeTruthy();
    const statusesBefore = chapterBefore!.segments.map((s) => s.status);

    // ── Step 2: Click "批量合成" ──

    await page.getByRole('button', { name: '批量合成' }).click();

    // Confirmation dialog appears when segments already have audio — click confirm button
    await page.waitForTimeout(1000);
    // The ConfirmDialog uses useTranslation now, so button text matches locale
    const confirmBtn = page.locator('button').filter({ hasText: /重新生成|Regenerate/ }).first();
    if (await confirmBtn.count() > 0) {
      // Click the button directly (not the overlay which would cancel)
      await confirmBtn.click();
    }

    // ── Step 3: Progress indicators appear ──

    await expect(page.getByText('生成中...').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('生成中...').first()).not.toBeVisible({ timeout: 120_000 });

    // ── Step 4: POST-COMMIT — all segments status = 'ready' ──

    // Verify segments show generated status (play buttons should be present)
    const playButtons = page.locator('[class*="play"], [aria-label*="播放"]');
    const playCount = await playButtons.count();
    expect(playCount).toBeGreaterThanOrEqual(1);

    // IndexedDB verification
    await page.waitForTimeout(2_000); // wait for autosave
    const projectAfter = await readBackendProject(page, 'test-e2e-project');
    expect(projectAfter).toBeTruthy();

    // Verify all segments have generated audio
    const totalSegments = totalSegmentCount(projectAfter!);
    const readySegments = countReadySegments(projectAfter!);
    expect(totalSegments).toBe(totalBefore);
    expect(readySegments).toBe(totalSegments);

    // Validate full schema for each chapter and each segment
    for (const ch of projectAfter!.chapters) {
      validateChapter(ch);
      for (const seg of ch.segments) {
        assertSegmentHasAudio(seg);
        validateSegment(seg);
      }
    }

    // Verify every segment status changed from before
    const chapterAfter = projectAfter!.chapters.find(
      (ch) => ch.id === (projectAfter!.active_chapter_id ?? projectAfter!.chapters[0]?.id),
    );
    expect(chapterAfter).toBeTruthy();
    for (let i = 0; i < chapterAfter!.segments.length; i++) {
      expect(chapterAfter!.segments[i].status).toBe('ready');
      // If it was idle before, verify it changed
      if (statusesBefore[i] !== undefined && statusesBefore[i] !== 'ready') {
        expect(chapterAfter!.segments[i].status).not.toBe(statusesBefore[i]);
      }
    }

    // Verify the "X/Y 已生成" counter in the UI shows all segments generated
    const counterText = page.locator('text=/\\d+\\/\\d+ 已生成/');
    await expect(counterText.first()).toBeVisible({ timeout: 5_000 });
    const counterContent = await counterText.first().textContent();
    expect(counterContent).toBeTruthy();
    // Parse "X/Y 已生成" and verify X === Y
    const match = counterContent!.match(/(\d+)\/(\d+)/);
    if (match) {
      expect(match[1]).toBe(match[2]);
    }

    expect(errors).toEqual([]);
  });

  // @feature §4.4 Batch Operations — Export: WAV/JSON/SRT/bilingual SRT
  test('opens export dialog and shows options', async ({ page }) => {
    const errors = collectErrors(page);

    await goToStudio(page);

    // Click "导出" button
    await page.getByRole('button', { name: '导出' }).click();

    // Verify export dialog opens
    await expect(page.getByText('导出选项')).toBeVisible({ timeout: 5_000 });

    // Verify export format options are visible
    await expect(page.getByText('MP3 音频')).toBeVisible();
    await expect(page.getByText('SRT 字幕')).toBeVisible();

    // Close dialog
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByText('导出选项')).not.toBeVisible({ timeout: 5_000 });

    expect(errors).toEqual([]);
  });
});
