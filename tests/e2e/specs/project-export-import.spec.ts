/**
 * Project export/import E2E.
 *
 * Verifies the full stack: UI export (download) -> UI import (file upload) ->
 * new project created with same chapters/segments, original untouched.
 * Dual-read: API list + raw DB rows.
 *
 * @feature docs/superpowers/specs/2026-07-25-project-export-import-design.md
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectErrors, setLocaleToZhCN, enterWorkspace, readBackendProjects } from '../helpers';
import { readDbProjects } from '../helpers/dbReader';

const BACKEND = 'http://127.0.0.1:8012';
const SOURCE_PROJECT_ID = 'test-e2e-project';

test.describe('项目导出 / 导入', () => {
  test('UI 导出后导入为新项目，原项目保留（API + DB 双层验证）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    await page.goto('/');
    await enterWorkspace(page);

    // ── BEFORE: capture project count + source project chapters ──
    const before = await readBackendProjects(page);
    const countBefore = before.length;
    const sourceDetail = await page.request.get(`${BACKEND}/api/segmented-projects/${SOURCE_PROJECT_ID}`);
    expect(sourceDetail.ok()).toBeTruthy();
    const sourceJson = await sourceDetail.json();
    const sourceChapterCount = sourceJson.chapters.length;
    const sourceSegmentTexts = sourceJson.chapters
      .flatMap((c: { segments: Array<{ text: string }> }) => c.segments.map((s) => s.text));

    // ── ACTION 1: export via UI (action menu -> 导出项目) ──
    const card = page.getByLabel(`项目 ${sourceJson.name}`);
    await card.getByRole('button', { name: /项目操作/ }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /导出项目/ }).click();
    const download = await downloadPromise;
    const zipPath = path.join(os.tmpdir(), `narraforge-e2e-export-${Date.now()}.zip`);
    await download.saveAs(zipPath);
    expect(fs.existsSync(zipPath)).toBeTruthy();
    expect(fs.statSync(zipPath).size).toBeGreaterThan(0);

    // ── ACTION 2: import via UI (导入项目 -> file input) ──
    await page.getByLabel(/导入项目/).setInputFiles(zipPath);

    // ── AFTER: new project appears, count +1 ──
    await expect.poll(async () => {
      const list = await readBackendProjects(page);
      return list.length;
    }, { timeout: 15_000 }).toBe(countBefore + 1);

    const after = await readBackendProjects(page);
    const imported = after.find((p) => p.id !== SOURCE_PROJECT_ID && p.name === sourceJson.name);
    expect(imported, 'imported project should exist').toBeTruthy();

    // ── DUAL-READ: DB layer ──
    const dbProjects = await readDbProjects();
    expect(dbProjects.some((p) => p.id === imported!.id)).toBeTruthy();
    expect(dbProjects.some((p) => p.id === SOURCE_PROJECT_ID)).toBeTruthy();

    // ── content fidelity: same chapters + segment texts ──
    const importedDetail = await page.request.get(`${BACKEND}/api/segmented-projects/${imported!.id}`);
    expect(importedDetail.ok()).toBeTruthy();
    const importedJson = await importedDetail.json();
    expect(importedJson.chapters.length).toBe(sourceChapterCount);
    const importedSegmentTexts = importedJson.chapters
      .flatMap((c: { segments: Array<{ text: string }> }) => c.segments.map((s) => s.text));
    expect(importedSegmentTexts).toEqual(sourceSegmentTexts);
    // remotion_project_path reset on import
    expect(importedJson.remotion_project_path).toBeNull();

    // ── original untouched ──
    const originalAgain = await page.request.get(`${BACKEND}/api/segmented-projects/${SOURCE_PROJECT_ID}`);
    expect(originalAgain.ok()).toBeTruthy();
    expect((await originalAgain.json()).id).toBe(SOURCE_PROJECT_ID);

    expect(errors).toEqual([]);
  });
});
