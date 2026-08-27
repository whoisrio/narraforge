/**
 * Studio 段落多选批量删除 + 批量合成菜单 E2E.
 *
 * 批量删除：独立项目 4 段 -> 选择模式勾选 2 段（含 1 段有音频）-> 删除选中
 * -> 行数/DB 双读 -2、被删段音频文件保留在盘上（新契约：孤儿文件待 sweep 回收）。
 *
 * 合成菜单：独立项目 4 段（2 idle + 2 录入音频）-> 「批量合成」弹出两选项
 * -> 「仅合成未合成」-> idle 段合成出音频（origin tts）、录入段路径不变。
 *
 * @feature docs/feature-spec.md §4.4 Batch Operations
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectErrors, setLocaleToZhCN, enterWorkspace } from '../helpers';
import { readDbProject } from '../helpers/dbReader';
import { projectDirNameForId, listSegmentFiles } from '../helpers/fsAssertions';
import { E2E_BACKEND_URL } from '../helpers/ports';

const BACKEND = E2E_BACKEND_URL;
const FIXTURE_AUDIO = path.resolve(__dirname, '../fixtures/sample-audio/temp_audio.mp3');

function payload(id: string, name: string) {
  return {
    id, name, schema_version: 2, layout: 'vertical',
    chapters: [{
      id: `${id}-ch1`, position: 0, name: '第一章',
      voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural' },
      split_config: { delimiters: ['。'], mode: 'rule' },
      segments: [0, 1, 2, 3].map((i) => ({
        id: `${id}-s${i}`, position: i, text: `第${i + 1}段文本。`, voice: { source: 'chapter' },
      })),
    }],
  };
}

async function createProject(page: any, id: string, name: string) {
  await page.request.delete(`${BACKEND}/api/segmented-projects/${id}`);
  const resp = await page.request.post(`${BACKEND}/api/segmented-projects`, { data: payload(id, name) });
  expect(resp.status()).toBe(201);
}

async function uploadAudio(page: any, id: string, segmentId: string) {
  const buffer = fs.readFileSync(FIXTURE_AUDIO);
  const resp = await page.request.post(
    `${BACKEND}/api/segmented-projects/${id}/chapters/${id}-ch1/segments/${segmentId}/audio`,
    { multipart: { file: { name: 'take.mp3', mimeType: 'audio/mpeg', buffer } } },
  );
  expect(resp.status()).toBe(200);
}

async function openStudio(page: any, name: string) {
  await setLocaleToZhCN(page);
  await page.goto('/');
  await enterWorkspace(page);
  await page.getByRole('button', { name: new RegExp(`打开 ${name}`) }).first().click();
  await page.getByRole('button', { name: /◉ 工作室/ }).first().click();
  await expect(page.locator('[class*="compactCard"]').first()).toBeVisible({ timeout: 15_000 });
}

test.describe('段落批量操作', () => {
  test.setTimeout(180_000);

  test('多选批量删除（UI + DB + 磁盘）', async ({ page }) => {
    const ID = 'e2e-batch-del';
    const errors = collectErrors(page);
    await createProject(page, ID, '批量删除测试');
    await uploadAudio(page, ID, `${ID}-s0`);

    try {
      await openStudio(page, '批量删除测试');
      await expect(page.locator('[class*="compactCard"]')).toHaveCount(4);

      // ── 进入选择模式，勾选 s0（有音频）与 s1 ──
      await page.getByRole('button', { name: '选择', exact: true }).click();
      const checkboxes = page.locator('[class*="compactCard"] input[type="checkbox"]');
      await expect(checkboxes).toHaveCount(4);
      await checkboxes.nth(0).click();
      await checkboxes.nth(1).click();

      // ── 删除选中 (2)，确认弹窗含音频警示 ──
      await page.getByRole('button', { name: /删除选中 \(2\)/ }).click();
      await expect(page.getByText(/其中 1 个已有音频/)).toBeVisible({ timeout: 10_000 });
      await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();

      // ── UI: 行数 4 -> 2 ──
      await expect(page.locator('[class*="compactCard"]')).toHaveCount(2, { timeout: 10_000 });

      // ── DB 双读: 只剩 s2/s3（草稿同步为防抖 PUT，轮询收敛） ──
      await expect.poll(async () => {
        const bundle = await readDbProject(ID);
        return bundle!.segments.map((s) => s.id).sort();
      }, { timeout: 15_000, intervals: [500, 1000, 2000] }).toEqual([`${ID}-s2`, `${ID}-s3`]);

      // ── 磁盘: 新契约——批量删段不再删除音频文件，被删段的录入音频保留在盘上
      //    （孤儿文件待后续 sweep 回收），断言文件仍存在 ──
      const dirName = projectDirNameForId(ID);
      expect(dirName).toBeTruthy();
      const remainingFiles = listSegmentFiles(dirName!, `${ID}-ch1`, `${ID}-s0`).filter((f) => f.endsWith('.mp3'));
      expect(remainingFiles.length, '被删段的音频文件应保留在盘上（孤儿文件待 sweep 回收）').toBeGreaterThan(0);

      expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${ID}`);
    }
  });

  test('批量合成菜单：仅合成未合成', async ({ page }) => {
    const ID = 'e2e-batch-syn';
    const errors = collectErrors(page);
    await createProject(page, ID, '合成菜单测试');
    // s2/s3 录入音频（ready + recorded 锁定）；s0/s1 保持 idle
    await uploadAudio(page, ID, `${ID}-s2`);
    await uploadAudio(page, ID, `${ID}-s3`);
    const before = await (await page.request.get(`${BACKEND}/api/segmented-projects/${ID}`)).json();
    const recPathOf = (sid: string) => before.chapters[0].segments
      .find((s: any) => s.id === sid).audio.current.path as string;

    try {
      await openStudio(page, '合成菜单测试');

      // ── 菜单弹出两个选项 ──
      await page.getByRole('button', { name: /批量合成/ }).click();
      const unsynthOption = page.getByRole('button', { name: '仅合成未合成' });
      await expect(unsynthOption).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: '重新合成全部' })).toBeVisible();

      // ── 仅合成未合成 -> 确认 -> 顺序合成 ──
      await unsynthOption.click();
      await expect(page.getByText('合成未合成片段')).toBeVisible({ timeout: 10_000 });
      await page.getByRole('alertdialog').getByRole('button', { name: '生成', exact: true }).click();

      // s0/s1 合成出 tts 音频；s2/s3 录入音频路径不变
      await expect.poll(async () => {
        const p = await (await page.request.get(`${BACKEND}/api/segmented-projects/${ID}`)).json();
        const segs = p.chapters[0].segments;
        const done = segs.filter((s: any) =>
          (s.id.endsWith('s0') || s.id.endsWith('s1')) && s.audio?.current?.path);
        return done.length;
      }, { timeout: 120_000, intervals: [2000, 5000] }).toBe(2);

      const after = await (await page.request.get(`${BACKEND}/api/segmented-projects/${ID}`)).json();
      const segOf = (sid: string) => after.chapters[0].segments.find((s: any) => s.id === sid);
      expect(segOf(`${ID}-s0`).audio.current.origin).toBe('tts');
      expect(segOf(`${ID}-s1`).audio.current.origin).toBe('tts');
      expect(segOf(`${ID}-s2`).audio.current.path).toBe(recPathOf(`${ID}-s2`));
      expect(segOf(`${ID}-s3`).audio.current.path).toBe(recPathOf(`${ID}-s3`));

      expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${ID}`);
    }
  });
});
