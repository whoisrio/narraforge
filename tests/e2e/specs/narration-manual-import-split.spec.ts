/**
 * 手动导入旁白文档并按标题拆分 E2E.
 *
 * 形态 A（无 narration_script）-> 粘贴旁白文档 -> 自动保存落盘
 * -> 形态 B -> 按标题拆分章节 -> 章节落库（UI + API + DB 双读）。
 * 另测：章节优先项目 -> 从现有章节生成旁白文档 -> narration_script 落盘。
 *
 * 使用独立项目，不污染共享种子数据；测试结束删除。
 *
 * @feature frontend NarrationDocView + backend narration_script 持久化
 */
import { expect, test } from '@playwright/test';
import { collectErrors, setLocaleToZhCN, enterWorkspace } from '../helpers';
import { readDbProject } from '../helpers/dbReader';

const BACKEND = 'http://127.0.0.1:8012';

const NARRATION = [
  '# 夜行记',
  '',
  '前言，不计入章节标题。',
  '',
  '## 夜路',
  '夜色渐浓，小路两旁的树影摇曳。远处传来几声犬吠，打破了夜晚的寂静。他没有停下脚步，只是把手电握得更紧了一些。',
  '',
  '## 破庙',
  '破庙的木门虚掩着，香灰积了厚厚一层。神像的脸早已斑驳，看不清眉眼，只有供桌上还摆着半只干裂的苹果。',
].join('\n');

function projectPayload(id: string, name: string, chapterText: string | null) {
  return {
    id,
    name,
    schema_version: 2,
    layout: 'vertical',
    chapters: [{
      id: `${id}-ch0`,
      position: 0,
      name: '占位章节',
      original_text: chapterText,
      voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' },
      split_config: { delimiters: ['，', '。'], mode: 'rule' },
      segments: [],
    }],
  };
}

