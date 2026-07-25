/**
 * Narration layer-sync Phase A + Phase B E2E.
 *
 * Phase A: split establishes a baseline (sync_state written)
 * -> editing a segment makes L3 dirty (sync-status flips, UI badge appears).
 *
 * Phase B: clicking the badge opens the sync modal; the user picks a sync
 * action (rewrite-script-from-segments / resplit-from-script) and the badge
 * clears. Verified across UI + API + DB (dual-read), including per-segment
 * split_anchor offsets.
 *
 * @feature docs/superpowers/specs/2026-07-25-narration-layer-sync-phase-a-design.md
 * @feature docs/superpowers/specs/2026-07-25-narration-layer-sync-phase-b-design.md
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
    const chapterBtn = await openProjectChapterList(page);
    // badge on the chapter-1 list item shows the dirty L3 layer label
    await expect(
      chapterBtn.getByRole('button', { name: '该章节文本已改动，与上下游不一致' }).getByText('分段', { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    expect(errors).toEqual([]);
  });
});

// ── Phase B helpers ──

/** 3 segments of 8 chars each, contiguous in the script (offsets 0/8/16). */
const SCRIPT = '夜色渐浓树影摇。远处犬吠破寂静。尾声落下夜幕垂。';
const SEG_TEXTS = ['夜色渐浓树影摇。', '远处犬吠破寂静。', '尾声落下夜幕垂。'];

interface AnchorShape { offset_start: number; offset_end: number; baseline_text: string }

function parseAnchor(raw: unknown): AnchorShape {
  const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return a as AnchorShape;
}

