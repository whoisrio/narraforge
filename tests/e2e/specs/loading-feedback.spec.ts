/**
 * 全局加载反馈（Loading Feedback）E2E
 *
 * 对应设计文档：docs/superpowers/specs/2026-09-02-loading-feedback-design.md §8
 *
 * 核心场景：用 CDP 网络节流（慢 3G）人为拖慢后端读操作，触发 LoadingProvider
 * 的模态阻断（delayMs=250ms 后浮现）。断言：
 *   1. 打开项目期间模态出现且文案正确（正在打开项目 {name}）；
 *   2. 数据到达后模态消失、编辑器可交互；
 *   3. 模态不可手动关闭（无关闭按钮、点遮罩无效）——设计明确要求"不可关闭"。
 *
 * 注意：本 spec 不依赖 agent（langgraph）服务，运行配置中已移除 agent webServer。
 *
 * @feature docs/superpowers/specs/2026-09-02-loading-feedback-design.md
 */
import { expect, test } from '@playwright/test';
import { enterWorkspace, setLocaleToZhCN } from '../helpers';

// Slow 3G 参数（DevTools 预设）：高延迟 + 低吞吐，确保后端读操作 > 250ms 触发模态。
const SLOW_3G = {
  offline: false,
  latency: 400,
  downloadThroughput: 50 * 1024, // ~50 KB/s
  uploadThroughput: 50 * 1024,
};

/** 进入工作台并等待「打开 test」按钮可见（不节流，首屏列表加载快速完成）。 */
async function gotoProjectHub(page: import('@playwright/test').Page) {
  await setLocaleToZhCN(page);
  await page.goto('/');
  await enterWorkspace(page);
  const openBtn = page.getByRole('button', { name: /打开 test/ }).first();
  await expect(openBtn).toBeVisible({ timeout: 15_000 });
  return openBtn;
}

test.describe('全局加载反馈', () => {
  // @feature §8 E2E — 打开项目：慢网络下模态出现且文案正确，数据到达后消失、编辑器可交互
  test('打开项目：慢网络下模态出现且文案正确，数据到达后消失、编辑器可交互', async ({ page }) => {
    const openBtn = await gotoProjectHub(page);

    // 节流网络，让后端 getProject 超过模态延迟阈值（250ms）
    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', SLOW_3G);

    await openBtn.click();

    // 模态应浮现（role=dialog + aria-busy 标记加载中）
    const modal = page.locator('[role="dialog"][aria-busy="true"]');
    await expect(modal).toBeVisible({ timeout: 8_000 });
    await expect(modal).toHaveAttribute('aria-modal', 'true');

    // 文案应为「正在打开项目 test…」（或外层「正在获取项目列表…」）
    await expect(modal).toContainText(/正在(获取项目列表|打开项目)/);
    // 打开项目文案携带项目名，作为强信号
    await expect(modal).toContainText('test');

    // 数据到达后模态消失
    await expect(modal).toBeHidden({ timeout: 30_000 });

    // 编辑器可交互：章节内容已渲染
    await expect(page.getByText('第1章 夜路', { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  // @feature §8 E2E — 模态不可手动关闭（无关闭按钮、点遮罩无效）
  test('打开项目：加载模态不可手动关闭', async ({ page }) => {
    const openBtn = await gotoProjectHub(page);

    const client = await page.context().newCDPSession(page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', SLOW_3G);

    await openBtn.click();

    const modal = page.locator('[role="dialog"][aria-busy="true"]');
    await expect(modal).toBeVisible({ timeout: 8_000 });

    // 未达 30s 重试阈值，模态内不应有任何按钮（尤其无"关闭"按钮）
    await expect(modal.getByRole('button')).toHaveCount(0);

    // 点击遮罩（对话框外侧）不应关闭模态
    await page.mouse.click(5, 5);
    await expect(modal).toBeVisible({ timeout: 3_000 });

    // 数据到达后仍在预期内消失
    await expect(modal).toBeHidden({ timeout: 30_000 });
  });
});
