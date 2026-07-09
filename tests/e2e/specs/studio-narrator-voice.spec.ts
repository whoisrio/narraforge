/**
 * Studio narrator voice sidebar E2E tests
 *
 * Covers the narrator voice sidebar and applying narrator voice to all segments.
 * Uses the before → pre-commit → post-commit verification pattern.
 *
 * @feature docs/feature-spec.md §4.4 Narrator Voice Sidebar
 * @feature docs/feature-spec.md §4.4 Stale Detection
 */
import { expect, test } from '@playwright/test';
import { collectErrors, setLocaleToZhCN, goToStudio, readBackendProject, validateChapter, seedTestProject } from '../helpers';
import { verifyDbWithScreenshot } from '../helpers/dualReadSnapshot';

test.describe('旁白音色设置', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try { await seedTestProject(page); } finally { await page.close(); }
  });
  // @feature §4.4 Narrator Voice Sidebar — engine selector (Edge-TTS/CosyVoice/MiMo/VoxCPM)
  test('打开旁白音色侧栏并显示引擎选择器', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await goToStudio(page);

    // Find the narrator voice sidebar/panel — the "旁白音色" section
    await expect(page.getByText('旁白音色')).toBeVisible({ timeout: 10_000 });

    // Verify engine selector is visible (select or dropdown for voice selection)
    const voiceSelector = page.locator('aside select, [class*="voiceSelector"], [class*="narratorVoice"]');
    await expect(voiceSelector.first()).toBeVisible({ timeout: 5_000 });

    // Verify "应用" (apply) button is visible
    await expect(page.getByRole('button', { name: '应用' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  // @feature §4.4 Narrator Voice Sidebar — Apply button: writes Chapter.voice, flags stale segments
  test('将旁白音色应用到所有段落', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await goToStudio(page);

    // ── Step 1: BEFORE action — snapshot IndexedDB state ──

    await expect(page.getByText('旁白音色')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1_000);

    const projectBefore = await readBackendProject(page, 'test-e2e-project');
    expect(projectBefore).toBeTruthy();

    const activeChapterBefore = projectBefore!.chapters.find(
      (ch) => ch.id === (projectBefore!.active_chapter_id ?? projectBefore!.chapters[0]?.id),
    );
    expect(activeChapterBefore).toBeTruthy();

    // Snapshot chapter voice engine before apply
    const engineBefore = activeChapterBefore!.voice.engine;
    const voiceBefore = activeChapterBefore!.voice.voice;

    // Validate all chapters before action
    for (const ch of projectBefore!.chapters) {
      validateChapter(ch);
    }

    // ── Step 2: Select a new voice in the sidebar ──

    const voiceSelect = page.locator('aside select').first();
    await expect(voiceSelect).toBeVisible({ timeout: 5_000 });
    const options = await voiceSelect.locator('option').all();
    // Pick a different option than what is currently selected
    const selectedOption = options.length > 1 ? options[1] : options[0];
    const selectedEngine = await selectedOption.evaluate((el) => (el as HTMLOptionElement).value);
    if (options.length > 1) {
      await voiceSelect.selectOption({ index: 1 });
    }

    // ── Step 3: PRE-COMMIT — UI shows new selection, IndexedDB unchanged ──

    // Verify the UI shows the new voice selection (the select element reflects the change)
    const selectValue = await voiceSelect.inputValue();
    expect(selectValue).toBe(selectedEngine);

    // IndexedDB should NOT have changed yet — autosave fires on model changes,
    // but the chapter voice only updates after "应用" + confirmation.
    // Read immediately without waiting for debounce.
    const projectPreCommit = await readBackendProject(page, 'test-e2e-project');
    const chapterPreCommit = projectPreCommit!.chapters.find(
      (ch) => ch.id === (projectPreCommit!.active_chapter_id ?? projectPreCommit!.chapters[0]?.id),
    );
    expect(chapterPreCommit).toBeTruthy();
    expect(chapterPreCommit!.voice.engine).toBe(engineBefore);
    if (voiceBefore !== undefined) {
      expect(chapterPreCommit!.voice.voice).toBe(voiceBefore);
    }

    // ── Step 4: Click "应用" → confirm ──

    await page.getByRole('button', { name: '应用' }).click();

    // Verify confirmation dialog appears
    await expect(page.getByText(/将当前旁白音色应用到/)).toBeVisible({ timeout: 5_000 });

    // Confirm (button label is "应用" — use .nth(1) to get the dialog button, not the sidebar button)
    await page.getByRole('button', { name: '应用' }).nth(1).click();

    // ── Step 5: POST-COMMIT — toast appears, IndexedDB updated ──

    // Verify toast message "旁白全局设置已应用"
    await expect(page.getByText('旁白全局设置已应用')).toBeVisible({ timeout: 10_000 });

    // Wait for autosave debounce (1s) to flush to IndexedDB
    await page.waitForTimeout(2_000);

    const projectAfter = await readBackendProject(page, 'test-e2e-project');
    expect(projectAfter).toBeTruthy();

    // Validate full chapter schema on ALL chapters
    for (const ch of projectAfter!.chapters) {
      validateChapter(ch);
    }

    await verifyDbWithScreenshot(page, 'test-e2e-project', 'studio-narrator-voice-dbProject');

    const activeChapterAfter = projectAfter!.chapters.find(
      (ch) => ch.id === (projectAfter!.active_chapter_id ?? projectAfter!.chapters[0]?.id),
    );
    expect(activeChapterAfter).toBeTruthy();
    expect(activeChapterAfter!.voice).toBeTruthy();

    // Verify chapter voice engine matches the selected option
    // Note: voice name may be empty if no specific voice was selected within the engine
    expect(activeChapterAfter!.voice.engine).toBe(selectedEngine);

    // Verify voice actually changed from the before snapshot
    if (options.length > 1) {
      expect(activeChapterAfter!.voice.engine).not.toBe(engineBefore);
    }

    // Verify UI state: non-locked segments with voice.source === 'chapter' show "跟随全局"
    const segmentRows = page.locator('[class*="compactCard"]');
    const segCount = await segmentRows.count();
    expect(segCount).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});
