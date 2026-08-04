/**
 * 一键导出所有章节音频 + SRT E2E.
 *
 * 独立两章项目 -> 未合成时导出被 409 中止（toast 列出章节）
 * -> 录入上传音频补齐 -> 工作室「导出全部」-> toast 报告
 * -> 磁盘双读验证每章 {标题}.mp3 + {标题}.srt，SRT 章节内从 0 开始。
 *
 * 音频通过录入上传端点注入（fixture mp3），无需真实 TTS。
 *
 * @feature docs/superpowers/specs/2026-08-04-export-all-chapters-design.md
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectErrors, setLocaleToZhCN, enterWorkspace } from '../helpers';

const BACKEND = 'http://127.0.0.1:8012';
const PROJECT_ID = 'e2e-export-all';
const PROJECT_NAME = '导出全部测试';
const FIXTURE_AUDIO = path.resolve(__dirname, '../fixtures/sample-audio/temp_audio.mp3');
const EXPORT_DIR = path.resolve(process.cwd(), 'test-results', 'e2e-export-all-out');

function projectPayload() {
  return {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    schema_version: 2,
    layout: 'vertical',
    configs: { export_directory: EXPORT_DIR },
    chapters: [
      {
        id: `${PROJECT_ID}-ch1`, position: 0, name: '起始章',
        voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural' },
        split_config: { delimiters: ['。'], mode: 'rule' },
        segments: [
          { id: `${PROJECT_ID}-s1`, position: 0, text: '夜色渐浓。', voice: { source: 'chapter' } },
        ],
      },
      {
        id: `${PROJECT_ID}-ch2`, position: 1, name: '收尾章',
        voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural' },
        split_config: { delimiters: ['。'], mode: 'rule' },
        segments: [
          { id: `${PROJECT_ID}-s2`, position: 0, text: '破庙在前。', voice: { source: 'chapter' } },
        ],
      },
    ],
  };
}

async function uploadAudio(page: any, chapterId: string, segmentId: string) {
  const buffer = fs.readFileSync(FIXTURE_AUDIO);
  const resp = await page.request.post(
    `${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${chapterId}/segments/${segmentId}/audio`,
    { multipart: { file: { name: 'take.mp3', mimeType: 'audio/mpeg', buffer } } },
  );
  expect(resp.status()).toBe(200);
}

test.describe('一键导出所有章节', () => {
  test.setTimeout(120_000);
  test('409 中止 -> 补齐音频 -> 导出全部 -> 磁盘双读', async ({ page }) => {
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
      // 播放栏默认收起，先展开才能看到导出按钮
      await page.getByRole('button', { name: '展开播放栏' }).click();
      const exportAllBtn = page.getByRole('button', { name: '导出全部', exact: true });
      await expect(exportAllBtn).toBeVisible({ timeout: 15_000 });

      // ── 阶段 1: 章节无音频 -> 409 整体中止，toast 列出章节 ──
      await exportAllBtn.click();
      await expect(page.getByText('存在未合成完成的章节，已全部中止：起始章、收尾章'))
        .toBeVisible({ timeout: 10_000 });
      // 未写出任何文件
      expect(fs.existsSync(EXPORT_DIR) ? fs.readdirSync(EXPORT_DIR) : []).toEqual([]);

      // ── 阶段 2: 录入上传补齐两章音频 ──
      await uploadAudio(page, `${PROJECT_ID}-ch1`, `${PROJECT_ID}-s1`);
      await uploadAudio(page, `${PROJECT_ID}-ch2`, `${PROJECT_ID}-s2`);

      // ── 阶段 3: 一键导出成功 ──
      await exportAllBtn.click();
      await expect(page.getByText(/已导出 2 章/)).toBeVisible({ timeout: 20_000 });

      // ── 磁盘验证: 每章 mp3 + srt，SRT 从 0 开始 ──
      for (const title of ['起始章', '收尾章']) {
        const mp3 = path.join(EXPORT_DIR, `${title}.mp3`);
        const srt = path.join(EXPORT_DIR, `${title}.srt`);
        expect(fs.existsSync(mp3), `missing ${mp3}`).toBeTruthy();
        expect(fs.statSync(mp3).size).toBeGreaterThan(1000);
        expect(fs.existsSync(srt), `missing ${srt}`).toBeTruthy();
        const content = fs.readFileSync(srt, 'utf8');
        expect(content).toContain('00:00:00,000 -->');
      }
      const srt1 = fs.readFileSync(path.join(EXPORT_DIR, '起始章.srt'), 'utf8');
      expect(srt1).toContain('夜色渐浓。');

      // 阶段 1 的 409 是预期内的业务中止，不算页面错误
      expect(errors.filter((e) => !e.includes('favicon') && !e.includes('409 (Conflict)'))).toEqual([]);
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
      fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
    }
  });
});
