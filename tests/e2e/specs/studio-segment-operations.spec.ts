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
import { E2E_BACKEND_URL } from '../helpers/ports';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  collectErrors,
  setLocaleToZhCN,
  goToStudio,
  readBackendProject,
  interceptPostResponse,
  assertSegmentHasAudio,
  assertVoiceSource,
  totalSegmentCount,
  validateSegment,
  validateVoiceSource,
  validateChapter,
  seedTestProject,
} from '../helpers';
import { verifyDbWithScreenshot } from '../helpers/dualReadSnapshot';
import { expectSegmentFileExists, projectDirNameForId } from '../helpers/fsAssertions';
import { readDbProject } from '../helpers/dbReader';
import { attachSegmentAudio } from '../helpers/dbWriter';

test.describe('段落操作', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try { await seedTestProject(page); } finally { await page.close(); }
  });
  // @feature §4.4 Segment Lifecycle — idle → queued → pending → ready
  test('为单个段落生成音频', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await goToStudio(page);

    // Find the first segment row
    const segmentRows = page.locator('[class*="compactCard"]');
    await expect(segmentRows.first()).toBeVisible({ timeout: 10_000 });
    const firstRow = segmentRows.first();

    // ── Step 0: Strip audio from first segment so it becomes idle ──
    // The seed gives every segment an audio.current.id placeholder, which the frontend
    // derives as status='ready'. In compact mode only idle segments show a generate button.
    // We clear the audio via the backend API so the segment goes idle and generates from scratch.

    const projectResp = await page.evaluate(async () => {
      const r = await fetch('/api/segmented-projects/test-e2e-project');
      return r.json();
    });
    const activeChId = projectResp.active_chapter_id || projectResp.chapters[0].id;
    const firstSeg = projectResp.chapters.find((c: any) => c.id === activeChId)?.segments[0];
    expect(firstSeg).toBeTruthy();
    const segId = firstSeg.id;
    // Strip audio and status so segment becomes idle, and reset to
    // narration + chapter voice in case a prior test changed the kind/role.
    firstSeg.audio = { format: 'mp3' };
    firstSeg.status = 'idle';
    firstSeg.segment_kind = 'narration';
    firstSeg.voice = { source: 'chapter' };
    firstSeg.role_id = null;

    await page.evaluate(async ({ project, activeChapterId }: any) => {
      project.active_chapter_id = activeChapterId;
      await fetch(`/api/segmented-projects/test-e2e-project`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
    }, { project: projectResp, activeChapterId: activeChId });

    // Reload the studio page so the UI picks up the idle segment
    await goToStudio(page);
    await page.waitForTimeout(500);

    // ── Step 1: BEFORE action ──
    const segRowsAfterReload = page.locator('[class*="compactCard"]');
    await expect(segRowsAfterReload.first()).toBeVisible({ timeout: 10_000 });
    const updatedFirstRow = segRowsAfterReload.first();

    const projectBefore = await readBackendProject(page, 'test-e2e-project');
    expect(projectBefore).toBeTruthy();
    const chapterBefore = projectBefore!.chapters.find(
      (ch) => ch.id === (projectBefore!.active_chapter_id ?? projectBefore!.chapters[0]?.id),
    );
    expect(chapterBefore).toBeTruthy();
    const segBefore = chapterBefore!.segments.find((s) => s.id === segId);
    expect(segBefore).toBeTruthy();
    const hadAudioPlaceholder = !!(segBefore!.audio?.current?.id);

    // Set up API intercept before triggering the action
    const synthResponsePromise = interceptPostResponse(page, '/synthesize');

    // ── Step 2: Click the compact generate button (now visible because segment is idle) ──
    const genBtn = updatedFirstRow.locator('[class*="compactGenBtn"]');
    await expect(genBtn).toBeVisible({ timeout: 5_000 });
    await genBtn.click();

    // ── Step 3: Wait for synthesis response and poll backend for real audio ──
    const synthResponse = await synthResponsePromise;
    expect(synthResponse.status).toBe(200);

    await expect.poll(async () => {
      const p = await readBackendProject(page, 'test-e2e-project');
      const seg = p!.chapters.flatMap((ch) => ch.segments).find((s) => s.id === segId);
      return !!(seg?.audio?.current?.path);
    }, { timeout: 60_000 }).toBe(true);

    // ── Step 4: POST-COMMIT — segment has real audio ──

    const playButtons = updatedFirstRow.locator('[class*="compactPlayBtn"], [class*="play"], [aria-label*="播放"]');
    await expect(playButtons.first()).toBeVisible({ timeout: 10_000 });

    await page.waitForTimeout(2_000);
    const projectAfter = await readBackendProject(page, 'test-e2e-project');
    expect(projectAfter).toBeTruthy();

    const activeChapter = projectAfter!.chapters.find(
      (ch) => ch.id === (projectAfter!.active_chapter_id ?? projectAfter!.chapters[0]?.id),
    );
    expect(activeChapter).toBeTruthy();

    const targetSegment = activeChapter!.segments.find((s) => s.id === segId);
    expect(targetSegment).toBeTruthy();

    assertSegmentHasAudio(targetSegment!);
    validateSegment(targetSegment!);

    await verifyDbWithScreenshot(page, 'test-e2e-project', 'studio-segment-operations-dbProject1');

    expect(errors).toEqual([]);
  });

  // @feature §4.4 Per-Segment Voice Source — lock toggle (chapter ↔ custom)
  test('切换段落的语音锁定', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await goToStudio(page);

    // ── Step 0: Ensure first segment has toggleable voice (source=chapter) ──
    // Prior tests (dialogue-prosody) may set segment_kind=dialogue / voice.source=role,
    // which renders a static lock span instead of a clickable toggle button.

    interface HookState { chapterId: string; segId: string };
    const reset = await page.evaluate(async () => {
      const r = await fetch('/api/segmented-projects/test-e2e-project');
      const p = await r.json();
      const ch = p.chapters.find((c: any) => c.id === (p.active_chapter_id ?? p.chapters[0]?.id));
      const seg = ch?.segments?.[0];
      if (!seg) return null;
      const dirty = seg.voice?.source === 'role' || seg.segment_kind === 'dialogue';
      if (dirty) {
        await fetch(`/api/segmented-projects/test-e2e-project/chapters/${ch.id}/segments/${seg.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segment_kind: 'narration', voice: { source: 'chapter' }, role_id: null }),
        });
        return { chapterId: ch.id, segId: seg.id };
      }
      return null;
    });

    if (reset) {
      // Reload so the frontend picks up the reset segment
      await goToStudio(page);
      await page.waitForTimeout(500);
    }

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

    await verifyDbWithScreenshot(page, 'test-e2e-project', 'studio-segment-operations-dbProject2');

    expect(errors).toEqual([]);
  });

  // @feature §4.4 Per-Segment features — delete segment with confirmation
  test('删除段落', async ({ page }) => {
    await setLocaleToZhCN(page);
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

    // ── Step 1.5: 给被删段挂假音频（写盘 + DB 直写）──
    // 新契约下要验证「删段不再删文件」，被删段必须真有文件在盘上。
    // PUT 已无法给已存在段挂 audio（服务端自产字段），只能直写 DB。
    const deletedSegId = activeChapterBefore!.segments[activeChapterBefore!.segments.length - 1].id;
    const dirName = projectDirNameForId('test-e2e-project');
    expect(dirName, 'project asset dir should exist after seed').toBeTruthy();
    const segDir = path.resolve(
      __dirname, '..', '..', '..', 'backend', 'data', 'projects',
      dirName!, 'chapters', activeChapterBefore!.id, 'segments',
    );
    fs.mkdirSync(segDir, { recursive: true });
    fs.writeFileSync(path.join(segDir, `${deletedSegId}.mp3`), Buffer.from('fake-mp3'));
    attachSegmentAudio(deletedSegId, `${dirName}/chapters/${activeChapterBefore!.id}/segments/${deletedSegId}.mp3`);

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

    await verifyDbWithScreenshot(page, 'test-e2e-project', 'studio-segment-operations-dbProject3');

    // Filesystem: 新契约——删段不再删除音频文件，被删段的文件保留在盘上
    // （孤儿文件待后续 sweep 回收），这里断言文件仍存在。
    expectSegmentFileExists(dirName!, activeChapterBefore!.id, deletedSegId);

    expect(errors).toEqual([]);
  });

  // @feature §4.4 Per-Segment features — merge adjacent segments
  test('向下合并段落', async ({ page }) => {
    await setLocaleToZhCN(page);
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

    await verifyDbWithScreenshot(page, 'test-e2e-project', 'studio-segment-operations-dbProject4');

    expect(errors).toEqual([]);
  });

  // @feature §4.4 Per-Segment features — merge with audio: confirm dialog + audio downgrade (file kept on disk)
  test('向上合并带音频段落：确认弹窗出现，合并后保留段音频降级且文件保留', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    // ── Step 0: give the first segment a REAL audio file + DB audio.current ──
    // PUT 契约变化后，已存在段的 audio 为服务端自产字段（PUT 会忽略），
    // 模拟「已合成」只能写假文件到盘上 + attachSegmentAudio 直写 DB。
    const BACKEND = E2E_BACKEND_URL;
    const CHAPTER_ID = 'test-chapter-1';
    const relAudioPath = `test-e2e-project/chapters/${CHAPTER_ID}/segments/seg-audio-kept.mp3`;
    const absAudioPath = path.resolve(
      __dirname, '..', '..', '..', 'backend', 'data', 'projects',
      'test-e2e-project', 'chapters', CHAPTER_ID, 'segments', 'seg-audio-kept.mp3',
    );

    const getResp = await page.request.get(`${BACKEND}/api/segmented-projects/test-e2e-project`);
    expect(getResp.ok()).toBeTruthy();
    const project = await getResp.json();
    const chapter = project.chapters.find((c: { id: string }) => c.id === CHAPTER_ID)!;
    // Prior tests in this file shrink chapter 1; restore a second segment if needed.
    // （克隆段是新建段，payload 里的 audio 占位对新建段仍有效）
    if (chapter.segments.length < 2) {
      const clone = JSON.parse(JSON.stringify(chapter.segments[0]));
      clone.id = `${CHAPTER_ID}-seg-merge-e2e`;
      clone.text = '远村灯火，点点明灭。';
      clone.audio = { format: 'mp3' };
      clone.position = chapter.segments.length;
      chapter.segments.push(clone);
    }
    expect(chapter.segments.length).toBeGreaterThan(1);
    const keptSeg = chapter.segments[0];
    const removedSeg = chapter.segments[1];
    const putResp = await page.request.put(`${BACKEND}/api/segmented-projects/test-e2e-project`, { data: project });
    expect(putResp.ok()).toBeTruthy();

    // 挂 DB 音频（直写）+ 写假音频文件到盘上
    attachSegmentAudio(keptSeg.id, relAudioPath);
    fs.mkdirSync(path.dirname(absAudioPath), { recursive: true });
    fs.writeFileSync(absAudioPath, Buffer.from('fake-mp3'));
    expect(fs.existsSync(absAudioPath)).toBe(true);

    // ── Step 1: studio — open merge menu on the SECOND row, choose 向上合并 ──
    await goToStudio(page);
    const segmentRows = page.locator('[class*="compactCard"]');
    await expect(segmentRows.first()).toBeVisible({ timeout: 10_000 });
    const initialCount = await segmentRows.count();

    const secondRow = segmentRows.nth(1);
    await secondRow.getByTitle(/合并/).click();
    await page.getByRole('button', { name: /向上合并/ }).click();

    // ── Step 2: confirm dialog MUST appear (kept segment has audio) ──
    await expect(page.getByText(/合并将删除/)).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: '继续' }).click();

    // ── Step 3: merge committed — count -1, texts merged ──
    await page.waitForTimeout(1_000);
    expect(await segmentRows.count()).toBe(initialCount - 1);

    await page.waitForTimeout(1_500); // wait for autosave
    const projectAfter = await readBackendProject(page, 'test-e2e-project');
    const chapterAfter = projectAfter!.chapters.find((c) => c.id === CHAPTER_ID)!;
    const merged = chapterAfter.segments[0];
    expect(merged.text).toBe(`${keptSeg.text}${removedSeg.text}`);
    // 合并走 structure 端点，文本变化触发音频降级：
    // current 清空，旧音频降级到 previous（文件保留在盘上，可撤销）
    expect(merged.audio?.current).toBeFalsy();
    expect(merged.audio?.previous?.path).toBe(relAudioPath);
    for (const seg of chapterAfter.segments) validateSegment(seg);

    // ── Step 4: DB dual-read — raw row 同样是 current 空、previous 在 ──
    const dbBundle = await readDbProject('test-e2e-project');
    const dbSeg = dbBundle!.segments.find((s) => s.id === keptSeg.id)!;
    const dbAudio = typeof dbSeg.audio === 'string' ? JSON.parse(dbSeg.audio) : dbSeg.audio;
    expect(dbAudio?.current).toBeFalsy();
    expect(dbAudio?.previous?.path).toBe(relAudioPath);

    // ── Step 5: filesystem — 新契约：被降级的音频文件保留在盘上
    //    （可撤销；孤儿文件的清理归后续 sweep）──
    expect(fs.existsSync(absAudioPath)).toBe(true);

    expect(errors).toEqual([]);
  });
});
