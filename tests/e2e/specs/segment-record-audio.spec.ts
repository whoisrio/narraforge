/**
 * 段落自行录入音频 E2E.
 *
 * 工作室段落行 🎙 录入 -> 上传本地音频 -> 覆盖确认 -> 🔒 录入 角标
 * -> 双读验证（API + DB + 磁盘文件，origin === 'recorded'）
 * -> 重新生成被拦截（提示先解锁）-> 解锁后角标消失、origin 清除。
 *
 * 使用共享种子项目（test-e2e-project）的第一个段落；测试结束解锁该段落，
 * 使其回到可被其他用例重新合成的普通状态。
 *
 * @feature docs/feature-spec.md §4.4 Self-Recorded Segment Audio (自行录入)
 */
import { expect, test } from '@playwright/test';
import * as path from 'node:path';
import {
  collectErrors,
  setLocaleToZhCN,
  goToStudio,
  readBackendProject,
  seedTestProject,
} from '../helpers';
import { readDbProject } from '../helpers/dbReader';
import { listSegmentFiles, projectDirNameForId } from '../helpers/fsAssertions';

const PROJECT_ID = 'test-e2e-project';
const FIXTURE_AUDIO = path.resolve(__dirname, '../fixtures/sample-audio/temp_audio.mp3');

test.describe('段落自行录入音频', () => {
  test.setTimeout(120_000);
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try { await seedTestProject(page); } finally { await page.close(); }
  });

  test('上传录入 -> 锁定保护 -> 解锁（UI + API + DB 双读）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    await goToStudio(page);

    // ── 定位第一个段落 ──
    const project0 = await readBackendProject(page, PROJECT_ID);
    expect(project0).toBeTruthy();
    const activeChId = project0!.active_chapter_id || project0!.chapters[0].id;
    const firstSeg = project0!.chapters.find((c: any) => c.id === activeChId)!.segments[0];
    const segId = firstSeg.id;

    // ── 第一次录入：无既有音频，不出现覆盖确认 ──
    await page.getByRole('button', { name: '录入', exact: true }).first().click();
    await expect(page.getByText('录入片段音频')).toBeVisible({ timeout: 10_000 });
    await page.locator('input[type="file"][accept="audio/*"]').setInputFiles(FIXTURE_AUDIO);
    // 预览出现后才能确认
    await expect(page.locator('audio[controls]')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '使用此音频' }).click();

    // ── UI: 🔒 录入 角标出现 ──
    const badge = page.getByTitle('已录入音频，点击解锁后可重新合成').first();
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // 第一次录入的服务端路径（撤销链断言传后要用）
    const projectFirst = await readBackendProject(page, PROJECT_ID);
    const firstRecPath = projectFirst!.chapters.find((c: any) => c.id === activeChId)!
      .segments.find((s: any) => s.id === segId).audio.current.path;
    expect(firstRecPath).toMatch(/\.rec-[0-9a-f]{8}\.mp3$/);

    // ── 第二次录入：已有录入音频 -> 必须出现覆盖确认 ──
    await page.getByRole('button', { name: '录入', exact: true }).first().click();
    await expect(page.getByText('录入片段音频')).toBeVisible({ timeout: 10_000 });
    await page.locator('input[type="file"][accept="audio/*"]').setInputFiles(FIXTURE_AUDIO);
    await expect(page.locator('audio[controls]')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '使用此音频' }).click();
    await expect(page.getByText('该片段已有合成音频，录入将替换并删除现有音频，是否继续？'))
      .toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await expect(badge).toBeVisible({ timeout: 15_000 });

    // ── 双读: API + DB（草稿同步为防抖 PUT，轮询等待其收敛） ──
    let segAfter: any;
    let dbAudio: any;
    await expect.poll(async () => {
      const p = await readBackendProject(page, PROJECT_ID);
      segAfter = p!.chapters.find((c: any) => c.id === activeChId)!
        .segments.find((s: any) => s.id === segId);
      const bundle = await readDbProject(PROJECT_ID);
      const dbSeg = bundle!.segments.find((s) => s.id === segId);
      dbAudio = JSON.parse(dbSeg!.audio!);
      // API 与 DB 一致且都已切到第二次录入（current != 第一次的路径）
      return dbAudio.current?.path === segAfter.audio?.current?.path
        && dbAudio.current?.path !== firstRecPath;
    }, { timeout: 15_000, intervals: [500, 1000, 2000] }).toBe(true);

    expect(segAfter.audio?.current?.origin).toBe('recorded');
    expect(segAfter.audio.current.path).toMatch(/\.rec-[0-9a-f]{8}\.mp3$/);
    expect(segAfter.audio.current.duration_sec).toBeGreaterThan(0);
    // 撤销链：previous 指向第一次录入（origin 一并保留）
    expect(dbAudio.current.origin).toBe('recorded');
    expect(dbAudio.previous?.path).toBe(firstRecPath);
    expect(dbAudio.previous?.origin).toBe('recorded');

    // ── 磁盘: 录入文件真实存在（唯一 rec- 文件名） ──
    const dirName = projectDirNameForId(PROJECT_ID);
    expect(dirName).toBeTruthy();
    const files = listSegmentFiles(dirName!, activeChId, segId);
    expect(files.some((f) => f.includes('.rec-') && f.endsWith('.mp3'))).toBeTruthy();

    // ── 锁定保护: 重新生成被拦截 ──
    await page.getByRole('button', { name: '展开', exact: true }).click();
    await page.getByTitle('重新生成').first().click();
    await expect(page.getByText('已录入音频，需先解锁')).toBeVisible({ timeout: 10_000 });
    // 音频未被改动
    const projectBlocked = await readBackendProject(page, PROJECT_ID);
    const segBlocked = projectBlocked!.chapters.find((c: any) => c.id === activeChId)!
      .segments.find((s: any) => s.id === segId);
    expect(segBlocked.audio?.current?.origin).toBe('recorded');
    expect(segBlocked.audio.current.path).toBe(segAfter.audio.current.path);

    // ── 解锁: 角标消失，origin 清除（草稿同步回后端） ──
    await badge.click();
    await expect(page.getByText('解锁后可重新合成该片段，录入音频将保留为可撤销的历史版本。是否解锁？'))
      .toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.getByTitle('已录入音频，点击解锁后可重新合成')).toHaveCount(0, { timeout: 15_000 });

    await expect.poll(async () => {
      const p = await readBackendProject(page, PROJECT_ID);
      const s = p!.chapters.find((c: any) => c.id === activeChId)!
        .segments.find((x: any) => x.id === segId);
      return s.audio?.current?.origin ?? null;
    }, { timeout: 15_000 }).toBeNull();

    expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });
});