/** Set chapter narration_script = script via PUT, then rule-split it to (re)establish the L2/L3 baseline. */
async function establishBaseline(page: import('@playwright/test').Page, script: string) {
  const getResp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
  expect(getResp.ok()).toBeTruthy();
  const project = await getResp.json();
  const chapter = project.chapters.find((c: { id: string }) => c.id === CHAPTER_ID)!;
  chapter.narration_script = script;
  const putResp = await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
  expect(putResp.ok()).toBeTruthy();

  const splitResp = await page.request.post(
    `${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${CHAPTER_ID}/split`,
    { data: { text: script, mode: 'rule', replace_strategy: 'replace_chapter_segments' } },
  );
  expect(splitResp.ok()).toBeTruthy();

  const clean = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${CHAPTER_ID}/sync-status`);
  expect(await clean.json()).toEqual({ l1_dirty: false, l2_dirty: false, l3_dirty: false });
}

/** Navigate into the test project's studio and return the chapter-1 list button locator. */
async function openProjectChapterList(page: import('@playwright/test').Page) {
  await page.goto('/');
  await enterWorkspace(page);
  await page.getByRole('button', { name: /打开 test/ }).first().click();
  // the ProjectShell chapter list (with sync badges) renders in the studio/library sections
  await page.getByRole('button', { name: /工作室/ }).click();
  const chapterBtn = page.getByRole('button', { name: '选择章节 第1章 夜路' });
  await expect(chapterBtn).toBeVisible({ timeout: 15_000 });
  return chapterBtn;
}

test.describe('章节分层同步 Phase B', () => {
  test('L3 脏 -> 点 badge -> 以分段回写改写稿 -> badge 消失（UI + API + DB 锚点）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    // ── 1. baseline: narration_script + split (writes split_anchor per segment) ──
    await establishBaseline(page, SCRIPT);

    // DB: split_anchor offsets recorded correctly
    let db = await readDbProject(PROJECT_ID);
    let segs = db!.segments.filter((s) => s.chapter_id === CHAPTER_ID);
    expect(segs.map((s) => s.text)).toEqual(SEG_TEXTS);
    expect(segs.map((s) => parseAnchor(s.split_anchor))).toEqual([
      { offset_start: 0, offset_end: 8, baseline_text: SEG_TEXTS[0] },
      { offset_start: 8, offset_end: 16, baseline_text: SEG_TEXTS[1] },
      { offset_start: 16, offset_end: 24, baseline_text: SEG_TEXTS[2] },
    ]);

    // ── 2. edit segment 1 via PUT -> L3 dirty ──
    const EDITED = '犬吠声划破了夜空。'; // 9 chars (baseline was 8) to exercise offset shifting
    const getResp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const project = await getResp.json();
    const chapter = project.chapters.find((c: { id: string }) => c.id === CHAPTER_ID)!;
    chapter.segments[1].text = EDITED;
    const putResp = await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
    expect(putResp.ok()).toBeTruthy();

    const dirty = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${CHAPTER_ID}/sync-status`);
    expect(await dirty.json()).toEqual({ l1_dirty: false, l2_dirty: false, l3_dirty: true });

    // ── 3. UI: badge -> modal shows ONLY the rewrite action -> click it ──
    const chapterBtn = await openProjectChapterList(page);
    const badge = chapterBtn.getByRole('button', { name: '该章节文本已改动，与上下游不一致' });
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge.getByText('分段', { exact: true })).toBeVisible();
    await badge.click();

    const modal = page.getByRole('dialog', { name: '章节文本同步' });
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('button', { name: '以分段回写改写稿' })).toBeVisible();
    await expect(modal.getByRole('button', { name: '以改写稿重新拆分' })).toHaveCount(0);
    await expect(modal.getByText('改写稿和分段都改动了')).toHaveCount(0);

    await modal.getByRole('button', { name: '以分段回写改写稿' }).click();

    // ── 4. badge + modal gone; every layer clean ──
    await expect(modal).toBeHidden();
    await expect(badge).toBeHidden({ timeout: 10_000 });

    const clean = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${CHAPTER_ID}/sync-status`);
    expect(await clean.json()).toEqual({ l1_dirty: false, l2_dirty: false, l3_dirty: false });

    // ── 5. API + DB dual-read: L2 holds the merged text, anchors re-baselined ──
    const EXPECTED_SCRIPT = '夜色渐浓树影摇。犬吠声划破了夜空。尾声落下夜幕垂。';
    const afterResp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const after = await afterResp.json();
    const afterChapter = after.chapters.find((c: { id: string }) => c.id === CHAPTER_ID)!;
    expect(afterChapter.narration_script).toBe(EXPECTED_SCRIPT);
    expect(afterChapter.segments.map((s: { text: string }) => s.text)).toEqual([SEG_TEXTS[0], EDITED, SEG_TEXTS[2]]);

    db = await readDbProject(PROJECT_ID);
    const dbCh = db!.chapters.find((c) => c.id === CHAPTER_ID)!;
    expect(dbCh.narration_script).toBe(EXPECTED_SCRIPT);
    segs = db!.segments.filter((s) => s.chapter_id === CHAPTER_ID);
    expect(segs.map((s) => parseAnchor(s.split_anchor))).toEqual([
      { offset_start: 0, offset_end: 8, baseline_text: SEG_TEXTS[0] },
      { offset_start: 8, offset_end: 17, baseline_text: EDITED },
      { offset_start: 17, offset_end: 25, baseline_text: SEG_TEXTS[2] },
    ]);

    expect(errors).toEqual([]);
  });

  test('L2 脏 -> 点 badge -> 以改写稿重新拆分（确认后旧段 ID 丢弃）-> badge 消失', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    // ── 1. baseline, then edit L2 only -> l2_dirty ──
    await establishBaseline(page, SCRIPT);

    const getResp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const project = await getResp.json();
    const chapter = project.chapters.find((c: { id: string }) => c.id === CHAPTER_ID)!;
    const oldSegmentIds = chapter.segments.map((s: { id: string }) => s.id);
    const NEW_SCRIPT = '全新的改写稿第一段。全新的第二段内容。';
    chapter.narration_script = NEW_SCRIPT;
    const putResp = await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
    expect(putResp.ok()).toBeTruthy();

    const dirty = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${CHAPTER_ID}/sync-status`);
    expect(await dirty.json()).toEqual({ l1_dirty: false, l2_dirty: true, l3_dirty: false });

    // ── 2. UI: badge -> modal shows ONLY the resplit action -> confirm -> click ──
    const chapterBtn = await openProjectChapterList(page);
    const badge = chapterBtn.getByRole('button', { name: '该章节文本已改动，与上下游不一致' });
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge.getByText('改写稿', { exact: true })).toBeVisible();
    await badge.click();

    const modal = page.getByRole('dialog', { name: '章节文本同步' });
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('button', { name: '以改写稿重新拆分' })).toBeVisible();
    await expect(modal.getByRole('button', { name: '以分段回写改写稿' })).toHaveCount(0);

    // resplit requires a window.confirm; accept it
    page.on('dialog', (d) => void d.accept());
    await modal.getByRole('button', { name: '以改写稿重新拆分' }).click();

    // ── 3. badge + modal gone; layers clean; segments regenerated from new L2 ──
    await expect(modal).toBeHidden();
    await expect(badge).toBeHidden({ timeout: 10_000 });

    const clean = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${CHAPTER_ID}/sync-status`);
    expect(await clean.json()).toEqual({ l1_dirty: false, l2_dirty: false, l3_dirty: false });

    const NEW_SEG_TEXTS = ['全新的改写稿第一段。', '全新的第二段内容。'];
    const afterResp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const after = await afterResp.json();
    const afterChapter = after.chapters.find((c: { id: string }) => c.id === CHAPTER_ID)!;
    expect(afterChapter.narration_script).toBe(NEW_SCRIPT);
    expect(afterChapter.segments.map((s: { text: string }) => s.text)).toEqual(NEW_SEG_TEXTS);
    const newSegmentIds = afterChapter.segments.map((s: { id: string }) => s.id);
    for (const id of newSegmentIds) expect(oldSegmentIds).not.toContain(id);

    // DB dual-read: regenerated segments persisted with fresh anchors
    const db = await readDbProject(PROJECT_ID);
    const segs = db!.segments.filter((s) => s.chapter_id === CHAPTER_ID);
    expect(segs.map((s) => s.text)).toEqual(NEW_SEG_TEXTS);
    expect(segs.map((s) => parseAnchor(s.split_anchor))).toEqual([
      { offset_start: 0, offset_end: 10, baseline_text: NEW_SEG_TEXTS[0] },
      { offset_start: 10, offset_end: 19, baseline_text: NEW_SEG_TEXTS[1] },
    ]);

    expect(errors).toEqual([]);
  });
});
