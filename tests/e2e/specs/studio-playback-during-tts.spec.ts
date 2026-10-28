/**
 * 合成期间播放回归 E2E.
 *
 * 用户场景：A 段重新合成时，已完成的 B 段必须仍可播放；A 段自身也不能再显示
 * 播放按钮，而应显示「合成中」。
 *
 * 手法：先给 A、B 两段生成真实音频；再拦截 A 的合成 POST 并追加
 * `x-e2e-synth-delay-ms` 头，让后端在 worker 线程里真实地慢合成（请求照常
 * 打到后端，不在浏览器里挂起）。随后点 B 的播放按钮，断言音频 GET 立即返回
 * 且字节与合成前完全一致——若合成仍阻塞事件循环，该 GET 会被拖到合成结束。
 *
 * @feature docs/feature-spec.md §4.4 Segment Lifecycle
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  collectErrors,
  goToStudio,
  interceptPostResponse,
  readBackendProject,
  seedTestProject,
  setLocaleToZhCN,
} from '../helpers';
import { E2E_BACKEND_URL } from '../helpers/ports';

const PROJECT_ID = 'test-e2e-project';
const CHAPTER1_ID = 'test-chapter-1';
const SEGMENT_A = 'seg-1-1';
const SEGMENT_B = 'seg-1-2';
const SYNTH_DELAY_MS = 8_000;

type SegmentAudio = {
  current?: { path?: string; duration_sec?: number };
  previous?: { path?: string; duration_sec?: number };
};

async function backendSegmentAudio(
  page: Page,
  segmentId: string,
): Promise<SegmentAudio | undefined> {
  const p = await readBackendProject(page, PROJECT_ID);
  const seg = p?.chapters.flatMap((c) => c.segments).find((s) => s.id === segmentId);
  return seg?.audio as SegmentAudio | undefined;
}

function dataProjectsPath(relPath: string): string {
  return join('backend', 'data', 'projects', relPath);
}

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

/** 用紧凑行上的生成按钮为该段生成真实音频。 */
async function synthesizeSegment(page: Page, segmentId: string): Promise<void> {
  const row = page.locator(`[class*="compactCard"][data-segment-id="${segmentId}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });

  const synthDone = interceptPostResponse(page, `/segments/${segmentId}/synthesize`);
  await row.locator('[class*="compactGenBtn"]').click();
  expect((await synthDone).status).toBe(200);

  await expect.poll(async () => (await backendSegmentAudio(page, segmentId))?.current?.path, {
    timeout: 60_000,
  }).toBeTruthy();
}

test.describe('合成期间播放', () => {
  test.beforeEach(async ({ page }) => {
    await seedTestProject(page);
    await setLocaleToZhCN(page);
  });

  test('A 段合成中显示合成中，已完成的 B 段仍可立即播放', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);

    await goToStudio(page);
    await synthesizeSegment(page, SEGMENT_A);
    await synthesizeSegment(page, SEGMENT_B);

    const audioBefore = await backendSegmentAudio(page, SEGMENT_B);
    expect(audioBefore?.current?.path, 'B 段应已有音频文件').toBeTruthy();
    expect(audioBefore?.current?.duration_sec).toBeGreaterThan(0);

    const bAudioUrl =
      `${E2E_BACKEND_URL}/api/segmented-projects/${PROJECT_ID}/audio/${CHAPTER1_ID}/${SEGMENT_B}`;
    const bBefore = await page.request.get(bAudioUrl);
    expect(bBefore.status()).toBe(200);
    const bBeforeBody = await bBefore.body();
    expect(bBeforeBody.length).toBeGreaterThan(1_000);

    // 展开 A 段编辑面板（点击紧凑行文本），入口在 accordion 内。
    const rowA = page.locator(`[class*="compactCard"][data-segment-id="${SEGMENT_A}"]`);
    await rowA.locator('[class*="compactText"]').click();
    const panel = page.locator('[class*="accordionWrapper"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // 让 A 的合成在后端 worker 线程里真实地慢 8 秒；请求本身照常打到后端。
    await page.route(
      new RegExp(`/segments/${SEGMENT_A}/synthesize$`),
      (route) => route.continue({
        headers: {
          ...route.request().headers(),
          'x-e2e-synth-delay-ms': String(SYNTH_DELAY_MS),
        },
      }),
    );

    const synthStartedAt = Date.now();
    const synthDone = interceptPostResponse(page, `/segments/${SEGMENT_A}/synthesize`);
    await panel.getByRole('button', { name: '重新生成' }).click();

    // A 段：紧凑行和展开行都不再显示播放按钮，改为合成中。
    await expect(rowA.locator('button[title="播放"]')).toHaveCount(0, { timeout: 10_000 });
    await expect(rowA.locator('[title="合成中..."]')).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByRole('button', { name: '合成中...' })).toBeDisabled();
    await expect(panel.getByRole('button', { name: '合成中...' })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    // B 段：不受 A 段合成影响，仍显示播放按钮，且点击后音频 GET 立即返回。
    const rowB = page.locator(`[class*="compactCard"][data-segment-id="${SEGMENT_B}"]`);
    const playB = rowB.locator('button[title="播放"]');
    await expect(playB).toBeVisible({ timeout: 10_000 });

    const bDuringResp = page.waitForResponse(
      (r) => r.request().method() === 'GET'
        && r.url().includes(`/audio/${CHAPTER1_ID}/${SEGMENT_B}`),
      { timeout: 20_000 },
    );
    const playStartedAt = Date.now();
    await playB.click();
    const during = await bDuringResp;
    const playElapsed = Date.now() - playStartedAt;

    expect(during.status()).toBe(200);
    const bDuringBody = await during.body();
    // 阈值远小于 8s 合成延迟：若事件循环被合成阻塞，这里必然超时/超阈值。
    expect(playElapsed, 'B 段音频 GET 不应等待 A 段合成').toBeLessThan(4_000);
    expect(sha256(bDuringBody)).toBe(sha256(bBeforeBody));

    // 合成期间不应出现「暂无音频 / 播放失败」提示。
    await expect(page.getByText(/该段落暂无音频|播放失败/)).toHaveCount(0);

    // 等 A 段真实合成完成：POST 返回 200，行恢复播放按钮。
    expect((await synthDone).status).toBe(200);
    expect(Date.now() - synthStartedAt).toBeGreaterThanOrEqual(SYNTH_DELAY_MS - 1_000);

    await expect(rowA.locator('button[title="播放"]')).toBeVisible({ timeout: 30_000 });
    await expect(rowA.locator('[title="合成中..."]')).toHaveCount(0);

    const audioAfter = await backendSegmentAudio(page, SEGMENT_A);
    expect(audioAfter?.current?.path).toBeTruthy();
    expect(audioAfter?.current?.duration_sec).toBeGreaterThan(0);
    expect(audioAfter?.previous?.path).toBeTruthy();
    expect(audioAfter?.previous?.path).not.toBe(audioAfter?.current?.path);
    expect(existsSync(dataProjectsPath(audioAfter!.current!.path!)), '当前音频应落盘').toBe(true);
    expect(existsSync(dataProjectsPath(audioAfter!.previous!.path!)), '上一版音频应独立落盘').toBe(true);

    // B 段在 A 合成前后完全未变。
    const audioBAfter = await backendSegmentAudio(page, SEGMENT_B);
    expect(audioBAfter?.current).toEqual(audioBefore?.current);
    expect(audioBAfter?.previous).toBeUndefined();

    expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });

  test('A 段合成失败后：旧音频仍可播放，合成入口显示为重新生成而非第二个 ▶', async ({ page }) => {
    // 回归：failed + 旧音频保留（#112 起）曾同时渲染合成 ▶ 与播放 ▶，
    // 用户看到两个一模一样的播放按钮（云端 TTS 易失败，本地难以复现）。
    test.setTimeout(180_000);
    const errors = collectErrors(page);

    await goToStudio(page);
    await synthesizeSegment(page, SEGMENT_A);

    // 展开 A 段，让这次重新合成真实地失败（后端 worker 线程延迟 2s 后 422）。
    const rowA = page.locator(`[class*="compactCard"][data-segment-id="${SEGMENT_A}"]`);
    await rowA.locator('[class*="compactText"]').click();
    const panel = page.locator('[class*="accordionWrapper"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    await page.route(
      new RegExp(`/segments/${SEGMENT_A}/synthesize$`),
      (route) => route.continue({
        headers: {
          ...route.request().headers(),
          'x-e2e-synth-fail-ms': '2000',
        },
      }),
    );

    const synthDone = interceptPostResponse(page, `/segments/${SEGMENT_A}/synthesize`);
    await panel.getByRole('button', { name: '重新生成' }).click();
    expect((await synthDone).status).toBe(422);

    // 失败后行内按钮构成：恰好一个播放 ▶ + 一个重新生成 ↻，不再有两个 ▶。
    await expect(rowA.locator('button[title="播放"]')).toHaveCount(1, { timeout: 10_000 });
    await expect(rowA.locator('button[title="重新生成"]')).toHaveCount(1);
    const regenBtn = rowA.locator('button[title="重新生成"]');
    expect((await regenBtn.textContent())?.trim()).toBe('↻');
    expect(await rowA.locator('button').evaluateAll(
      (btns) => btns.filter((b) => b.textContent?.includes('▶')).length,
    )).toBe(1);

    // 旧音频字节级未变，仍可播放。
    const audioBefore = await backendSegmentAudio(page, SEGMENT_A);
    const aAudioUrl =
      `${E2E_BACKEND_URL}/api/segmented-projects/${PROJECT_ID}/audio/${CHAPTER1_ID}/${SEGMENT_A}`;
    const before = await page.request.get(aAudioUrl);
    expect(before.status()).toBe(200);
    const beforeBody = await before.body();

    const duringResp = page.waitForResponse(
      (r) => r.request().method() === 'GET'
        && r.url().includes(`/audio/${CHAPTER1_ID}/${SEGMENT_A}`),
      { timeout: 20_000 },
    );
    await rowA.locator('button[title="播放"]').click();
    const during = await duringResp;
    expect(during.status()).toBe(200);
    expect(sha256(await during.body())).toBe(sha256(beforeBody));

    // 展开态同样：面板重新生成按钮恢复可用，合成中状态已退出。
    const panelRegen = panel.getByRole('button', { name: '重新生成' });
    await expect(panelRegen).toBeVisible();
    await expect(panelRegen).toBeEnabled();

    // 浏览器会把有意注入的 422 合成失败记为 console error，这里豁免。
    expect(errors.filter((e) => !e.includes('favicon') && !e.includes('422'))).toEqual([]);
  });
});
