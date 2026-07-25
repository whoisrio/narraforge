/**
 * Narration layer-sync Phase A E2E.
 *
 * Verifies the full stack: split establishes a baseline (sync_state written)
 * -> editing a segment makes L3 dirty (sync-status flips, UI badge appears).
 *
 * @feature docs/superpowers/specs/2026-07-25-narration-layer-sync-phase-a-design.md
 */
import { expect, test } from '@playwright/test';
import { collectErrors, setLocaleToZhCN, enterWorkspace, readBackendProject } from '../helpers';
import { readDbProject } from '../helpers/dbReader';

const BACKEND = 'http://127.0.0.1:8002';
const PROJECT_ID = 'test-e2e-project';
const CHAPTER_ID = 'test-chapter-1';

test.describe('章节分层同步 Phase A', () => {
  test('split 建基线 -> 编辑段 -> L3 脏（API + DB + UI badge）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    // ── 1. re-split chapter 1 to establish the L2/L3 baseline ──
    const splitResp = await page.request.post(
      `${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${CHAPTER_ID}/split`,
      { data: { text: '夜色渐浓，小路两旁的树影摇曳。', mode: 'rule', replace_strategy: 'replace_chapter_segments' } },
    );
    expect(splitResp.ok()).toBeTruthy();

    // ── 2. baseline written + sync-status clean ──
    const clean = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${CHAPTER_ID}/sync-status`);
    expect(await clean.json()).toEqual({ l1_dirty: false, l2_dirty: false, l3_dirty: false });

    const dbBundle = await readDbProject(PROJECT_ID);
    const ch = dbBundle?.chapters.find((c) => c.id === CHAPTER_ID);
    const rawSt = ch?.sync_state;
    const st = rawSt ? (typeof rawSt === 'string' ? JSON.parse(rawSt) : rawSt) : null;
    expect(st).toBeTruthy();
    expect(st!.l2_hash).toBeTruthy();
    expect(st!.segments_hash).toBeTruthy();

    // ── 3. edit a segment text via PUT (full project) -> L3 dirty ──
    const getResp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    expect(getResp.ok()).toBeTruthy();
    const project = await getResp.json();
    const chapter = project.chapters.find((c: { id: string }) => c.id === CHAPTER_ID)!;
    chapter.segments[0].text = '夜色渐浓，树影摇曳（已编辑）。';
    const putResp = await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
    expect(putResp.ok()).toBeTruthy();

    const dirty = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${CHAPTER_ID}/sync-status`);
    const dirtyBody = await dirty.json();
    expect(dirtyBody.l3_dirty).toBe(true);
    expect(dirtyBody.l2_dirty).toBe(false);

    // ── 4. UI badge appears on the chapter in the studio chapter list ──
    await page.goto('/');
    await enterWorkspace(page);
    await page.getByRole('button', { name: /打开 test/ }).first().click();
    // studio section shows the ProjectShell chapter list with the L3 badge
    await expect(page.getByText('第1章 夜路', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('分段').first()).toBeVisible({ timeout: 10_000 });

    expect(errors).toEqual([]);
  });
});
