/**
 * Knowledge video workflow E2E tests.
 *
 * Covers (per spec §9.1, without running the full agent chain):
 *   1. Source document page shows both workflow entry points (生成旁白 / 知识视频)
 *   2. Storyboard (分镜) view renders animation_spec briefs — brief seeded via
 *      the apply-animation-spec API — with API + DB dual-layer verification.
 *
 * Adaptations vs the plan's literal spec:
 *   - Test 1 navigates via goToLibrary + 源文档 tab click: the library defaults
 *     to the 旁白文档 tab, so a single /源文档|文本库/ click would not reveal
 *     the workflow buttons.
 *   - `readDbProject` is async — awaited.
 *   - AFTER-UI re-opens the project via goToLibrary instead of page.reload():
 *     the SPA has no router, so reload returns to the landing page; a fresh
 *     project open refetches the project (including animation_spec).
 *
 * @feature docs/superpowers/plans/2026-07-21-knowledge-video-workflow.md (Task 19)
 */

import { test, expect } from '@playwright/test';
import {
  collectErrors,
  goToLibrary,
  openTestProject,
  readBackendProject,
  readBackendProjects,
  setLocaleToZhCN,
} from '../helpers';
import { readDbProject, validateDbProjectRow } from '../helpers/dbReader';
import { verifyDbWithScreenshot } from '../helpers/dualReadSnapshot';

const BACKEND = 'http://127.0.0.1:8002';

test.describe('知识视频工作流', () => {
  test.beforeEach(async ({ page }) => {
    await setLocaleToZhCN(page);
  });

  test('源文档页显示两种工作流入口', async ({ page }) => {
    const errors = collectErrors(page);
    await goToLibrary(page);

    // 打开 文本库 · 源文档 tab
    await page.getByRole('button', { name: '源文档', exact: true }).click();

    await expect(page.getByRole('button', { name: '生成旁白' })).toBeVisible();
    await expect(page.getByRole('button', { name: '知识视频' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('分镜视图展示 animation_spec 并按双层契约验证', async ({ page }) => {
    const errors = collectErrors(page);
    await openTestProject(page);

    // BEFORE: 读取种子项目
    const projects = await readBackendProjects(page);
    const testProject = projects.find((p: any) => p.name === 'test');
    expect(testProject).toBeTruthy();
    const before = await readBackendProject(page, testProject.id);
    const chapter = before.chapters[0];
    const segment = chapter.segments[0];
    expect(segment).toBeTruthy();

    // ACTION: 通过 API 预置 brief（模拟 gen_animation_brief 的写入）
    const brief = {
      segment_id: segment.id,
      start_sec: 0,
      end_sec: 4.2,
      narration_text: segment.text,
      visual_content: { type: 'code', description: '展示示例代码', source_ref: null },
      animation: { effect: 'typewriter', notes: '逐行打出' },
    };
    const resp = await page.request.post(
      `${BACKEND}/api/segmented-projects/${testProject.id}/apply-animation-spec`,
      { data: { theme: null, segments: [brief] } },
    );
    expect(resp.ok()).toBeTruthy();

    // AFTER-API: API 层验证 animation_spec 字段
    const after = await readBackendProject(page, testProject.id);
    const spec = after.chapters[0].segments[0].animation_spec;
    expect(spec.visual_content.type).toBe('code');
    expect(spec.animation.effect).toBe('typewriter');
    expect(spec.start_sec).toBe(0);

    // AFTER-DB: DB 层按 database-schema.md 契约验证
    const bundle = await readDbProject(testProject.id);
    validateDbProjectRow(bundle!);
    await verifyDbWithScreenshot(page, testProject.id, 'storyboard-spec-written');

    // AFTER-UI: 重新打开项目（前端需重新拉取 animation_spec），切到 分镜 tab
    await goToLibrary(page);
    await page.getByRole('button', { name: '分镜' }).click();
    const card = page.locator('[class*="storyboardCard"]').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('00:00 – 00:04');
    await expect(card).toContainText('展示示例代码');
    await expect(card).toContainText('typewriter');
    expect(errors).toEqual([]);
  });
});
