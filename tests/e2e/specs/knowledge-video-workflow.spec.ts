/**
 * Knowledge video workflow E2E tests.
 *
 * Covers (per spec §9.1, without running the full agent chain):
 *   1. Source document view shows both workflow entry points (生成旁白 / 知识视频)
 *   2. animation_spec brief persistence — brief seeded via the apply-animation-spec
 *      API — with API + DB dual-layer verification.
 *      （分镜视图 UI 断言随 Library 文档优先重构暂停：入口已从切换器移除，组件保留。）
 *
 * Adaptations vs the plan's literal spec:
 *   - Test 1 navigates via goToLibrary + 源文档 switcher click: the library
 *     defaults to the doc (全文) view, so the source view must be selected first.
 *   - `readDbProject` is async — awaited.
 *
 * @feature docs/superpowers/plans/2026-07-21-knowledge-video-workflow.md (Task 19)
 */

import { test, expect } from '@playwright/test';
import { E2E_BACKEND_URL } from '../helpers/ports';
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

const BACKEND = E2E_BACKEND_URL;

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

    // 注：分镜（StoryboardPanel）入口已随 Library 文档优先重构（B1）从切换器
    // 移除，组件代码保留；UI 层断言待入口恢复时回补。
    expect(errors).toEqual([]);
  });
});
