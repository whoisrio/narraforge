/**
 * Studio segment operations E2E tests
 *
 * Covers single-segment generation, voice lock toggle, delete, and merge.
 * Uses the before → pre-commit → post-commit verification pattern.
 *
 * @feature docs/feature-spec.md §4.4 Segment Lifecycle (idle → queued → pending → ready)
 * @feature docs/feature-spec.md §4.4 Per-Segment Voice Source (lock toggle)
 * @feature docs/feature-spec.md §4.4 Per-Segment features (delete, merge)
 */
import { expect, test } from '@playwright/test';
import {
  collectErrors,
  goToStudio,
  readBackendProject,
  interceptPostResponse,
  assertSegmentHasAudio,
  assertVoiceSource,
  totalSegmentCount,
  validateSegment,
  validateVoiceSource,
  validateChapter,
} from '../helpers';

test.describe('Studio Segment Operations', () => {
  // @feature §4.4 Segment Lifecycle — idle → queued → pending → ready
  test('generates audio for a single segment', async ({ page }) => {
    const errors = collectErrors(page);

    await goToStudio(page);

    // Find the first segment row
    const segmentRows = page.locator('[class*="compactCard"]');
    await expect(segmentRows.first()).toBeVisible({ timeout: 10_000 });
    const firstRow = segmentRows.first();

    // Capture the text of the first segment for later matching
    const firstSegmentText = await firstRow
      .locator('[class*="text"], textarea, [contenteditable]')
      .first()
      .textContent()
      .catch(() => '');

    // ── Step 1: BEFORE action — snapshot IndexedDB state ──

    await page.waitForTimeout(1_000);
    const projectBefore = await readBackendProject(page, 'test-e2e-project');
    expect(projectBefore).toBeTruthy();
    const chapterBefore = projectBefore!.chapters.find(
      (ch) => ch.id === (projectBefore!.active_chapter_id ?? projectBefore!.chapters[0]?.id),
    );
    expect(chapterBefore).toBeTruthy();
    expect(chapterBefore!.segments.length).toBeGreaterThan(0);

    // Snapshot the target segment status before generation
    const targetSegBefore = firstSegmentText
      ? chapterBefore!.segments.find((s) => s.text.includes(firstSegmentText.slice(0, 20)))
      : chapterBefore!.segments[0];
    expect(targetSegBefore).toBeTruthy();
    const statusBefore = targetSegBefore!.status;

    // Set up API intercept before triggering the action
    const synthResponsePromise = interceptPostResponse(page, '/synthesize');

    // ── Step 2: Click "生成" ──

    await firstRow.getByRole('button', { name: '生成' }).click();

    // ── Step 3: Loading indicator appears, segment status still idle/pending ──

    await expect(page.getByText('生成中...').first()).toBeVisible({ timeout: 15_000 });

    // During loading, the segment status in IndexedDB should still be the original value
    // (the in-flight generation has not completed yet)
    const projectDuringLoading = await readBackendProject(page, 'test-e2e-project');
    const chapterDuring = projectDuringLoading!.chapters.find(
      (ch) => ch.id === (projectDuringLoading!.active_chapter_id ?? projectDuringLoading!.chapters[0]?.id),
    );
    const segDuring = firstSegmentText
      ? chapterDuring!.segments.find((s) => s.text.includes(firstSegmentText.slice(0, 20)))
      : chapterDuring!.segments[0];
    expect(segDuring).toBeTruthy();
    // Status should be idle, queued, or pending — not yet 'ready'
    expect(['idle', 'queued', 'pending']).toContain(segDuring!.status);

    // Wait for completion
    await expect(page.getByText('生成中...').first()).not.toBeVisible({ timeout: 60_000 });

    // ── Step 4: POST-COMMIT — segment status = 'ready', audio valid ──

    // Verify the segment shows generated audio (play button appears)
    const playButtons = firstRow.locator('[class*="play"], [aria-label*="播放"]');
    await expect(playButtons.first()).toBeVisible({ timeout: 10_000 });

    // API response verification
    const synthResponse = await synthResponsePromise;
    expect(synthResponse.status).toBe(200);
    expect(synthResponse.body).toBeTruthy();
    const synthBody = synthResponse.body as Record<string, unknown>;
    expect(synthBody.chapters).toBeTruthy();

    // IndexedDB verification
    await page.waitForTimeout(2_000); // wait for autosave
    const projectAfter = await readBackendProject(page, 'test-e2e-project');
    expect(projectAfter).toBeTruthy();

    const activeChapter = projectAfter!.chapters.find(
      (ch) => ch.id === (projectAfter!.active_chapter_id ?? projectAfter!.chapters[0]?.id),
    );
    expect(activeChapter).toBeTruthy();
    expect(activeChapter!.segments.length).toBeGreaterThan(0);

    // Validate full chapter schema
    validateChapter(activeChapter!);

    const targetSegment = firstSegmentText
      ? activeChapter!.segments.find((s) => s.text.includes(firstSegmentText.slice(0, 20)))
      : activeChapter!.segments[0];
    expect(targetSegment).toBeTruthy();

    // Verify segment status changed to 'ready' and has audio data
    assertSegmentHasAudio(targetSegment!);

    // Validate the generated segment's full schema
    validateSegment(targetSegment!);

    // Verify status actually changed from before
    expect(targetSegment!.status).not.toBe(statusBefore);
    expect(targetSegment!.status).toBe('ready');

    expect(errors).toEqual([]);
  });

  // @feature §4.4 Per-Segment Voice Source — lock toggle (chapter ↔ custom)
  test('toggles voice lock on a segment', async ({ page }) => {
    const errors = collectErrors(page);

    await goToStudio(page);

    // ── Step 1: BEFORE action — snapshot IndexedDB state ──

    await page.waitForTimeout(1_000);
    const projectBefore = await readBackendProject(page, 'test-e2e-project');
    expect(projectBefore).toBeTruthy();
    const chapterBefore = projectBefore!.chapters.find(
      (ch) => ch.id === (projectBefore!.active_chapter_id ?? projectBefore!.chapters[0]?.id),
    );
    expect(chapterBefore).toBeTruthy();
    const firstSegBefore = chapterBefore!.segments[0];
    expect(firstSegBefore).toBeTruthy();
    const initialSource = firstSegBefore.voice.source;

    // Validate voice source before toggle
    validateVoiceSource(firstSegBefore.voice as Record<string, unknown>, 'segment[0].voice');

    // ── Step 2: Click lock — immediate operation (no dialog) ──

    const lockIcons = page.locator('[class*="compactVoiceLock"], [class*="voiceLock"]');
    await expect(lockIcons.first()).toBeVisible({ timeout: 10_000 });
    const firstLock = lockIcons.first();

    // Get initial UI state (tooltip or class)
    const initialTitle = (await firstLock.getAttribute('title')) ?? '';

    // Click to toggle lock
    await firstLock.click();
    await page.waitForTimeout(500);

    // ── Step 3: Verify UI tooltip changed ──

    const afterTitle = (await firstLock.getAttribute('title')) ?? '';
    expect(afterTitle).not.toBe(initialTitle);

    // ── Step 4: IndexedDB voice.source = 'custom' (immediate, no dialog) ──

    await page.waitForTimeout(1_500);
    const projectAfter = await readBackendProject(page, 'test-e2e-project');
    const chapterAfter = projectAfter!.chapters.find(
      (ch) => ch.id === (projectAfter!.active_chapter_id ?? projectAfter!.chapters[0]?.id),
    );
    const firstSegAfter = chapterAfter!.segments[0];

    // voice.source should have toggled: 'chapter' <-> 'custom'
    if (initialSource === 'chapter') {
      expect(firstSegAfter.voice.source).toBe('custom');
    } else {
      expect(firstSegAfter.voice.source).toBe('chapter');
    }

    // Validate the toggled voice source
    validateVoiceSource(firstSegAfter.voice as Record<string, unknown>, 'segment[0].voice-after-toggle');

    // ── Step 5: Click lock again to toggle back ──

    await firstLock.click();
    await page.waitForTimeout(500);

    // ── Step 6: Verify reverted UI ──

    const revertedTitle = (await firstLock.getAttribute('title')) ?? '';
    expect(revertedTitle).toBe(initialTitle);

    // Verify reverted IndexedDB state
    await page.waitForTimeout(1_500);
    const projectReverted = await readBackendProject(page, 'test-e2e-project');
    const chapterReverted = projectReverted!.chapters.find(
      (ch) => ch.id === (projectReverted!.active_chapter_id ?? projectReverted!.chapters[0]?.id),
    );
    const segReverted = chapterReverted!.segments[0];
    expect(segReverted.voice.source).toBe(initialSource);

    // Validate reverted voice source
    validateVoiceSource(segReverted.voice as Record<string, unknown>, 'segment[0].voice-reverted');

    expect(errors).toEqual([]);
  });

  // @feature §4.4 Per-Segment features — delete segment with confirmation
  test('deletes a segment', async ({ page }) => {
    const errors = collectErrors(page);

    await goToStudio(page);

    // ── Step 1: BEFORE action — snapshot IndexedDB state ──

    const segmentRows = page.locator('[class*="compactCard"]');
    const initialCount = await segmentRows.count();
    expect(initialCount).toBeGreaterThan(0);

    const projectBefore = await readBackendProject(page, 'test-e2e-project');
    expect(projectBefore).toBeTruthy();
    const segCountBefore = totalSegmentCount(projectBefore!);
    const activeChapterBefore = projectBefore!.chapters.find(
      (ch) => ch.id === (projectBefore!.active_chapter_id ?? projectBefore!.chapters[0]?.id),
    );
    expect(activeChapterBefore).toBeTruthy();

    // Snapshot segment texts before deletion
    const segTextsBefore = activeChapterBefore!.segments.map((s) => s.text);
    const lastSegText = segTextsBefore[segTextsBefore.length - 1];

    // ── Step 2: Click delete → confirm dialog appears ──

    const lastRow = segmentRows.last();
    const deleteButton = lastRow.getByTitle(/删除/);
    await deleteButton.click();

    // Confirm dialog appears
    await expect(page.getByText(/确定删除该分段/)).toBeVisible({ timeout: 5_000 });

    // ── Step 3: PRE-COMMIT — segment count UNCHANGED (dialog is open, not committed) ──

    // UI segment count should still be the same — the dialog is open but delete hasn't been committed
    const countDuringDialog = await segmentRows.count();
    expect(countDuringDialog).toBe(initialCount);

    // IndexedDB should still have the original segment count
    const projectDuringDialog = await readBackendProject(page, 'test-e2e-project');
    const segCountDuringDialog = totalSegmentCount(projectDuringDialog!);
    expect(segCountDuringDialog).toBe(segCountBefore);

    // ── Step 4: Click confirm (button label is "删除", not "确认") ──

    await page.getByRole('button', { name: '删除', exact: true }).click();

    // ── Step 5: POST-COMMIT — segment count -1, deleted text gone ──

    // Verify segment count decreased by 1 (UI)
    await page.waitForTimeout(1_000);
    const newCount = await segmentRows.count();
    expect(newCount).toBe(initialCount - 1);

    // IndexedDB verification
    await page.waitForTimeout(1_500); // wait for autosave
    const projectAfter = await readBackendProject(page, 'test-e2e-project');
    expect(projectAfter).toBeTruthy();
    const segCountAfter = totalSegmentCount(projectAfter!);
    expect(segCountAfter).toBe(segCountBefore - 1);

    // Verify the deleted segment's text no longer exists as a standalone segment
    const activeChapterAfter = projectAfter!.chapters.find(
      (ch) => ch.id === (projectAfter!.active_chapter_id ?? projectAfter!.chapters[0]?.id),
    );
    expect(activeChapterAfter).toBeTruthy();
    const remainingTexts = activeChapterAfter!.segments.map((s) => s.text);
    expect(remainingTexts).not.toContain(lastSegText);

    // Validate the remaining segments
    for (const seg of activeChapterAfter!.segments) {
      validateSegment(seg);
    }

    expect(errors).toEqual([]);
  });

  // @feature §4.4 Per-Segment features — merge adjacent segments
  test('merges segments down', async ({ page }) => {
    const errors = collectErrors(page);

    await goToStudio(page);

    // ── Step 1: BEFORE action — snapshot IndexedDB state ──

    const segmentRows = page.locator('[class*="compactCard"]');
    const initialCount = await segmentRows.count();
    expect(initialCount).toBeGreaterThan(1);

    const projectBefore = await readBackendProject(page, 'test-e2e-project');
    expect(projectBefore).toBeTruthy();
    const activeChapterBefore = projectBefore!.chapters.find(
      (ch) => ch.id === (projectBefore!.active_chapter_id ?? projectBefore!.chapters[0]?.id),
    );
    expect(activeChapterBefore).toBeTruthy();
    const segCountBefore = activeChapterBefore!.segments.length;
    const firstSegText = activeChapterBefore!.segments[0]?.text ?? '';
    const secondSegText = activeChapterBefore!.segments[1]?.text ?? '';

    // ── Step 2: Click merge ──

    const firstRow = segmentRows.first();

    // Click the merge button (⇄) to open the merge menu
    const mergeButton = firstRow.getByTitle(/合并/);
    await mergeButton.click();

    // Click "向下合并" button (not menuitem — it's a regular button in the merge menu)
    await page.getByRole('button', { name: /向下合并/ }).click();

    // Confirmation dialog appears only if segments have audio.
    // If no audio, merge happens immediately without confirmation.
    const dialogVisible = await page.getByText(/合并将删除/).isVisible({ timeout: 3_000 }).catch(() => false);
    if (dialogVisible) {
      await page.getByRole('button', { name: '继续' }).click();
    }

    // ── Step 3: POST-COMMIT — segment count -1, merged text contains both originals ──

    // Verify segment count decreased by 1 (UI)
    await page.waitForTimeout(1_000);
    const newCount = await segmentRows.count();
    expect(newCount).toBe(initialCount - 1);

    // IndexedDB verification
    await page.waitForTimeout(1_500); // wait for autosave
    const projectAfter = await readBackendProject(page, 'test-e2e-project');
    expect(projectAfter).toBeTruthy();
    const activeChapterAfter = projectAfter!.chapters.find(
      (ch) => ch.id === (projectAfter!.active_chapter_id ?? projectAfter!.chapters[0]?.id),
    );
    expect(activeChapterAfter).toBeTruthy();

    // Verify total segment count decreased
    expect(activeChapterAfter!.segments.length).toBe(segCountBefore - 1);

    // Verify the merged segment's text contains content from both original segments
    const mergedText = activeChapterAfter!.segments[0]?.text ?? '';
    if (firstSegText && secondSegText) {
      expect(mergedText).toContain(firstSegText);
      expect(mergedText).toContain(secondSegText);
    }

    // Verify the second segment was removed (its text should no longer be a standalone segment)
    const remainingTexts = activeChapterAfter!.segments.map((s) => s.text);
    if (secondSegText) {
      const standaloneMatch = remainingTexts.filter((t) => t === secondSegText);
      expect(standaloneMatch.length).toBe(0);
    }

    // Validate the chapter and all remaining segments
    validateChapter(activeChapterAfter!);

    expect(errors).toEqual([]);
  });
});
