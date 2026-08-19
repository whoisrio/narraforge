/**
 * Library 文档优先（doc-first）E2E.
 *
 * 新项目 -> 文本库默认落 doc（全文）视图 -> 形态 A 粘贴 CTA + 去源文档
 * -> 粘贴旁白 -> 自动保存落库 -> 按标题拆分 -> 留在 doc 视图 + 结果反馈
 * -> 「查看章节」主动跳转章节网格；源文档视图可访问；视图记忆（localStorage）。
 * 数据断言: narration_script 落库、章节/段落数量与文本逐字段核对（API + DB 双读）。
 * 使用独立项目，不污染共享种子数据；测试结束删除。
 *
 * @feature frontend/src/components/ProjectLibrary/ProjectLibrary.tsx (Library 视图状态机)
 */
import { expect, test } from '@playwright/test';
import { E2E_BACKEND_URL } from '../helpers/ports';
import { collectErrors, setLocaleToZhCN, enterWorkspace } from '../helpers';
import { readDbProject } from '../helpers/dbReader';

const BACKEND = E2E_BACKEND_URL;
const PROJECT_ID = 'e2e-library-doc-first';
const PROJECT_NAME = '文档优先测试';

// 文案约束：章节正文 ≥80 字（markdown_split 的 min_chars 合并阈值）；
// 句子不含逗号且 ≥5 字（rule_split 默认分隔符含逗号、<5 字会被合并）。
const CH1_S = [
  '清晨的阳光洒在蜿蜒的小河上泛起点点金光。',
  '洗衣的妇人蹲在河边石阶上说着家长里短。',
  '孩子们背着书包沿着田埂一路小跑去上学。',
  '远处的山岚在晨雾里面若隐若现格外宁静。',
];
const CH2_S = [
  '傍晚的集市上人来人往非常热闹和喧嚣。',
  '卖菜的摊贩吆喝声此起彼伏充满了生气。',
  '老人们围坐在茶馆门口下棋聊天度时光。',
  '夜幕降临之后家家户户亮起了温暖灯火。',
];
const NARRATION = ['# 乡居一日', '', '## 清晨', CH1_S.join(''), '', '## 傍晚', CH2_S.join('')].join('\n');

interface Seg { id: string; text: string }
interface Ch { id: string; name: string; narration_script: string; segments: Seg[] }

