/**
 * 合成后音频调整（速度/音量）E2E.
 *
 * 合成一段音频 -> 工作室「调整音频」-> 提速 2x -> 验证时长缩短、
 * previous 保留、DB 双读、磁盘文件变化。
 * 另含变速缺陷修复（D1/D2/D6/D7）的回归用例：录音段豁免变速、
 * 变速章节中间插入段继承变速 + SRT 时间轴连续。
 *
 * @feature backend/app/api/segmented_projects.py (adjust-audio)
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { E2E_BACKEND_URL } from '../helpers/ports';
import { collectErrors, setLocaleToZhCN, goToStudio } from '../helpers';
import { readDbProject } from '../helpers/dbReader';
import { expectSegmentFileExists, projectDirNameForId } from '../helpers/fsAssertions';
import { parseSrtCues } from '../helpers/srt';

const BACKEND = E2E_BACKEND_URL;
const PROJECT_ID = 'test-e2e-project';
const CHAPTER_ID = 'test-chapter-1';
const FIXTURE_AUDIO = path.resolve(__dirname, '../fixtures/sample-audio/temp_audio.mp3');
// 后端存储模式的资产根（与 tests/e2e/helpers/fsAssertions.ts 同一布局）
const PROJECTS_ROOT = path.resolve(__dirname, '..', '..', '..', 'backend', 'data', 'projects');

async function getChapter(page: import('@playwright/test').Page) {
  const resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
  expect(resp.ok()).toBeTruthy();
  const project = await resp.json();
  return project.chapters.find((c: { id: string }) => c.id === CHAPTER_ID)!;
}

test.describe('合成后音频调整', () => {
  test('提速 2x -> 时长缩短 + previous 保留（UI + API + DB）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    // 清残留 audio_adjust（e2e 库跨 run 持久；若 chapter 残留 tempo=1.5 等记录，
    // 变速 2x 会基于 previous 原始音频重渲染，使 after/before = 旧tempo/新tempo，
    // 卡在断言阈值 0.75 边缘导致 flaky）
    await page.request.post(adjustUrl(CHAPTER_ID), { data: { tempo: 1.0, volume_db: 0 } }).catch(() => {});

    // ── 1. 合成第一段（edge_tts 可离线） ──
    const chapter = await getChapter(page);
    const segId = chapter.segments[0].id;
    const synthResp = await page.request.post(
      `${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${CHAPTER_ID}/segments/${segId}/synthesize`,
      { data: {} },
    );
    expect(synthResp.ok()).toBeTruthy();

    const before = await getChapter(page);
    const beforeSeg = before.segments.find((s: { id: string }) => s.id === segId)!;
    const beforeDuration = beforeSeg.audio?.current?.duration_sec as number;
    expect(beforeDuration).toBeGreaterThan(0);

    // ── 2. 工作室 → 展开工具栏 → 调整音频 → 提速 2x → 应用 ──
    await goToStudio(page);
    await page.getByRole('button', { name: '展开工具栏' }).click();
    await page.getByRole('button', { name: '调整音频' }).click();
    const dialog = page.getByRole('dialog', { name: /调整音频/ });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('速度').fill('2');
    await dialog.getByRole('button', { name: '应用' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // ── 3. API：时长约缩短一半，previous 保留 ──
    const after = await getChapter(page);
    const afterSeg = after.segments.find((s: { id: string }) => s.id === segId)!;
    const afterDuration = afterSeg.audio?.current?.duration_sec as number;
    expect(afterDuration).toBeGreaterThan(0);
    expect(afterDuration).toBeLessThan(beforeDuration * 0.75);
    // 顶层 duration_sec（时间轴/SRT 读取源）同步更新
    expect(afterSeg.audio?.duration_sec).toBeCloseTo(afterDuration, 2);
    const prev = afterSeg.audio?.previous;
    expect(prev?.path).toBeTruthy();
    expect(prev?.duration_sec).toBeCloseTo(beforeDuration, 1);

    // ── 4. DB 双读 + audio_adjust 记录 ──
    const db = await readDbProject(PROJECT_ID);
    const dbSeg = db!.segments.find((s) => s.id === segId)!;
    const dbAudio = typeof dbSeg.audio === 'string' ? JSON.parse(dbSeg.audio) : dbSeg.audio;
    expect(dbAudio.previous?.path).toBeTruthy();
    expect(dbAudio.current?.duration_sec).toBeCloseTo(afterDuration, 1);

    // ── 5. 重开弹窗：滑块回显已应用参数 ──
    await page.getByRole('button', { name: '调整音频' }).click();
    const dialog2 = page.getByRole('dialog', { name: /调整音频/ });
    await expect(dialog2).toBeVisible();
    await expect(dialog2.getByText(/当前已应用：2×/)).toBeVisible();
    await expect(dialog2.getByLabel('速度')).toHaveValue('2');

    // ── 6. 还原原始：调回 1x/0dB → 时长复原、记录清除 ──
    await dialog2.getByLabel('速度').fill('1');
    await dialog2.getByLabel('音量').fill('0');
    await dialog2.getByRole('button', { name: '还原原始音频' }).click();
    await expect(dialog2).toBeHidden({ timeout: 30_000 });

    const reverted = await getChapter(page);
    const revertedSeg = reverted.segments.find((s: { id: string }) => s.id === segId)!;
    expect(revertedSeg.audio?.current?.duration_sec).toBeCloseTo(beforeDuration, 1);
    // 顶层 duration_sec（时间轴/SRT 读取源）还原后也回到原始时长
    expect(revertedSeg.audio?.duration_sec).toBeCloseTo(beforeDuration, 1);
    expect(reverted.audio_adjust ?? null).toBeNull();

    expect(errors).toEqual([]);
  });

  test('应用调整后停留在当前章节（不跳回第一章）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    // ── 1. 在第二章合成一段音频（先还原可能残留的调整记录，e2e 库跨 run 持久） ──
    const CH2 = 'test-chapter-2';
    await page.request.post(
      `${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${CH2}/adjust-audio`,
      { data: { tempo: 1.0, volume_db: 0 } },
    ).catch(() => {});
    const ch2Resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const proj = await ch2Resp.json();
    const ch2 = proj.chapters.find((c: { id: string }) => c.id === CH2)!;
    const segId = ch2.segments[0].id;
    const synthResp = await page.request.post(
      `${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${CH2}/segments/${segId}/synthesize`,
      { data: {} },
    );
    expect(synthResp.ok()).toBeTruthy();

    // ── 2. 切到第二章 → 调整音量 → 应用 ──
    await goToStudio(page);
    await page.getByRole('button', { name: /选择章节 第2章/ }).click();
    await expect(page.getByText('破庙的门半掩着').first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '展开工具栏' }).click();
    await page.getByRole('button', { name: '调整音频' }).click();
    const dialog = page.getByRole('dialog', { name: /调整音频/ });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('音量').fill('3');
    await dialog.getByRole('button', { name: '应用' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // ── 3. 应用后仍停留在第二章 ──
    await expect(page.getByText('破庙的门半掩着').first()).toBeVisible({ timeout: 10_000 });
    const afterResp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const after = await afterResp.json();
    const afterCh2 = after.chapters.find((c: { id: string }) => c.id === CH2)!;
    expect(afterCh2.audio_adjust?.volume_db).toBe(3);

    expect(errors).toEqual([]);
  });

  // 本章共享的小工具：合成某段 / 调 adjust-audio / 取某段
  async function synthSegment(page: import('@playwright/test').Page, chapterId: string, segId: string, data: Record<string, unknown> = {}) {
    const resp = await page.request.post(
      `${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${chapterId}/segments/${segId}/synthesize`,
      { data },
    );
    expect(resp.ok(), `synthesize ${segId} failed: ${await resp.text()}`).toBeTruthy();
  }

  function adjustUrl(chapterId: string) {
    return `${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/${chapterId}/adjust-audio`;
  }

  async function getSeg(page: import('@playwright/test').Page, chapterId: string, segId: string) {
    const ch = (await (await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`)).json())
      .chapters.find((c: { id: string }) => c.id === chapterId)!;
    return ch.segments.find((s: { id: string }) => s.id === segId)!;
  }

  test('录音段豁免变速（D1/D2）：adjust 不覆盖录音，其余段正常重渲染', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    // ── 0. 清残留（e2e 库跨 run 持久），合成第一章全部 3 段 ──
    await page.request.post(adjustUrl(CHAPTER_ID), { data: { tempo: 1.0, volume_db: 0 } }).catch(() => {});
    for (const sid of ['seg-1-1', 'seg-1-2', 'seg-1-3']) await synthSegment(page, CHAPTER_ID, sid);
    const origDur: Record<string, number> = {};
    for (const sid of ['seg-1-1', 'seg-1-2', 'seg-1-3']) {
      origDur[sid] = (await getSeg(page, CHAPTER_ID, sid)).audio.current.duration_sec;
      expect(origDur[sid]).toBeGreaterThan(0);
    }

    // ── 1. 整章 1.5x：三段都缩短 ──
    const r1 = await page.request.post(adjustUrl(CHAPTER_ID), { data: { tempo: 1.5 } });
    expect((await r1.json()).adjusted).toBe(3);

    // ── 2. UI 上传录音到 seg-1-1（覆盖既有合成音频需确认） ──
    await goToStudio(page);
    await page.getByRole('button', { name: '录入', exact: true }).first().click();
    await expect(page.getByText('录入片段音频')).toBeVisible({ timeout: 10_000 });
    await page.locator('input[type="file"][accept="audio/*"]').setInputFiles(FIXTURE_AUDIO);
    await expect(page.locator('audio[controls]')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '使用此音频' }).click();
    await expect(page.getByText('该片段已有合成音频，录入将替换并删除现有音频，是否继续？'))
      .toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.getByTitle('已录入音频，点击解锁后可重新合成').first()).toBeVisible({ timeout: 15_000 });

    // 等草稿同步收敛到 recorded（防抖 PUT）
    let recAudio: any;
    await expect.poll(async () => {
      recAudio = (await getSeg(page, CHAPTER_ID, 'seg-1-1')).audio;
      return recAudio?.current?.origin;
    }, { timeout: 15_000 }).toBe('recorded');
    const recPath = recAudio.current.path as string;
    const recDur = recAudio.current.duration_sec as number;
    const recBytes = fs.readFileSync(path.join(PROJECTS_ROOT, recPath));

    // ── 3. 再 adjust 0.8x：录音段必须原样保留 ──
    const r2 = await page.request.post(adjustUrl(CHAPTER_ID), { data: { tempo: 0.8 } });
    expect(r2.ok()).toBeTruthy();
    const body2 = await r2.json();
    expect(body2.skipped_recorded).toBe(1);
    expect(body2.adjusted).toBe(2);

    // API 层：录音段 path/时长不变，磁盘字节逐字节不变（D1 核心回归）
    const s1 = await getSeg(page, CHAPTER_ID, 'seg-1-1');
    expect(s1.audio.current.path).toBe(recPath);
    expect(s1.audio.current.duration_sec).toBeCloseTo(recDur, 3);
    expect(fs.readFileSync(path.join(PROJECTS_ROOT, recPath))).toEqual(recBytes);
    // 其余段从原始（previous stash）重渲染为 0.8x
    for (const sid of ['seg-1-2', 'seg-1-3']) {
      const s = await getSeg(page, CHAPTER_ID, sid);
      const d = s.audio.current.duration_sec as number;
      expect(d).toBeGreaterThan((origDur[sid] / 0.8) * 0.9);
      expect(d).toBeLessThan((origDur[sid] / 0.8) * 1.1);
      // previous 仍是原始（无级联），顶层 duration_sec 与 current 一致（D7）
      expect(s.audio.previous.duration_sec).toBeCloseTo(origDur[sid], 1);
      expect(s.audio.duration_sec).toBeCloseTo(d, 3);
    }

    // ── 4. DB 双读：录音段 origin/path 落库一致 ──
    const db = await readDbProject(PROJECT_ID);
    const dbAudio = JSON.parse(db!.segments.find((s) => s.id === 'seg-1-1')!.audio!);
    expect(dbAudio.current.origin).toBe('recorded');
    expect(dbAudio.current.path).toBe(recPath);

    // ── 5. 还原现场：恒等还原（录音段仍跳过）+ 强制重合成 seg-1-1 回普通 TTS 段 ──
    const r3 = await page.request.post(adjustUrl(CHAPTER_ID), { data: { tempo: 1.0, volume_db: 0 } });
    expect((await r3.json()).skipped_recorded).toBe(1);
    expect(fs.readFileSync(path.join(PROJECTS_ROOT, recPath))).toEqual(recBytes);
    for (const sid of ['seg-1-2', 'seg-1-3']) {
      const s = await getSeg(page, CHAPTER_ID, sid);
      expect(s.audio.current.duration_sec).toBeCloseTo(origDur[sid], 1);
    }
    await synthSegment(page, CHAPTER_ID, 'seg-1-1', { force: true });
    const s1Final = await getSeg(page, CHAPTER_ID, 'seg-1-1');
    expect(s1Final.audio.current.origin ?? 'tts').not.toBe('recorded');
    const chFinal = (await (await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`)).json())
      .chapters.find((c: { id: string }) => c.id === CHAPTER_ID)!;
    expect(chFinal.audio_adjust ?? null).toBeNull();

    expect(errors).toEqual([]);
  });

  test('变速章节中间插入段继承 1.5x + 导出 SRT 时间轴连续（D6/D7）', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    // ── 0. 清残留，合成第一章 3 段，设 1.5x ──
    await page.request.post(adjustUrl(CHAPTER_ID), { data: { tempo: 1.0, volume_db: 0 } }).catch(() => {});
    for (const sid of ['seg-1-1', 'seg-1-2', 'seg-1-3']) await synthSegment(page, CHAPTER_ID, sid);
    const r1 = await page.request.post(adjustUrl(CHAPTER_ID), { data: { tempo: 1.5 } });
    expect((await r1.json()).adjusted).toBe(3);

    // ── 1. 全量 PUT 在中间插入 seg-new（UI 无插入段入口，TextInputPanel 拆分是
    //    整章重建而非单段插入，故走 save_project；现有段不带 audio 字段以保留音频） ──
    const mkSeg = (id: string, text: string, position: number, emotion: string) => ({
      id, text, position, segment_kind: 'narration', emotion, voice: { source: 'chapter' },
    });
    const putResp = await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, {
      data: {
        id: PROJECT_ID, name: 'test', schema_version: 2, layout: 'vertical',
        active_chapter_id: CHAPTER_ID,
        chapters: [
          {
            id: CHAPTER_ID, position: 0, name: '第1章 夜路',
            voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' },
            split_config: { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
            segments: [
              mkSeg('seg-1-1', '夜色渐浓，小路两旁的树影摇曳。', 0, 'neutral'),
              mkSeg('seg-new', '忽然一声惊雷，打破了山野的沉寂。', 1, 'neutral'),
              mkSeg('seg-1-2', '远处传来几声犬吠，打破了夜晚的寂静。', 2, 'calm'),
              mkSeg('seg-1-3', '他加快了脚步，心中隐隐有些不安。', 3, 'neutral'),
            ],
          },
          {
            id: 'test-chapter-2', position: 1, name: '第2章 破庙',
            voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' },
            split_config: { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
            segments: [
              mkSeg('seg-2-1', '破庙的门半掩着，里面透出微弱的灯光。', 0, 'neutral'),
              mkSeg('seg-2-2', '他推开门，看到一个老人坐在火堆旁。', 1, 'calm'),
            ],
          },
        ],
      },
    });
    expect(putResp.ok(), `PUT insert failed: ${await putResp.text()}`).toBeTruthy();

    // D6：PUT 不得清掉/篡改 chapter 的 1.5x 记录
    const chAfterPut = (await (await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`)).json())
      .chapters.find((c: { id: string }) => c.id === CHAPTER_ID)!;
    expect(chAfterPut.audio_adjust?.tempo).toBe(1.5);

    // ── 2. 合成插入段：应继承 1.5x，previous stash 存在 ──
    await synthSegment(page, CHAPTER_ID, 'seg-new');
    const sn = await getSeg(page, CHAPTER_ID, 'seg-new');
    const prevD = sn.audio.previous?.duration_sec as number;
    const curD = sn.audio.current.duration_sec as number;
    expect(sn.audio.previous?.path).toBeTruthy();
    expect(prevD).toBeGreaterThan(0);
    expect(curD / prevD).toBeCloseTo(1 / 1.5, 1);
    // 顶层 duration_sec 与 current 一致（D7）
    expect(sn.audio.duration_sec).toBeCloseTo(curD, 3);
    // 磁盘：合成文件与 stash 都真实存在
    const dirName = projectDirNameForId(PROJECT_ID);
    expect(dirName).toBeTruthy();
    expectSegmentFileExists(dirName!, CHAPTER_ID, 'seg-new');
    expect(
      fs.existsSync(path.join(PROJECTS_ROOT, sn.audio.previous.path)),
      'previous stash file should exist on disk',
    ).toBeTruthy();

    // ── 3. UI 导出 SRT：4 个 cue 按 position 顺序连续累加，时长与各段一致 ──
    await goToStudio(page);
    await page.getByRole('button', { name: '展开工具栏' }).click();
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await expect(page.getByText('导出选项')).toBeVisible({ timeout: 5_000 });
    // 只留 SRT，避免触发音频导出的跳过确认
    await page.getByRole('checkbox', { name: 'MP3 音频', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '开始导出' }).click(),
    ]);
    const srt = fs.readFileSync(await download.path(), 'utf-8');
    const cues = parseSrtCues(srt);
    expect(cues.length).toBe(4);
    // 顺序 = position 顺序：seg-1-1, seg-new, seg-1-2, seg-1-3
    expect(cues[0].text).toContain('夜色渐浓');
    expect(cues[1].text).toContain('忽然一声惊雷');
    expect(cues[2].text).toContain('远处传来几声犬吠');
    expect(cues[3].text).toContain('他加快了脚步');
    // 从 0 连续累加
    expect(cues[0].startMs).toBe(0);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startMs).toBe(cues[i - 1].endMs);
    }
    // 每个 cue 时长与 API 读到的该段 current.duration_sec 一致（fmtSrtTime 向下取整到 ms）
    for (const [i, sid] of ['seg-1-1', 'seg-new', 'seg-1-2', 'seg-1-3'].entries()) {
      const s = await getSeg(page, CHAPTER_ID, sid);
      const apiD = s.audio.current.duration_sec as number;
      expect(Math.abs((cues[i].endMs - cues[i].startMs) / 1000 - apiD)).toBeLessThan(0.02);
    }

    // ── 4. 还原现场：PUT 删除 seg-new + 恒等还原章节速度 ──
    const putBack = await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, {
      data: {
        id: PROJECT_ID, name: 'test', schema_version: 2, layout: 'vertical',
        active_chapter_id: CHAPTER_ID,
        chapters: [
          {
            id: CHAPTER_ID, position: 0, name: '第1章 夜路',
            voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' },
            split_config: { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
            segments: [
              mkSeg('seg-1-1', '夜色渐浓，小路两旁的树影摇曳。', 0, 'neutral'),
              mkSeg('seg-1-2', '远处传来几声犬吠，打破了夜晚的寂静。', 1, 'calm'),
              mkSeg('seg-1-3', '他加快了脚步，心中隐隐有些不安。', 2, 'neutral'),
            ],
          },
          {
            id: 'test-chapter-2', position: 1, name: '第2章 破庙',
            voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' },
            split_config: { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
            segments: [
              mkSeg('seg-2-1', '破庙的门半掩着，里面透出微弱的灯光。', 0, 'neutral'),
              mkSeg('seg-2-2', '他推开门，看到一个老人坐在火堆旁。', 1, 'calm'),
            ],
          },
        ],
      },
    });
    expect(putBack.ok()).toBeTruthy();
    const chAfterDelete = (await (await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`)).json())
      .chapters.find((c: { id: string }) => c.id === CHAPTER_ID)!;
    expect(chAfterDelete.segments.map((s: { id: string }) => s.id)).toEqual(['seg-1-1', 'seg-1-2', 'seg-1-3']);
    await page.request.post(adjustUrl(CHAPTER_ID), { data: { tempo: 1.0, volume_db: 0 } });
    const chFinal = (await (await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`)).json())
      .chapters.find((c: { id: string }) => c.id === CHAPTER_ID)!;
    expect(chFinal.audio_adjust ?? null).toBeNull();

    expect(errors).toEqual([]);
  });
});
