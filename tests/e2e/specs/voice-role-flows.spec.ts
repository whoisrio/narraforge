/**
 * 音色角色全流程 E2E 测试
 *
 * 覆盖今天最脆弱的 3 条链路：
 *   1. MiMo 预置音色 → 创建角色 → 试听 → 保存
 *   2. 设计新音色   → 创建角色 → 试听 → 保存
 *   3. 编辑已有角色 → 试听音频正常渲染
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** 导航到 test 项目的角色管理页 */
async function goToRolePage(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /打开 test/ })).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /打开 test/ }).click();
  await expect(page.getByText('第1章 夜路', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /◌ 角色/ }).click();
  await expect(page.getByRole('heading', { name: /角色管理/ })).toBeVisible({ timeout: 10_000 });
}

/** 收集 console error */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

/* ------------------------------------------------------------------ */
/*  1. MiMo 预置音色 → 创建角色 → 试听 → 保存                            */
/* ------------------------------------------------------------------ */

test.describe('MiMo 预置音色角色创建', () => {
  test('选择 MiMo 预置音色创建角色，试听并保存', async ({ page }) => {
    const errors = collectErrors(page);
    await goToRolePage(page);

    // 打开编辑器 — 应看到音色来源面板
    await page.getByRole('button', { name: /创建角色/ }).click();
    await expect(page.getByRole('heading', { name: '音色来源' })).toBeVisible({ timeout: 5_000 });

    // 设置角色名
    const nameInput = page.getByLabel(/角色名/);
    await nameInput.fill('E2E-预置测试');

    // 确认在预置音色 tab（默认）
    await expect(page.getByRole('radio', { name: '模型预制音色' })).toBeChecked();

    // 点击 MiMo 引擎 pill
    await page.getByRole('button', { name: 'MiMo' }).click();

    // 选择第一个有效的 MiMo 预置音色（下拉框在预置音色段落内）
    const mimoSelect = page.locator('select').filter({ has: page.locator('option') }).last();
    const options = await mimoSelect.locator('option').all();
    await mimoSelect.selectOption({ index: 1 });
    const selectedValue = await mimoSelect.inputValue();
    expect(selectedValue).toBeTruthy();

    // 点击"生成试听"
    await page.getByRole('button', { name: '生成试听' }).click();

    // 等待试听完成（"生成中..." 消失）
    await expect(page.getByText('正在生成试听音频...')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('正在生成试听音频...')).not.toBeVisible({ timeout: 60_000 });

    // 不应有 console error（尤其不能有 404）
    expect(errors.filter(e => e.includes('preview-audio')).length).toBe(0);

    // 保存角色
    await page.getByRole('button', { name: '保存角色' }).click();

    // 编辑器关闭，回到角色管理页
    await expect(page.getByRole('heading', { name: '角色管理' })).toBeVisible({ timeout: 5_000 });
  });
});

/* ------------------------------------------------------------------ */
/*  2. 设计新音色 → 创建角色 → 试听 → 保存                               */
/* ------------------------------------------------------------------ */

test.describe('设计新音色角色创建', () => {
  test('设计新音色创建角色，试听并保存', async ({ page }) => {
    const errors = collectErrors(page);
    await goToRolePage(page);

    // 创建新角色
    await page.getByRole('button', { name: /创建角色/ }).click();
    await expect(page.getByRole('heading', { name: '音色来源' })).toBeVisible({ timeout: 5_000 });

    // 切换到"设计新音色" tab
    await page.getByRole('radio', { name: '设计新音色' }).click();

    // 设置角色名
    const nameInput = page.getByLabel(/角色名/);
    await nameInput.fill('E2E-设计测试');

    // 确认 MiMo pill 已选中
    await expect(page.getByRole('button', { name: 'MiMo' })).toBeVisible();

    // 输入音色描述
    const description = '年轻女性，声音甜美，语速适中';
    const textarea = page.getByPlaceholder(/描述你想要的音色/);
    await textarea.fill(description);
    expect(await textarea.inputValue()).toBe(description);

    // 点击"试听音色"
    await page.getByRole('button', { name: '试听音色' }).click();

    // 等待生成完成
    await expect(page.getByText('生成中...')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('生成中...')).not.toBeVisible({ timeout: 60_000 });

    // 点击"确认保存音色"
    await page.getByRole('button', { name: '确认保存音色' }).click();

    // 点击"保存角色"
    await page.getByRole('button', { name: '保存角色' }).click();

    // 编辑器关闭
    await expect(page.getByRole('heading', { name: /角色管理/ })).toBeVisible({ timeout: 5_000 });
    expect(errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  3. 编辑已有角色 → 试听音频正常                                        */
/* ------------------------------------------------------------------ */

test.describe('编辑已有角色试听', () => {
  test('编辑小明角色，设计试听音频正常渲染', async ({ page }) => {
    const errors = collectErrors(page);
    await goToRolePage(page);

    // 编辑"小明"（design 音色）
    await page.getByRole('button', { name: /编辑 小明/ }).click();
    await expect(page.getByRole('heading', { name: '音色来源' })).toBeVisible({ timeout: 5_000 });

    // 等待 VoiceProfile 加载 → design 面板显示已保存的试听音频
    await page.waitForTimeout(3000);

    // Studio Playback 区域应有音频播放器（design 音色已保存 preview）
    const audioElements = page.locator('aside audio');
    await expect(audioElements.first()).toBeAttached({ timeout: 10_000 });

    // 不应有 console error
    expect(errors).toEqual([]);

    // 关闭编辑器
    await page.getByRole('button', { name: /取消/ }).click();
    await expect(page.getByRole('heading', { name: '角色管理' })).toBeVisible({ timeout: 5_000 });
  });
});
