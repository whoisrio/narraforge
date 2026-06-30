/**
 * V3 数据模型重构后的 e2e 冒烟测试。
 * 验证核心页面在真实后端 + 前端环境下能正常渲染，无 console 报错。
 */

import { expect, test } from '@playwright/test';

/* ------------------------------------------------------------------ */
/*  Voice Design Studio (音色设计 / 工作室)                              */
/* ------------------------------------------------------------------ */

test.describe('Voice Design Studio (音色设计)', () => {
  test('navigates to voice design page and shows profiles', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');

    // 点击全局导航的"音色设计"
    await page.getByRole('button', { name: /音色设计/ }).click();

    // 等待页面渲染
    await expect(page.getByRole('heading', { name: /音色设计/ })).toBeVisible({ timeout: 10_000 });

    // 应有音色档案区域
    await expect(page.getByRole('heading', { name: /音色档案/ })).toBeVisible();

    // 应有操作按钮
    await expect(page.getByRole('button', { name: /设计新音色/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /克隆声音/ })).toBeVisible();

    // 不应有 console error
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Project Role Page (角色)                                           */
/* ------------------------------------------------------------------ */

test.describe('Project Role Page (项目角色)', () => {
  test('opens project and navigates to role management', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');

    // 等待项目列表加载
    await expect(page.getByRole('button', { name: /打开 test/ })).toBeVisible({ timeout: 10_000 });

    // 打开 test 项目
    await page.getByRole('button', { name: /打开 test/ }).click();

    // 等待项目加载 — 应看到章节标题
    await expect(page.getByText('第1章 夜路', { exact: true })).toBeVisible({ timeout: 15_000 });

    // 点击"角色"导航
    await page.getByRole('button', { name: /◌ 角色/ }).click();

    // 应看到角色管理面板
    await expect(page.getByRole('heading', { name: /角色管理/ })).toBeVisible({ timeout: 10_000 });

    // 应看到角色列表
    await expect(page.getByRole('button', { name: /编辑 小明/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /编辑 小红/ })).toBeVisible();

    // 应有创建角色按钮
    await expect(page.getByRole('button', { name: /创建角色/ })).toBeVisible();

    // 不应有 console error
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Global Role Library (全局角色库)                                     */
/* ------------------------------------------------------------------ */

test.describe('Global Role Library (全局角色库)', () => {
  test('opens role library panel from project role page', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');

    // 打开 test 项目
    await page.getByRole('button', { name: /打开 test/ }).click();
    await expect(page.getByText('第1章 夜路', { exact: true })).toBeVisible({ timeout: 15_000 });

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

    // 不应有 console error
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Project Overview (总览)                                            */
/* ------------------------------------------------------------------ */

test.describe('Project Overview (总览)', () => {
  test('opens project and shows overview with chapters', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');

    // 打开 test 项目
    await page.getByRole('button', { name: /打开 test/ }).click();

    // 等待项目加载
    await expect(page.getByText('第1章 夜路', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('第2章 破庙', { exact: true })).toBeVisible();

    // 应显示 Active Cast 角色（可能有多个匹配，用 first()）
    await expect(page.getByText(/小明/).first()).toBeVisible();
    await expect(page.getByText(/小红/).first()).toBeVisible();

    // 不应有 console error
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Project Studio (项目工作室 - VoiceStudioLayout)                      */
/* ------------------------------------------------------------------ */

test.describe('Project Studio (项目工作室)', () => {
  test('opens project and navigates to studio with segments', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');

    // 打开 test 项目
    await page.getByRole('button', { name: /打开 test/ }).click();
    await expect(page.getByText('第1章 夜路', { exact: true })).toBeVisible({ timeout: 15_000 });

    // 导航到工作室
    await page.getByRole('button', { name: /◉ 工作室/ }).click();

    // 应看到批量合成按钮（工作室核心操作）
    await expect(page.getByRole('button', { name: /批量合成/ })).toBeVisible({ timeout: 15_000 });

    // 应显示 segment 行
    await expect(page.getByText(/8 段/).first()).toBeVisible();

    // 不应有 console error
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Voice toggle behavior (旁白/角色 toggle)                            */
/* ------------------------------------------------------------------ */

test.describe('Segment voice toggle', () => {
  test('studio page renders voice lock icons on segment rows', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.getByRole('button', { name: /打开 test/ }).click();
    await page.getByRole('button', { name: /◉ 工作室/ }).click();
    await expect(page.getByRole('button', { name: /批量合成/ })).toBeVisible({ timeout: 15_000 });

    // Should see voice lock icons on segment rows
    const lockIcons = page.locator('[class*="compactVoiceLock"]');
    const count = await lockIcons.count();
    expect(count).toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});
