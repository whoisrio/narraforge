import { expect, test } from '@playwright/test';

test('creates a role and opens dialogue view', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /角色库/ }).click();
  await expect(page.getByRole('dialog', { name: /角色库/ })).toBeVisible();
  await page.getByLabel(/角色名/).fill('林夏');
  await page.getByLabel(/默认音色/).fill('zh-CN-XiaoxiaoNeural');
  await page.getByRole('button', { name: /保存角色/ }).click();
  await expect(page.getByText('林夏')).toBeVisible();
  await page.getByRole('button', { name: /关闭/ }).click();
  await page.getByRole('button', { name: /对话视图/ }).click();
  await page.getByRole('button', { name: /新增台词/ }).click();
  await expect(page.getByText(/空台词/)).toBeVisible();
});
