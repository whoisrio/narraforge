/**
 * Narration git push E2E.
 *
 * Sets a remote (local bare repo) via the /settings UI -> clicks
 * "commit & push now" -> verifies the bare remote received a commit and the
 * remote URL persisted in the DB.
 *
 * @feature docs/superpowers/specs/2026-07-25-narration-git-push-design.md
 */
import { expect, test } from '@playwright/test';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectErrors, setLocaleToZhCN, enterWorkspace } from '../helpers';
import { readDbSystemConfig } from '../helpers/dbReader';

test.describe('Narration Git 版本管理', () => {
  test('UI 配置远端 -> 立即提交并推送 -> 远端收到 commit（API + DB 双层验证）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    // local bare remote
    const remote = path.join(os.tmpdir(), `narraforge-e2e-remote-${Date.now()}.git`);
    cp.execSync(`git init --bare -q "${remote}"`);

    await page.goto('/');
    await enterWorkspace(page);
    await page.locator('aside[aria-label="Global navigation"]').getByRole('button', { name: /设置/ }).click();

    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: /Narration Git 版本管理/ }) });
    await expect(section).toBeVisible({ timeout: 10_000 });

    // set remote + save
    const input = section.getByLabel('远端仓库地址');
    await input.fill(remote);
    await expect(input).toHaveValue(remote);
    await section.getByRole('button', { name: '保存' }).click();
    await expect(section.getByText('已保存')).toBeVisible({ timeout: 5_000 });
    await expect(input).toHaveValue(remote);
    expect(await readDbSystemConfig('narration_git_remote')).toBe(remote);

    // commit & push now
    await section.getByRole('button', { name: /立即提交并推送/ }).click();
    await expect(section.getByText('已提交并推送')).toBeVisible({ timeout: 20_000 });

    // ── remote received a commit ──
    const log = cp.execSync(`git --git-dir="${remote}" log --all --pretty=%s`, { encoding: 'utf-8' });
    expect(log).toContain('snapshot:');

    // ── DB: remote URL persisted ──
    const dbValue = await readDbSystemConfig('narration_git_remote');
    expect(dbValue).toBe(remote);

    expect(errors).toEqual([]);
  });

  test('只输入远端不点保存 -> 立即提交并推送会持久化并使用当前输入', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    const remote = path.join(os.tmpdir(), `narraforge-e2e-remote-direct-${Date.now()}.git`);
    cp.execSync(`git init --bare -q "${remote}"`);

    await page.goto('/');
    await enterWorkspace(page);
    await page.locator('aside[aria-label="Global navigation"]').getByRole('button', { name: /设置/ }).click();

    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: /Narration Git 版本管理/ }) });
    await expect(section).toBeVisible({ timeout: 10_000 });

    // Type the remote but intentionally skip the Save button: the snapshot
    // action must persist and use whatever is currently in the field.
    const input = section.getByLabel('远端仓库地址');
    await input.fill(remote);
    await expect(input).toHaveValue(remote);
    await section.getByRole('button', { name: /立即提交并推送/ }).click();
    await expect(section.getByText('已提交并推送')).toBeVisible({ timeout: 20_000 });

    const log = cp.execSync(`git --git-dir="${remote}" log --all --pretty=%s`, { encoding: 'utf-8' });
    expect(log).toContain('snapshot:');

    const dbValue = await readDbSystemConfig('narration_git_remote');
    expect(dbValue).toBe(remote);

    expect(errors).toEqual([]);
  });
});
