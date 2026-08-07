/**
 * 一键制作全本 E2E（edge-tts，无需付费 key）。
 *
 * 项目含两类段落问题：
 *   - 补切章：有 narration_script 但 segments 为空（需要 chapter->segment 补切）。
 *   - 脱节章：一个 segment 的 audio.current.path 指向不存在的文件
 *     -> 后端 file_exists=false -> 前端 idle（db/fs 脱节，即「假 ready」修复目标）。
 *
 * 流程：
 *   1. 先点「导出全部」-> 409 中止（脱节章缺音频 + 补切章无段）。
 *   2. transport bar「一键制作全本」->「仅合成未合成」（增量）。
 *   3. 轮询后端直到所有段都有真实音频（path + file_exists）。
 *   4. 「导出全部」成功 -> 磁盘双读每章 {标题}.mp3 + {标题}.srt。
 *
 * @feature docs/superpowers/specs/2026-08-07-produce-all-and-false-ready-fix-design.md
 */
import { expect, test } from '@playwright/test';
import { E2E_BACKEND_URL } from '../helpers/ports';
import { collectErrors, setLocaleToZhCN, enterWorkspace, readBackendProject } from '../helpers';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BACKEND = E2E_BACKEND_URL;
const PROJECT_ID = 'e2e-produce-all';
const PROJECT_NAME = '制作全本测试';
const EXPORT_DIR = path.resolve(process.cwd(), 'test-results', 'e2e-produce-all-out');

function projectPayload() {
  return {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    schema_version: 2,
    layout: 'vertical',
    configs: { export_directory: EXPORT_DIR },
    chapters: [
      {
        id: `${PROJECT_ID}-ch1`, position: 0, name: '补切章',
        voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural' },
        split_config: { delimiters: ['。'], mode: 'rule' },
        // 两句均 >=5 字，规则切出 2 段（不触发短段合并）
        narration_script: '夜色渐浓风声四起。破庙在前不敢前行。',
        segments: [], // 无 segment -> produce-all 补切
      },
      {
        id: `${PROJECT_ID}-ch2`, position: 1, name: '脱节章',
        voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural' },
        split_config: { delimiters: ['。'], mode: 'rule' },
        segments: [
          {
            id: `${PROJECT_ID}-s2`, position: 0, text: '门半掩着。',
            voice: { source: 'chapter' },
            // 模拟 db/fs 脱节：DB 存了 path 但文件不存在 -> file_exists=false -> idle
            audio: { format: 'mp3', current: { path: 'does/not/exist.mp3' } },
          },
        ],
      },
    ],
  };
}

/** 后端真实有音频的段数（path 且 file_exists !== false）。 */
async function realAudioCount(page: import('@playwright/test').Page): Promise<number> {
  const p = await readBackendProject(page, PROJECT_ID);
  if (!p) return 0;
  return p.chapters
    .flatMap((c) => c.segments)
    .filter((s) => !!s.audio?.current?.path && s.audio.current.file_exists !== false)
    .length;
}

test.describe('一键制作全本', () => {
  test.setTimeout(180_000);
  test('增量制作全本：补切 + 重合成脱节段 -> 导出全部成功', async ({ page }) => {
    const errors = collectErrors(page);
    fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
    await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const createResp = await page.request.post(`${BACKEND}/api/segmented-projects`, { data: projectPayload() });
    expect(createResp.status()).toBe(201);

    try {
      await setLocaleToZhCN(page);
      await page.goto('/');
      await enterWorkspace(page);
      await page.getByRole('button', { name: new RegExp(`打开 ${PROJECT_NAME}`) }).first().click();
      await page.getByRole('button', { name: /◉ 工作室/ }).first().click();
      await page.getByRole('button', { name: '展开工具栏' }).click();

      // ── 前置：导出全部被 409 中止（脱节章缺音频 + 补切章无段） ──
      const exportAllBtn = page.getByRole('button', { name: '导出全部', exact: true });
      await expect(exportAllBtn).toBeVisible({ timeout: 15_000 });
      await exportAllBtn.click();
      await expect(page.getByText(/存在未合成完成的章节/)).toBeVisible({ timeout: 10_000 });

      // ── 一键制作全本 -> 仅合成未合成（增量） ──
      await page.getByRole('button', { name: /一键制作全本/ }).click();
      const unsynthesizedItem = page.getByRole('button', { name: /仅合成未合成/ });
      await expect(unsynthesizedItem).toBeVisible({ timeout: 10_000 });
      await unsynthesizedItem.click();

      // ── 轮询后端：补切章切出 2 段 + 脱节章 1 段 = 3 段全部有真实音频 ──
      await expect.poll(() => realAudioCount(page), {
        timeout: 120_000,
        intervals: [2_000],
      }).toBe(3);

      // ── 导出全部成功 ──
      await exportAllBtn.click();
      await expect(page.getByText(/已导出 \d+ 章/)).toBeVisible({ timeout: 30_000 });

      // ── 磁盘双读：每章 mp3 + srt ──
      for (const title of ['补切章', '脱节章']) {
        const mp3 = path.join(EXPORT_DIR, `${title}.mp3`);
        const srt = path.join(EXPORT_DIR, `${title}.srt`);
        expect(fs.existsSync(mp3), `missing ${mp3}`).toBeTruthy();
        expect(fs.statSync(mp3).size).toBeGreaterThan(1000);
        expect(fs.existsSync(srt), `missing ${srt}`).toBeTruthy();
      }

      // 前置的 409 是预期业务中止，不算页面错误
      expect(errors.filter((e) => !e.includes('favicon') && !e.includes('409 (Conflict)'))).toEqual([]);
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
      fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
    }
  });
});