test.describe('Library 文档优先', () => {
  test.setTimeout(120_000);

  test('新项目 -> 落 doc 视图 -> 粘贴 -> 拆分 -> 留在 doc -> 查看章节跳转 + 源文档视图 + 视图记忆', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const createResp = await page.request.post(`${BACKEND}/api/segmented-projects`, {
      data: { id: PROJECT_ID, name: PROJECT_NAME, schema_version: 2, layout: 'vertical', chapters: [] },
    });
    expect(createResp.status()).toBe(201);

    try {
      await page.goto('/');
      await enterWorkspace(page);
      await page.getByRole('button', { name: new RegExp(`打开 ${PROJECT_NAME}`) }).first().click();
      await page.getByRole('button', { name: /文本库/ }).click();

      // ── 1. 默认落 doc 视图：形态 A + 三键切换器，分镜入口不存在 ──
      await expect(page.getByRole('button', { name: '全文', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '章节', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '源文档', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '分镜' })).toBeHidden();
      await expect(page.getByRole('button', { name: /粘贴旁白文档/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /按标题拆分章节/ })).toBeHidden();

      // ── 2. 去源文档：source 视图可访问（local 模式含工作流入口），再切回 ──
      await page.getByRole('button', { name: '去源文档' }).click();
      await expect(page.getByPlaceholder(/源文档内容/)).toBeVisible();
      await expect(page.getByRole('button', { name: '生成旁白' })).toBeVisible();
      await expect(page.getByRole('button', { name: '知识视频' })).toBeVisible();
      await page.getByRole('button', { name: '全文', exact: true }).click();

      // ── 3. 粘贴旁白 -> 自动保存落库 ──
      await page.getByRole('button', { name: /粘贴旁白文档/ }).click();
      await page.getByRole('textbox').fill(NARRATION);
      await expect.poll(async () => {
        const r = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
        return ((await r.json()) as { narration_script?: string }).narration_script ?? '';
      }, { timeout: 15_000, intervals: [500] }).toContain('乡居一日');
      await expect(page.getByRole('button', { name: /按标题拆分章节/ })).toBeVisible();

      // ── 4. 拆分 -> 留在 doc 视图 + 结果反馈（「留在文档」）──
      await page.getByRole('button', { name: '按标题拆分章节' }).click();
      let modal = page.getByRole('dialog', { name: '按标题拆分章节' });
      await expect(modal.getByText('乡居一日')).toBeVisible({ timeout: 10_000 });
      await modal.getByRole('button', { name: '预览拆分' }).click();
      await expect(modal.locator('ol li strong')).toHaveCount(2, { timeout: 10_000 });
      await modal.getByRole('button', { name: '应用到项目' }).click();
      const confirm1 = page.getByRole('alertdialog', { name: '确认替换章节' });
      if (await confirm1.isVisible()) {
        await confirm1.getByRole('button', { name: '确认替换' }).click();
      }
      await expect(modal).toBeHidden({ timeout: 15_000 });
      const resultDialog = page.getByRole('alertdialog', { name: '拆分完成' });
      await expect(resultDialog).toBeVisible({ timeout: 15_000 });
      await resultDialog.getByRole('button', { name: '留在文档' }).click();
      // 仍处 doc 视图（未自动跳转）
      await expect(page.getByRole('button', { name: /按标题拆分章节/ })).toBeVisible();

      // ── 5. API + DB：章节/段落逐字段核对 ──
      const detail = await (await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`)).json();
      const chapters = detail.chapters as Ch[];
      expect(chapters).toHaveLength(2);
      // H1 标题行作为引言并入首章，markdown_split 命名为「…（含引言）」
      expect(chapters[0].name).toMatch(/^01\. 清晨/);
      expect(chapters[1].name).toBe('02. 傍晚');
      expect(chapters[0].segments.map((s) => s.text)).toEqual(CH1_S);
      expect(chapters[1].segments.map((s) => s.text)).toEqual(CH2_S);
      expect(chapters[0].narration_script).toBe(CH1_S.join(''));
      expect(detail.narration_script).toContain('乡居一日');

      const db = await readDbProject(PROJECT_ID);
      expect(db).toBeTruthy();
      expect(db!.project.narration_document_path).toBeTruthy();
      expect(db!.chapters[0].name).toMatch(/^01\. 清晨/);
      expect(db!.chapters[1].name).toBe('02. 傍晚');
      expect(db!.segments.map((s) => s.text)).toEqual([...CH1_S, ...CH2_S]);

      // ── 6. 再拆一次（重拆路径）-> 结果反馈点「查看章节」主动跳转 ──
      await page.getByRole('button', { name: '按标题拆分章节' }).click();
      modal = page.getByRole('dialog', { name: '按标题拆分章节' });
      await expect(modal.getByText('H2 (2)')).toBeVisible({ timeout: 10_000 });
      await modal.getByRole('button', { name: '预览拆分' }).click();
      await expect(modal.locator('ol li strong')).toHaveCount(2, { timeout: 10_000 });
      await modal.getByRole('button', { name: '应用到项目' }).click();
      const confirm2 = page.getByRole('alertdialog', { name: '确认替换章节' });
      await confirm2.getByRole('button', { name: '确认替换' }).click();
      const resultDialog2 = page.getByRole('alertdialog', { name: '拆分完成' });
      await expect(resultDialog2).toBeVisible({ timeout: 15_000 });
      await resultDialog2.getByRole('button', { name: '查看章节' }).click();
      // 章节网格：两张卡片 + 正文
      await expect(page.getByText(/01\. 清晨/).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('02. 傍晚', { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/清晨的阳光洒在蜿蜒的小河上/).first()).toBeVisible();

      // ── 7. 视图记忆：重进项目落 chapters 视图 ──
      await page.reload();
      await enterWorkspace(page);
      await page.getByRole('button', { name: new RegExp(`打开 ${PROJECT_NAME}`) }).first().click();
      await page.getByRole('button', { name: /文本库/ }).click();
      await expect(page.getByText(/01\. 清晨/).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    }

    expect(errors).toEqual([]);
  });
});
