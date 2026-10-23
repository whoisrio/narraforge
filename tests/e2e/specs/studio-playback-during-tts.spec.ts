/**
 * 合成期间播放回归 E2E.
 *
 * 用户场景：某段已有音频，点「重新生成」后状态变 queued/pending，旧音频仍然
 * 有效；此时播放按钮必须可见且能取到旧音频，TTS 与播放互不阻塞。
 *
 * 手法：先用真实 TTS 给首段生成音频，再用 page.route 扣住重新合成的请求，
 * 把「合成在途」窗口拉长到确定，然后点击播放并断言旧音频 GET 返回 200。
 *
 * @feature docs/feature-spec.md §4.4 Segment Lifecycle
 */
import { expect, test, type Page } from '@playwright/test';
import {
  collectErrors,
  goToStudio,
  interceptPostResponse,
  readBackendProject,
  seedTestProject,
  setLocaleToZhCN,
} from '../helpers';

const PROJECT_ID = 'test-e2e-project';
const CHAPTER1_ID = 'test-chapter-1';
const SEGMENT_ID = 'seg-1-1';

async function backendAudioPath(page: Page): Promise<string | null> {
  const p = await readBackendProject(page, PROJECT_ID);
  const seg = p?.chapters.flatMap((c) => c.segments).find((s) => s.id === SEGMENT_ID);
  return seg?.audio?.current?.path ?? null;
}

/** 给首段生成真实音频（seed 只有 idle 占位，没有可播放文件）。 */
async function synthesizeFirstSegment(page: Page): Promise<void> {
  const row = page.locator(`[class*="compactCard"][data-segment-id="${SEGMENT_ID}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });

  const synthDone = interceptPostResponse(page, '/synthesize');
  await row.locator('[class*="compactGenBtn"]').click();
  expect((await synthDone).status).toBe(200);

  await expect.poll(() => backendAudioPath(page), { timeout: 60_000 }).toBeTruthy();
}

test.describe('合成期间播放', () => {
  test.beforeEach(async ({ page }) => {
    await seedTestProject(page);
    await setLocaleToZhCN(page);
  });

  test('重新合成在途时旧音频仍可播放（不依赖 status=ready）', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);

    await goToStudio(page);
    await synthesizeFirstSegment(page);

    // 展开首段编辑面板：紧凑行本身没有重新生成按钮，入口在 accordion 内
    const compact = page.locator(`[class*="compactCard"][data-segment-id="${SEGMENT_ID}"]`);
    await compact.locator('[class*="compactText"]').click();
    const panel = page.locator('[class*="accordionWrapper"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // 扣住重新合成的 POST，让 status=queued/pending 的窗口无限长
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let markSeen!: () => void;
    const firstSynth = new Promise<void>((resolve) => { markSeen = resolve; });
    await page.route(/\/segments\/[^/]+\/synthesize$/, async (route) => {
      markSeen();
      await gate;
      await route.continue();
    });

    const oldAudioPath = await backendAudioPath(page);
    expect(oldAudioPath, '首段应已有可播放音频').toBeTruthy();

    await panel.getByRole('button', { name: '重新生成' }).click();
    await firstSynth;

    // 合成在途：播放按钮仍在（旧实现要求 status=ready，会消失）
    const playBtn = compact.locator('button[title="播放"]');
    await expect(playBtn).toBeVisible({ timeout: 10_000 });

    // 点击播放 → 请求旧音频（不是等待合成完成）
    const audioResp = page.waitForResponse(
      (r) => r.request().method() === 'GET'
        && r.url().includes(`/segmented-projects/${PROJECT_ID}/audio/${CHAPTER1_ID}/${SEGMENT_ID}`),
      { timeout: 20_000 },
    );
    await playBtn.click();
    expect((await audioResp).status()).toBe(200);

    // 没有"无音频"或播放失败提示
    await expect(page.getByText(/该段落暂无音频|播放失败/)).toHaveCount(0);

    // 放行合成，收尾避免留下未完成请求
    release();
    await expect.poll(() => backendAudioPath(page), { timeout: 60_000 }).toBeTruthy();

    expect(errors.filter((e) => !e.includes('favicon'))).toEqual([]);
  });
});
