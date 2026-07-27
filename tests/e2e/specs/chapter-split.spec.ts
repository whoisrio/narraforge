/**
 * 按标题拆分章节 E2E.
 *
 * 完整旁白文档（markdown）-> 文本库·旁白文档 tab「按标题拆分章节」
 * -> detect 层级 -> 预览 -> 应用（chapters:batch 替换章节）。
 * 验证 UI + API + DB（双读）+ layer-sync 基线。
 * 使用独立项目，不污染共享种子数据；测试结束删除。
 *
 * @feature backend/app/api/text_split.py (markdown-detect / markdown-split)
 */
import { expect, test } from '@playwright/test';
import { collectErrors, setLocaleToZhCN, enterWorkspace } from '../helpers';
import { readDbProject } from '../helpers/dbReader';

const BACKEND = 'http://127.0.0.1:8012';
const PROJECT_ID = 'e2e-chapter-split';
const PROJECT_NAME = '章节拆分测试';

const NARRATION = [
  '# 夜行记',
  '',
  '前言，不计入章节标题。',
  '',
  '## 夜路',
  '夜色渐浓，小路两旁的树影摇曳。远处传来几声犬吠，打破了夜晚的寂静。他没有停下脚步，只是把手电握得更紧了一些。风从山口灌下来，吹得路边的野草一阵阵地伏倒。他想起白天老人说过的话，心里隐隐有些不安，但还是继续向前走去。',
  '',
  '## 破庙',
  '破庙的木门虚掩着，香灰积了厚厚一层。神像的脸早已斑驳，看不清眉眼，只有供桌上还摆着半只干裂的苹果。他绕到殿后，发现墙角有一堆新熄的篝火，旁边散落着几张写满字的纸。他捡起来凑近火光一看，心跳顿时快了半拍，原来自己并不是今晚唯一到访的人。',
].join('\n');

function projectPayload() {
  return {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    schema_version: 2,
    layout: 'vertical',
    narration_script: NARRATION,
    chapters: [{
      id: `${PROJECT_ID}-ch0`,
      position: 0,
      name: '旧章节',
      voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' },
      split_config: { delimiters: ['，', '。'], mode: 'rule' },
      segments: [],
    }],
  };
}

test.describe('按标题拆分章节', () => {
  test.setTimeout(120_000);
  test('完整旁白 -> detect -> 预览 -> 应用 -> 章节落库（UI + API + DB 双读）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    // ── 0. 建独立测试项目（含完整旁白文档），结束后删除 ──
    await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const createResp = await page.request.post(`${BACKEND}/api/segmented-projects`, { data: projectPayload() });
    expect(createResp.status()).toBe(201);

    try {
      // ── 1. 打开 文本库 → 旁白文档 tab → 按标题拆分章节 ──
      await page.goto('/');
      await enterWorkspace(page);
      await page.getByRole('button', { name: new RegExp(`打开 ${PROJECT_NAME}`) }).first().click();
      await page.getByRole('button', { name: /文本库/ }).click();
      await page.getByRole('button', { name: '旁白文档' }).click();

      await page.getByRole('button', { name: '按标题拆分章节' }).click();
      const modal = page.getByRole('dialog', { name: '按标题拆分章节' });
      await expect(modal).toBeVisible();

      // detect 完成：文档标题 + H2 候选
      await expect(modal.getByText('夜行记')).toBeVisible({ timeout: 10_000 });
      await expect(modal.getByText('H2 (2)')).toBeVisible();

      // 预览拆分
      await modal.getByRole('button', { name: '预览拆分' }).click();
      const previewItems = modal.locator('ol li strong');
      await expect(previewItems).toHaveCount(2, { timeout: 10_000 });
      await expect(previewItems.nth(0)).toHaveText(/夜路/);
      await expect(previewItems.nth(1)).toHaveText('破庙');
      // 替换警告（项目已有 1 章）
      await expect(modal.getByText(/将删除现有 1 个章节/)).toBeVisible();

      // 应用（已有 1 章 -> 先弹确认）
      await modal.getByRole('button', { name: '应用到项目' }).click();
      const confirm = page.getByRole('alertdialog', { name: '确认替换章节' });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: '确认替换' }).click();
      await expect(modal).toBeHidden({ timeout: 15_000 });

      // ── 2. UI：章节列表已替换 ──
      await expect(page.getByText(/夜路/).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('破庙', { exact: true }).first()).toBeVisible();

      // ── 3. API：章节内容正确 ──
      const afterResp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
      const after = await afterResp.json();
      const titles = after.chapters.map((c: { name: string }) => c.name);
      expect(titles[0]).toContain('夜路');
      expect(titles[1]).toBe('破庙');
      const ch1 = after.chapters[0];
      expect(ch1.narration_script).toContain('夜色渐浓');
      const ch2 = after.chapters[1];
      expect(ch2.narration_script).toContain('破庙的木门');

      // layer-sync 基线：batch 后各层一致
      const sync1 = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${ch1.id}/sync-status`);
      expect(await sync1.json()).toEqual({ l1_dirty: false, l2_dirty: false, l3_dirty: false });

      // ── 4. DB 双读：章节行 + narration_document_path ──
      const db = await readDbProject(PROJECT_ID);
      expect(db).toBeTruthy();
      const dbTitles = db!.chapters.map((c) => c.name);
      expect(dbTitles[0]).toContain('夜路');
      expect(dbTitles[1]).toBe('破庙');
      expect(db!.project.narration_document_path).toBeTruthy();
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    }

    expect(errors).toEqual([]);
  });
});
