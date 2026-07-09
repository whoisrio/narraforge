/**
 * Project pages E2E smoke tests.
 * Verifies core pages render correctly under real backend + frontend environment, no console errors.
 * Enhanced with data-layer verification: after UI assertions, each test
 * reads backend and validates JSON schemas where applicable.
 *
 * @feature docs/feature-spec.md §3 Voice Design
 * @feature docs/feature-spec.md §4.2 ProjectShell Sections
 * @feature docs/feature-spec.md §4.4 Studio — Segmented Editor
 * @feature docs/feature-spec.md §4.6 Voices — Role Management
 */

import { expect, test } from '@playwright/test';
import {
  setLocaleToZhCN,
  openTestProject,
  goToStudio,
  goToVoiceDesign,
  collectErrors,
  readBackendProject,
  readBackendProjects,
  validateChapter,
  validateSegment,
  validateVoiceSource,
} from '../helpers';
import { readDbProjects } from '../helpers/dbReader';
import { verifyDbWithScreenshot } from '../helpers/dualReadSnapshot';

/* ------------------------------------------------------------------ */
/*  Voice Design Studio (音色设计 / 工作室)                              */
/* ------------------------------------------------------------------ */

test.describe('音色设计', () => {
  // @feature §3.1 Page Structure — voice design page title and panels
  // @feature §3.5 Voice Profile Cards — card grid with preview buttons
  test('导航到音色设计页面并显示音色列表', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await goToVoiceDesign(page);

    // 应有音色档案区域
    await expect(page.getByRole('heading', { name: /音色档案/ })).toBeVisible();

    // 应有操作按钮
    await expect(page.getByRole('button', { name: /设计新音色/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /克隆声音/ })).toBeVisible();

    // ── Data-layer verification: page loads cleanly ──

    // Voice design page is not project-scoped, so just verify no IndexedDB corruption.
    // Read projects to ensure IndexedDB is accessible (no crash on page load).
    const projects = await readBackendProjects(page);
    // Projects may or may not exist — the key assertion is that reading did not throw.
    expect(Array.isArray(projects)).toBe(true);

    // Dual-read: DB layer
    const dbProjects = await readDbProjects();
    expect(Array.isArray(dbProjects)).toBe(true);

    // 不应有 console error
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Project Role Page (角色)                                           */
/* ------------------------------------------------------------------ */

test.describe('项目角色', () => {
  // @feature §4.6 Voices — Role Management — narrator + cast roles
  test('打开项目并导航到角色管理', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await openTestProject(page);

    // 点击"角色"导航
    await page.getByRole('button', { name: /◌ 角色/ }).click();

    // 应看到角色管理面板
    await expect(page.getByRole('heading', { name: /角色管理/ })).toBeVisible({ timeout: 10_000 });

    // 应看到角色列表
    await expect(page.getByRole('button', { name: /编辑 小明/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /编辑 小红/ })).toBeVisible();

    // 应有创建角色按钮
    await expect(page.getByRole('button', { name: /创建角色/ })).toBeVisible();

    // ── Data-layer verification: project and chapters exist in IndexedDB ──

    await page.waitForTimeout(1_000);
    const project = await readBackendProject(page, 'test-e2e-project');
    expect(project).toBeTruthy();
    expect(project!.chapters.length).toBeGreaterThan(0);

    // Validate every chapter has valid voice EngineParams and segments
    for (const ch of project!.chapters) {
      validateChapter(ch);
    }

    await verifyDbWithScreenshot(page, 'test-e2e-project', 'project-pages-dbProject');

    // 不应有 console error
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Global Role Library (全局角色库)                                     */
/* ------------------------------------------------------------------ */

test.describe('全局角色库', () => {
  // @feature §4.6 Voices — Role Management — global role library
  test('从项目角色页打开角色库面板', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await openTestProject(page);

    // 导航到角色页
    await page.getByRole('button', { name: /◌ 角色/ }).click();
    await expect(page.getByRole('heading', { name: /角色管理/ })).toBeVisible({ timeout: 10_000 });

    // 打开全局角色库
    await page.getByRole('button', { name: /角色库/ }).click();

    // 应弹出角色库对话框
    await expect(page.getByRole('dialog', { name: /全局角色库/ })).toBeVisible({ timeout: 5_000 });

    // 应有表单字段
    await expect(page.getByLabel(/角色名/)).toBeVisible();
    await expect(page.getByLabel(/引擎/)).toBeVisible();

    // 应显示现有角色列表（dialog 内部）
    await expect(page.getByText(/小明/).first()).toBeVisible();
    await expect(page.getByText(/小红/).first()).toBeVisible();

    // ── Data-layer verification: roles loaded with valid voice params ──

    // The role library dialog shows roles from the backend API.
    // Intercept the roles API response to verify voice EngineParams structure.
    // Since the dialog is already open and roles are rendered, verify the
    // project data in IndexedDB has chapters with valid voice configs.
    await page.waitForTimeout(1_000);
    const project = await readBackendProject(page, 'test-e2e-project');
    expect(project).toBeTruthy();

    // Validate all chapters have valid EngineParams in their voice field
    for (const ch of project!.chapters) {
      validateChapter(ch);
    }

    await verifyDbWithScreenshot(page, 'test-e2e-project', 'project-pages-dbProjectRl');

    // 不应有 console error
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Project Overview (总览)                                            */
/* ------------------------------------------------------------------ */

test.describe('项目总览', () => {
  // @feature §4.2 ProjectShell Sections — Overview: chapter list, narrator info
  test('打开项目并显示章节总览', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await openTestProject(page);

    await expect(page.getByText('第2章 破庙', { exact: true })).toBeVisible();

    // 应显示 Active Cast 角色（可能有多个匹配，用 first()）
    await expect(page.getByText(/小明/).first()).toBeVisible();
    await expect(page.getByText(/小红/).first()).toBeVisible();

    // ── Data-layer verification: chapters in backend match UI ──

    await page.waitForTimeout(1_000);
    const project = await readBackendProject(page, 'test-e2e-project');
    expect(project).toBeTruthy();
    expect(project!.chapters.length).toBeGreaterThan(0);

    // The overview shows "第2章 破庙" — verify a chapter with matching name exists
    const chapterNames = project!.chapters.map((ch) => ch.name);
    const hasMatchingChapter = chapterNames.some((name) => name.includes('破庙'));
    expect(hasMatchingChapter).toBe(true);

    // Validate all chapters with full JSON schema
    for (const ch of project!.chapters) {
      validateChapter(ch);
    }

    await verifyDbWithScreenshot(page, 'test-e2e-project', 'project-pages-dbProjectOv');

    // 不应有 console error
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Project Studio (项目工作室 - VoiceStudioLayout)                      */
/* ------------------------------------------------------------------ */

test.describe('项目工作室', () => {
  // @feature §4.4 Studio — Segmented Editor — segment rows, batch controls
  test('打开项目并导航到带段落的配音工作室', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await goToStudio(page);

    // 应显示 segment 行 — match any "N 段" pattern since segment count depends on seed data
    await expect(page.getByText(/\d+ 段/).first()).toBeVisible();

    // ── Data-layer verification: segments exist in IndexedDB ──

    await page.waitForTimeout(1_000);
    const project = await readBackendProject(page, 'test-e2e-project');
    expect(project).toBeTruthy();

    const activeChapter = project!.chapters.find(
      (ch) => ch.id === (project!.active_chapter_id ?? project!.chapters[0]?.id),
    );
    expect(activeChapter).toBeTruthy();
    expect(activeChapter!.segments.length).toBeGreaterThan(0);

    // Validate active chapter with full schema (voice EngineParams + all segments)
    validateChapter(activeChapter!);

    await verifyDbWithScreenshot(page, 'test-e2e-project', 'project-pages-dbProjectSt');

    // 不应有 console error
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Voice toggle behavior (旁白/角色 toggle)                            */
/* ------------------------------------------------------------------ */

test.describe('段落语音切换', () => {
  // @feature §4.4 Per-Segment Voice Source — lock toggle (🔗↔🔒)
  test('工作室页面在段落行上渲染语音锁图标', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await goToStudio(page);

    // Should see voice lock icons on segment rows
    const lockIcons = page.locator('[class*="compactVoiceLock"]');
    const count = await lockIcons.count();
    expect(count).toBeGreaterThan(0);

    // ── Data-layer verification: segment voice.source in IndexedDB ──

    await page.waitForTimeout(1_000);
    const project = await readBackendProject(page, 'test-e2e-project');
    expect(project).toBeTruthy();

    const activeChapter = project!.chapters.find(
      (ch) => ch.id === (project!.active_chapter_id ?? project!.chapters[0]?.id),
    );
    expect(activeChapter).toBeTruthy();
    expect(activeChapter!.segments.length).toBeGreaterThan(0);

    // Validate each segment has a valid voice source (chapter, role, or custom)
    for (const seg of activeChapter!.segments) {
      validateSegment(seg);
      validateVoiceSource(seg.voice as Record<string, unknown>, `segment "${seg.id}".voice`);
    }

    await verifyDbWithScreenshot(page, 'test-e2e-project', 'project-pages-dbProjectVt');

    expect(errors).toEqual([]);
  });
});
