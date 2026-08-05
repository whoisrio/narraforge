/**
 * 角色删除二次确认 E2E.
 *
 * 项目内移除角色：弹确认对话框（含"音频保留"提示）-> 确认后从项目移除，
 * 角色记录仍在（设计：移除 ≠ 全局删除）。
 * 独立一次性项目，避免与其他 spec 的项目副本混淆；结束清理。
 *
 * @feature frontend/src/pages/TTSSynthesis.tsx (handleDeleteRole confirm)
 */
import { expect, test } from '@playwright/test';
import { collectErrors, setLocaleToZhCN, enterWorkspace } from '../helpers';

const BACKEND = 'http://127.0.0.1:8012';
const PROJECT_ID = 'e2e-role-delete-project';
const PROJECT_NAME = 'E2E-角色删除项目';
const ROLE_NAME = 'E2E-删除确认角色';

test.describe('角色删除二次确认', () => {
  test('项目内移除角色：确认对话框 -> 移除项目引用，角色记录仍在', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    // ── 0. 独立项目 + 绑定角色 ──
    await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    await page.request.delete(`${BACKEND}/api/roles/e2e-role-delete-confirm`);
    const projResp = await page.request.post(`${BACKEND}/api/segmented-projects`, {
      data: {
        id: PROJECT_ID,
        name: PROJECT_NAME,
        schema_version: 2,
        layout: 'vertical',
        chapters: [{
          id: `${PROJECT_ID}-ch0`, position: 0, name: '第一章',
          voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' },
          split_config: { delimiters: ['，', '。'], mode: 'rule' }, segments: [],
        }],
      },
    });
    expect(projResp.status()).toBe(201);
    const roleResp = await page.request.post(`${BACKEND}/api/roles`, {
      data: {
        id: 'e2e-role-delete-confirm',
        name: ROLE_NAME,
        role_kind: 'cast',
        project_id: PROJECT_ID,
        voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' },
      },
    });
    expect([200, 201]).toContain(roleResp.status());

    try {
      // ── 1. 打开项目角色页，点删除 ──
      await page.goto('/');
      await enterWorkspace(page);
      await page.getByRole('button', { name: `打开 ${PROJECT_NAME}`, exact: true }).first().click();
      await page.getByRole('button', { name: /◌ 角色|角色/ }).first().click();
      await expect(page.getByText(ROLE_NAME)).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: `删除 ${ROLE_NAME}` }).click();

      // ── 2. 确认对话框出现，文案说明音频保留 ──
      await expect(page.getByRole('heading', { name: '移除角色' })).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(/已合成的分段音频会保留/)).toBeVisible();

      // ── 3. 确认后从项目移除，但角色记录仍在（未全局删除） ──
      await page.getByRole('button', { name: '删除', exact: true }).click();
      await expect(page.getByText(ROLE_NAME)).toBeHidden({ timeout: 10_000 });

      const rolesResp = await page.request.get(`${BACKEND}/api/roles`, { params: { project_id: PROJECT_ID } });
      const rolesData = await rolesResp.json();
      const roles = rolesData.items ?? rolesData;
      expect(roles.some((r: { id: string }) => r.id === 'e2e-role-delete-confirm')).toBe(true);
    } finally {
      await page.request.delete(`${BACKEND}/api/roles/e2e-role-delete-confirm`);
      await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    }

    expect(errors).toEqual([]);
  });
});
