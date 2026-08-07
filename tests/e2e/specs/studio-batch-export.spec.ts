/**
 * Studio batch synthesis and export E2E tests
 *
 * Covers batch synthesize all segments and the export dialog.
 * Uses the before → post-commit verification pattern.
 *
 * @feature docs/feature-spec.md §4.4 Batch Operations (Generate All, Export)
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import {
  collectErrors,
  setLocaleToZhCN,
  goToStudio,
  readBackendProject,
  assertSegmentHasAudio,
  validateChapter,
  validateSegment,
  seedTestProject,
} from '../helpers';
import { E2E_BACKEND_URL } from '../helpers/ports';
import { parseSrtCues } from '../helpers/srt';
import { verifyDbWithScreenshot } from '../helpers/dualReadSnapshot';

const BACKEND = E2E_BACKEND_URL;

test.describe('批量合成与导出', () => {
  // Re-seed before each test so batch synthesis always starts from clean data,
  // regardless of what prior test files may have written to the DB.
  test.beforeEach(async ({ page }) => {
    await seedTestProject(page);
  });
  // @feature §4.4 Batch Operations — Generate All: synthesize all idle/failed segments
  test('批量合成所有段落', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await goToStudio(page);

    // ── Step 1: BEFORE action — snapshot IndexedDB state ──

    const segmentRows = page.locator('[class*="compactCard"]');
    const count = await segmentRows.count();
    expect(count).toBeGreaterThan(0);

    await page.waitForTimeout(1_000);
    const projectBefore = await readBackendProject(page, 'test-e2e-project');
    expect(projectBefore).toBeTruthy();

    // Snapshot the active chapter and count segments we expect to regenerate.
    const chapterBefore = projectBefore!.chapters.find(
      (ch) => ch.id === (projectBefore!.active_chapter_id ?? projectBefore!.chapters[0]?.id),
    );
    expect(chapterBefore).toBeTruthy();
    const expectedAudioAfter = chapterBefore!.segments.length;

    // ── Step 2: Click "批量合成", then choose "重新合成全部" from the menu ──

    await page.getByRole('button', { name: '批量合成' }).click();
    const regenerateAllItem = page.getByRole('button', { name: /重新合成全部|Regenerate All/ });
    await expect(regenerateAllItem).toBeVisible({ timeout: 15_000 });
    await regenerateAllItem.click();

    // Confirmation dialog appears when segments already have audio — click confirm button.
    // The dialog's confirmLabel is t('tts.regenerate') = '重新生成' / 'Regenerate'.
    const confirmBtn = page.getByRole('alertdialog').getByRole('button', { name: /重新生成|Regenerate/ });
    await expect(confirmBtn).toBeVisible({ timeout: 15_000 });
    await confirmBtn.click();

    // ── Step 3: Wait for synthesis to complete by polling backend ──
    // TTSSynthesis does not render a '生成中...' label during batch synthesis; the
    // only reliable cross-UI signal is the backend segment audio transition.
    // handleRegenerateAll only regenerates the active chapter's segments, so we
    // poll until the active chapter has audio for every segment (other chapters
    // are untouched). The backend API does not return `status`, so we use the
    // presence of `audio.current` as the generated-audio signal.
    let projectDuring: typeof projectBefore | undefined;
    await expect.poll(async () => {
      projectDuring = await readBackendProject(page, 'test-e2e-project');
      const activeChapter = projectDuring!.chapters.find(
        (ch) => ch.id === (projectDuring!.active_chapter_id ?? projectDuring!.chapters[0]?.id),
      );
      return activeChapter!.segments.filter((s) => {
        const current = s.audio?.current;
        return !!(current && (current.id || current.path));
      }).length;
    }, { timeout: 60_000 }).toBe(expectedAudioAfter);

    // ── Step 4: POST-COMMIT — active chapter segments are 'ready' ──

    // Verify segments show generated status (per-segment play buttons should be present)
    const playButtons = page.locator('[class*="PlayBtn"], [aria-label*="播放"]');
    const playCount = await playButtons.count();
    expect(playCount).toBeGreaterThanOrEqual(1);

    // IndexedDB verification
    await page.waitForTimeout(2_000); // wait for autosave
    const projectAfter = await readBackendProject(page, 'test-e2e-project');
    expect(projectAfter).toBeTruthy();

    const chapterAfter = projectAfter!.chapters.find(
      (ch) => ch.id === (projectAfter!.active_chapter_id ?? projectAfter!.chapters[0]?.id),
    );
    expect(chapterAfter).toBeTruthy();

    // Verify active chapter segments have generated audio and valid schema
    for (const seg of chapterAfter!.segments) {
      assertSegmentHasAudio(seg);
      validateSegment(seg);
    }

    // Validate schema for non-active chapters without expecting audio regeneration
    for (const ch of projectAfter!.chapters) {
      if (ch.id === chapterAfter!.id) continue;
      validateChapter(ch);
    }

    await verifyDbWithScreenshot(page, 'test-e2e-project', 'studio-batch-export-dbProject');

    // Verify every active chapter segment gained audio (and lost the seed-only id)
    for (let i = 0; i < chapterAfter!.segments.length; i++) {
      const segBefore = chapterBefore!.segments[i];
      const segAfter = chapterAfter!.segments[i];
      const currentAfter = segAfter.audio?.current;
      expect(
        currentAfter && (currentAfter.id || currentAfter.path),
        `segment ${segAfter.id} should have audio.current after synthesis`,
      ).toBeTruthy();
      // If the seed had an audio placeholder without duration, verify it was replaced
      // by a real synthesis result (path + duration_sec).
      if (segBefore.audio?.current?.path === undefined) {
        expect(
          currentAfter?.path && typeof currentAfter?.duration_sec === 'number',
          `segment ${segAfter.id} should have real synthesized audio (path + duration)`,
        ).toBeTruthy();
      }
    }

    // Verify the "X/Y 已生成" counter in the UI shows all active segments generated
    const counterText = page.locator('text=/\\d+\\/\\d+ 已生成/');
    await expect(counterText.first()).toBeVisible({ timeout: 5_000 });
    const counterContent = await counterText.first().textContent();
    expect(counterContent).toBeTruthy();
    // Parse "X/Y 已生成" and verify X === Y for the active chapter
    const match = counterContent!.match(/(\d+)\/(\d+)/);
    if (match) {
      expect(match[1]).toBe(match[2]);
    }

    expect(errors).toEqual([]);
  });

  // @feature §4.4 Batch Operations — Export: WAV/JSON/SRT/bilingual SRT
  test('打开导出对话框并显示选项', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await goToStudio(page);

    // VoiceStudioLayout collapses the transport bar by default; expand it to reveal "导出".
    const transportToggle = page.getByRole('button', { name: /展开工具栏/ });
    await expect(transportToggle).toBeVisible({ timeout: 5_000 });
    await transportToggle.click();

    // Click "导出" button (exact match avoids collision with "导出全部")
    await page.getByRole('button', { name: '导出', exact: true }).click();

    // Verify export dialog opens
    await expect(page.getByText('导出选项')).toBeVisible({ timeout: 5_000 });

    // Verify export format options are visible (exact match avoids '双语 SRT 字幕' collision)
    await expect(page.getByText('MP3 音频', { exact: true })).toBeVisible();
    await expect(page.getByText('SRT 字幕', { exact: true })).toBeVisible();

    // Defaults: MP3 audio + SRT subtitle selected; script JSON hidden
    await expect(page.getByRole('checkbox', { name: 'MP3 音频', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'SRT 字幕', exact: true })).toBeChecked();
    await expect(page.getByText('脚本 JSON', { exact: true })).toBeHidden();

    // Close dialog
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByText('导出选项')).not.toBeVisible({ timeout: 5_000 });

    expect(errors).toEqual([]);
  });

  // @feature §4.4 Export — SRT 时间轴只含 ready 段，未合成段不产生零时长 cue
  test('导出 SRT 跳过未合成段：cue 数 == ready 段数，时间轴从 0 连续', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    // beforeEach 已 re-seed（音频重置为占位）；清掉第二章可能残留的变速记录
    // （e2e 库跨 run 持久，无记录时该调用 422，忽略）
    await page.request.post(
      `${BACKEND}/api/segmented-projects/test-e2e-project/chapters/test-chapter-2/adjust-audio`,
      { data: { tempo: 1.0, volume_db: 0 } },
    ).catch(() => {});

    // ── 只合成 seg-2-1，seg-2-2 保持未合成 ──
    const synthResp = await page.request.post(
      `${BACKEND}/api/segmented-projects/test-e2e-project/chapters/test-chapter-2/segments/seg-2-1/synthesize`,
      { data: {} },
    );
    expect(synthResp.ok(), `synthesize failed: ${await synthResp.text()}`).toBeTruthy();

    const projResp = await page.request.get(`${BACKEND}/api/segmented-projects/test-e2e-project`);
    expect(projResp.ok()).toBeTruthy();
    const ch2 = (await projResp.json()).chapters.find((c: { id: string }) => c.id === 'test-chapter-2')!;
    const readyDur = ch2.segments.find((s) => s.id === 'seg-2-1')!.audio?.current?.duration_sec as number;
    expect(readyDur).toBeGreaterThan(0);
    expect(ch2.segments.find((s) => s.id === 'seg-2-2')!.audio?.current ?? null).toBeNull();

    // ── UI：切到第二章 -> 导出 -> 只勾 SRT -> 开始导出（拿 download） ──
    await goToStudio(page);
    await page.getByRole('button', { name: /选择章节 第2章/ }).click();
    await expect(page.getByText('破庙的门半掩着').first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '展开工具栏' }).click();
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await expect(page.getByText('导出选项')).toBeVisible({ timeout: 5_000 });
    // 只留 SRT：取消默认勾选的 MP3 音频（避免触发"跳过未 ready 段"确认弹窗）
    await page.getByRole('checkbox', { name: 'MP3 音频', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '开始导出' }).click(),
    ]);
    const srt = fs.readFileSync(await download.path(), 'utf-8');

    // ── 断言：cue 数 == ready 段数（1），不含未合成段文本，时间轴从 0 连续 ──
    const cues = parseSrtCues(srt);
    expect(cues.length).toBe(1);
    expect(cues[0].text).toContain('破庙的门半掩着');
    expect(srt).not.toContain('他推开门');
    expect(cues[0].startMs).toBe(0);
    // cue 时长与 API 读到的 seg-2-1 current.duration_sec 一致（fmtSrtTime 取整到 ms）
    expect(Math.abs((cues[0].endMs - cues[0].startMs) / 1000 - readyDur)).toBeLessThan(0.02);

    expect(errors).toEqual([]);
  });
});
