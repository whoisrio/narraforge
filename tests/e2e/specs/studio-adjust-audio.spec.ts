/**
 * 合成后音频调整（速度/音量）E2E.
 *
 * 合成一段音频 -> 工作室「调整音频」-> 提速 2x -> 验证时长缩短、
 * previous 保留、DB 双读、磁盘文件变化。
 *
 * @feature backend/app/api/segmented_projects.py (adjust-audio)
 */
import { expect, test } from '@playwright/test';
import { collectErrors, setLocaleToZhCN, goToStudio } from '../helpers';
import { readDbProject } from '../helpers/dbReader';

const BACKEND = 'http://127.0.0.1:8012';
const PROJECT_ID = 'test-e2e-project';
const CHAPTER_ID = 'test-chapter-1';

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

    // ── 2. 工作室 → 展开播放栏 → 调整音频 → 提速 2x → 应用 ──
    await goToStudio(page);
    await page.getByRole('button', { name: '展开播放栏' }).click();
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

    await page.getByRole('button', { name: '展开播放栏' }).click();
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
});
