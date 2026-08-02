/**
 * Chapter & segment reorder E2E tests.
 *
 * Verifies the full stack: UI up/down buttons -> reducer -> autosave PUT ->
 * backend reconcile -> DB `position` columns. Uses the dual-read pattern
 * (API contract + raw DB rows) and restores order after each test so the
 * shared seeded project is left untouched for other specs.
 *
 * @feature docs/feature-spec.md §4.4 Insert/delete/reorder segments
 * @feature docs/feature-spec.md §4.3 Chapter management (reorder)
 */
import { expect, test, type Page } from '@playwright/test';
import {
  collectErrors,
  setLocaleToZhCN,
  goToStudio,
  readBackendProject,
  seedTestProject,
} from '../helpers';
import { readDbProject } from '../helpers/dbReader';

const PROJECT_ID = 'test-e2e-project';

/** Clear any stale autosave draft for the project so each test starts clean. */
async function clearDraft(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('voice_clone_studio');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('project_drafts')) {
          db.close();
          resolve();
          return;
        }
        const tx = db.transaction('project_drafts', 'readwrite');
        tx.objectStore('project_drafts').clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
      };
      req.onerror = () => resolve();
    });
  });
}

/**
 * Poll the backend until the chapter order matches `expectedIds`, or throw.
 * The autosave is debounced (~1s); polling avoids fragile response matching.
 */
async function waitForChapterOrder(page: Page, expectedIds: string[]): Promise<void> {
  await expect.poll(
    async () => {
      const p = await readBackendProject(page, PROJECT_ID);
      return p?.chapters.map((c) => c.id) ?? [];
    },
    { timeout: 10_000, intervals: [300, 500, 800] },
  ).toEqual(expectedIds);
}

async function waitForSegmentOrder(
  page: Page,
  chapterId: string,
  expectedIds: string[],
): Promise<void> {
  await expect.poll(
    async () => {
      const p = await readBackendProject(page, PROJECT_ID);
      const ch = p?.chapters.find((c) => c.id === chapterId);
      return ch?.segments.map((s) => s.id) ?? [];
    },
    { timeout: 10_000, intervals: [300, 500, 800] },
  ).toEqual(expectedIds);
}

test.describe('调整顺序', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await seedTestProject(page);
    } finally {
      await page.close();
    }
  });

  test('章节上移：UI 顺序、API 与 DB position 三层一致', async ({ page }) => {
    await setLocaleToZhCN(page);
    await page.goto('/');
    await clearDraft(page);
    const errors = collectErrors(page);
    await goToStudio(page);

    const chapterList = page.locator('[data-chapter-card="compact"]');
    await expect(chapterList).toHaveCount(2, { timeout: 10_000 });

    // ── BEFORE: snapshot API + DB positions ──
    const before = await readBackendProject(page, PROJECT_ID);
    expect(before).toBeTruthy();
    const beforeOrder = before!.chapters.map((c) => c.id);
    expect(before!.chapters.map((c) => (c as { position?: number }).position)).toEqual([0, 1]);
    expect((await readDbProject(PROJECT_ID))!.chapters.map((c) => c.position)).toEqual([0, 1]);

    // ── ACTION: move the second chapter up (第2章 破庙) ──
    const secondRow = chapterList.nth(1);
    await secondRow.hover();
    await page.getByRole('button', { name: '上移章节 第2章 破庙' }).click();

    // ── UI: order swapped immediately (optimistic) ──
    await expect(chapterList.nth(0).getByText('第2章 破庙')).toBeVisible();

    // ── AFTER: API + DB converge on the new order with contiguous positions ──
    const swapped = [beforeOrder[1], beforeOrder[0]];
    await waitForChapterOrder(page, swapped);

    const after = await readBackendProject(page, PROJECT_ID);
    expect(after!.chapters.map((c) => (c as { position?: number }).position)).toEqual([0, 1]);
    const dbAfter = await readDbProject(PROJECT_ID);
    expect(dbAfter!.chapters.map((c) => c.id)).toEqual(swapped);
    expect(dbAfter!.chapters.map((c) => c.position)).toEqual([0, 1]);

    // ── RESTORE: move it back down ──
    await chapterList.nth(0).hover();
    await page.getByRole('button', { name: '下移章节 第2章 破庙' }).click();
    await waitForChapterOrder(page, beforeOrder);
    await expect(chapterList.nth(0).getByText('第1章 夜路')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('段落下移：UI 顺序、API 与 DB position 三层一致', async ({ page }) => {
    await setLocaleToZhCN(page);
    await page.goto('/');
    await clearDraft(page);
    const errors = collectErrors(page);
    await goToStudio(page);

    // Active chapter (第1章 夜路) is seeded with 3 segments.
    const segmentRows = page.locator('[class*="compactCard"]');
    await expect(segmentRows.first()).toBeVisible({ timeout: 10_000 });
    expect(await segmentRows.count()).toBeGreaterThanOrEqual(2);

    // ── BEFORE: snapshot API + DB segment positions for the active chapter ──
    const before = await readBackendProject(page, PROJECT_ID);
    expect(before).toBeTruthy();
    const activeCh = before!.chapters.find(
      (c) => c.id === (before!.active_chapter_id ?? before!.chapters[0]?.id),
    )!;
    const beforeSegIds = activeCh.segments.map((s) => s.id);
    expect(activeCh.segments.map((s) => (s as { position?: number }).position)).toEqual(
      beforeSegIds.map((_, i) => i),
    );

    // ── ACTION: move the first segment down ──
    await segmentRows.first().getByRole('button', { name: '下移段落' }).click();

    // ── UI: the original first segment is now second ──
    await expect(segmentRows.nth(0)).toContainText(activeCh.segments[1].text.slice(0, 6));
    await expect(segmentRows.nth(1)).toContainText(activeCh.segments[0].text.slice(0, 6));

    // ── AFTER: API + DB converge on the new order with contiguous positions ──
    const reordered = [beforeSegIds[1], beforeSegIds[0], ...beforeSegIds.slice(2)];
    await waitForSegmentOrder(page, activeCh.id, reordered);

    const after = await readBackendProject(page, PROJECT_ID);
    const activeChAfter = after!.chapters.find((c) => c.id === activeCh.id)!;
    expect(activeChAfter.segments.map((s) => (s as { position?: number }).position)).toEqual(
      activeChAfter.segments.map((_, i) => i),
    );

    const dbAfter = await readDbProject(PROJECT_ID);
    const dbSegs = dbAfter!.segments
      .filter((s) => s.chapter_id === activeCh.id)
      .sort((a, b) => a.position - b.position);
    expect(dbSegs.map((s) => s.id)).toEqual(reordered);
    expect(dbSegs.map((s) => s.position)).toEqual(dbSegs.map((_, i) => i));

    // ── RESTORE: move the new first segment (originally 2nd) back down ──
    await segmentRows.first().getByRole('button', { name: '下移段落' }).click();
    await waitForSegmentOrder(page, activeCh.id, beforeSegIds);

    expect(errors).toEqual([]);
  });
});