test.describe('手动导入旁白文档并拆分', () => {
  test.setTimeout(120_000);

  test('粘贴旁白文档 -> 自动保存 -> 按标题拆分 -> 章节落库（UI + API + DB 双读）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    const PROJECT_ID = 'e2e-narration-paste-split';
    const PROJECT_NAME = '粘贴拆分测试';

    await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const createResp = await page.request.post(`${BACKEND}/api/segmented-projects`, {
      data: projectPayload(PROJECT_ID, PROJECT_NAME, null),
    });
    expect(createResp.status()).toBe(201);

    try {
      await page.goto('/');
      await enterWorkspace(page);
      await page.getByRole('button', { name: new RegExp(`打开 ${PROJECT_NAME}`) }).first().click();
      await page.getByRole('button', { name: /文本库/ }).click();
      await page.getByRole('button', { name: '旁白文档' }).click();

      // 进入全文视图（形态 A：无 narration_script）
      await page.getByRole('button', { name: /查看全文/ }).click();
      await expect(page.getByRole('button', { name: /粘贴旁白文档/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /按标题拆分章节/ })).toBeHidden();

      // 粘贴旁白文档 -> 编辑器
      await page.getByRole('button', { name: /粘贴旁白文档/ }).click();
      const editor = page.getByRole('textbox');
      await editor.fill(NARRATION);

      // 自动保存（draftSync 防抖）-> 后端 narration_script 落盘
      await expect.poll(async () => {
        const r = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
        const j = await r.json();
        return j.narration_script ?? '';
      }, { timeout: 15_000, intervals: [500] }).toContain('夜行记');

      // 形态 B：拆分按钮出现
      await expect(page.getByRole('button', { name: /按标题拆分章节/ })).toBeVisible();

      // 按标题拆分
      await page.getByRole('button', { name: '按标题拆分章节' }).click();
      const modal = page.getByRole('dialog', { name: '按标题拆分章节' });
      await expect(modal).toBeVisible();
      await expect(modal.getByText('夜行记')).toBeVisible({ timeout: 10_000 });
      await expect(modal.getByText('H2 (2)')).toBeVisible();
      await modal.getByRole('button', { name: '预览拆分' }).click();
      const previewItems = modal.locator('ol li strong');
      await expect(previewItems).toHaveCount(2, { timeout: 10_000 });
      // 已有 1 章 -> 点应用先弹确认（删现有章节 + 音频）
      await modal.getByRole('button', { name: '应用到项目' }).click();
      const confirm = page.getByRole('alertdialog', { name: '确认替换章节' });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: '确认替换' }).click();
      await expect(modal).toBeHidden({ timeout: 15_000 });

      // UI：返回章节列表，章节已替换且带正文内容
      await page.getByRole('button', { name: /返回文本库/ }).click();
      await expect(page.getByText(/夜路/).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('02. 破庙', { exact: true }).first()).toBeVisible();
      // 章节卡片有正文（original_text 已落库，不再是只有标题）
      await expect(page.getByText(/夜色渐浓/).first()).toBeVisible();

      // API：章节正文正确（标题行被剩掉）+ original_text 落库
      const afterResp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
      const after = await afterResp.json();
      const titles = after.chapters.map((c: { name: string }) => c.name);
      expect(titles[0]).toMatch(/^01\./);
      expect(titles[0]).toContain('夜路');
      expect(titles[1]).toBe('02. 破庙');
      expect(after.chapters[0].narration_script).toContain('夜色渐浓');
      expect(after.chapters[0].narration_script).not.toContain('## 夜路');
      expect(after.chapters[0].original_text).toContain('夜色渐浓');
      expect(after.narration_script).toContain('夜行记');
      // 章节带可用 split_config（进 studio 规则拆分不会因 delimiters 缺失而崩）
      expect(after.chapters[0].split_config.delimiters.length).toBeGreaterThan(0);

      // DB 双读：narration_document_path 落盘
      const db = await readDbProject(PROJECT_ID);
      expect(db).toBeTruthy();
      expect(db!.project.narration_document_path).toBeTruthy();
      const dbTitles = db!.chapters.map((c) => c.name);
      expect(dbTitles[0]).toMatch(/^01\./);
      expect(dbTitles[0]).toContain('夜路');
      expect(dbTitles[1]).toBe('02. 破庙');
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    }

    expect(errors).toEqual([]);
  });

  test('章节优先项目 -> 从现有章节生成旁白文档 -> narration_script 落盘（API + DB 双读）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    const PROJECT_ID = 'e2e-narration-generate-from-chapters';
    const PROJECT_NAME = '章节生成旁白测试';
    const CHAPTER_TEXT = '这是第一章的完整旁白内容，由章节直接创建。';

    await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const createResp = await page.request.post(`${BACKEND}/api/segmented-projects`, {
      data: projectPayload(PROJECT_ID, PROJECT_NAME, CHAPTER_TEXT),
    });
    expect(createResp.status()).toBe(201);

    try {
      await page.goto('/');
      await enterWorkspace(page);
      await page.getByRole('button', { name: new RegExp(`打开 ${PROJECT_NAME}`) }).first().click();
      await page.getByRole('button', { name: /文本库/ }).click();
      await page.getByRole('button', { name: '旁白文档' }).click();

      await page.getByRole('button', { name: /查看全文/ }).click();
      // 形态 A：章节合并预览 + 转换入口
      await expect(page.getByText(CHAPTER_TEXT)).toBeVisible();
      await expect(page.getByRole('button', { name: /从现有章节生成旁白文档/ })).toBeEnabled();

      await page.getByRole('button', { name: /从现有章节生成旁白文档/ }).click();

      // narration_script = 章节合并文本，落盘
      await expect.poll(async () => {
        const r = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
        const j = await r.json();
        return j.narration_script ?? '';
      }, { timeout: 15_000, intervals: [500] }).toBe(CHAPTER_TEXT);

      // DB 双读
      const db = await readDbProject(PROJECT_ID);
      expect(db).toBeTruthy();
      expect(db!.project.narration_document_path).toBeTruthy();
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    }

    expect(errors).toEqual([]);
  });
});
