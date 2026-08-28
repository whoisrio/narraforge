/**
 * Studio 全项目搜索 + 合成时文本变换（发音映射 / 大写转小写）E2E.
 *
 * 链路：UI 操作 -> 后端持久化（整项目 PUT / config 端点）-> 双读校验
 * （readBackendProject API 层 + 页面回显）-> 合成后 generated_params.effective_text
 * 为实际送引擎文本，segment.text 原文与导出不变。
 *
 * @feature docs/superpowers/specs/2026-08-25-studio-search-and-text-transforms-design.md
 */
import { expect, test, type Page } from '@playwright/test';
import { E2E_BACKEND_URL } from '../helpers/ports';
import {
  collectErrors,
  setLocaleToZhCN,
  goToStudio,
  readBackendProject,
  interceptPostResponse,
  seedTestProject,
} from '../helpers';

const BACKEND = E2E_BACKEND_URL;
const PROJECT_ID = 'test-e2e-project';
const SEG_ID = 'seg-e2e-transform';

/** 读项目（API 层），失败抛错。 */
async function readProject(page: Page) {
  const p = await readBackendProject(page, PROJECT_ID);
  expect(p).toBeTruthy();
  return p!;
}

async function findSeg(page: Page, segId: string) {
  const p = await readProject(page);
  return p.chapters.flatMap((c) => c.segments).find((s) => s.id === segId);
}

/** 清掉目标段音频使其回到 idle（compact 模式只有 idle 有生成按钮）。 */
async function resetSegmentAudio(page: Page) {
  const resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
  const project = await resp.json();
  const seg = project.chapters
    .flatMap((c: { segments: { id: string }[] }) => c.segments)
    .find((s: { id: string }) => s.id === SEG_ID);
  seg.audio = { format: 'mp3' };
  seg.status = 'idle';
  await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
}

/** 项目级 configs 补丁（发音映射/开关），经整项目 PUT 落库。 */
async function patchProjectConfigs(
  page: Page,
  patch: Record<string, unknown>,
) {
  const resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
  const project = await resp.json();
  project.configs = { ...(project.configs ?? {}), ...patch };
  await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
}

/** 搜索跳转到目标段（切章节 + 选中 + 滚动定位；段选中后手风琴编辑面板自动展开）。 */
async function searchNavigateToSeg(page: Page) {
  await page.getByLabel('搜索全项目片段').fill('调动');
  await page.getByRole('option', { name: /他调动了/ }).click();
}

test.describe('Studio 搜索 + 文本变换', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await seedTestProject(page);
      // 本 spec 专用数据：项目字典（调动->掉动）+ 第 2 章含「调动」「REST API」的段
      const resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
      const project = await resp.json();
      project.configs = {
        ...(project.configs ?? {}),
        pronunciation_map: [{ id: 'pm_e2e_diaodong', source: '调动', target: '掉动' }],
      };
      const ch2 = project.chapters.find((c: { id: string }) => c.id === 'test-chapter-2');
      if (!ch2.segments.some((s: { id: string }) => s.id === SEG_ID)) {
        ch2.segments.push({
          id: SEG_ID, position: ch2.segments.length,
          text: '他调动了 REST API 接口。', segment_kind: 'narration',
          emotion: 'neutral', voice: { source: 'chapter' }, audio: { format: 'mp3' },
        });
      }
      await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    // 复位：清掉本 spec 的变换配置与专用段，避免影响其他 spec
    const page = await browser.newPage();
    try {
      const resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
      const project = await resp.json();
      if (project.configs) {
        delete project.configs.pronunciation_map;
        delete project.configs.pronunciation_apply_all;
        delete project.configs.lowercase_latin;
      }
      const ch2 = project.chapters.find((c: { id: string }) => c.id === 'test-chapter-2');
      ch2.segments = ch2.segments.filter((s: { id: string }) => s.id !== SEG_ID);
      await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
    } finally {
      await page.close();
    }
  });

  test('全项目搜索：跨章节命中 -> 点击结果切换章节并定位高亮', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    await goToStudio(page);

    // 「调动」只在第 2 章的专用段里
    const searchInput = page.getByLabel('搜索全项目片段');
    await searchInput.fill('调动');
    const results = page.getByRole('listbox', { name: '搜索结果' });
    await expect(results).toBeVisible({ timeout: 5_000 });
    await expect(results.getByText('1 处命中')).toBeVisible();

    await results.getByRole('option', { name: /他调动了/ }).click();

    // 章节切换 + 目标段可见 + 闪烁高亮（data-segment-id 锚点 + flash 类）
    const target = page.locator(`[data-segment-id="${SEG_ID}"]`);
    await expect(target).toBeVisible({ timeout: 5_000 });
    await expect(target).toHaveClass(/flash/, { timeout: 3_000 });
    expect(errors).toEqual([]);
  });

  test('发音映射：面板勾选命中段 -> 合成文本替换，原文不变', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    await goToStudio(page);

    // ── UI: 打开发音映射面板 -> 选中「调动 -> 掉动」-> 勾选命中段 ──
    await page.getByRole('button', { name: '发音映射' }).click();
    const dialog = page.getByRole('dialog', { name: '发音映射' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /调动 -> 掉动/ }).click();
    await expect(dialog.getByText('1 个命中段')).toBeVisible();
    // 替换后效果预览（镜像计算）
    await expect(dialog.getByText('他掉动了 REST API 接口。')).toBeVisible();
    await dialog.getByLabel('应用到该段').check();
    await dialog.getByLabel('关闭').click();

    // ── 双读: applied_map_ids 随整项目 PUT 落库 ──
    await expect.poll(async () => {
      const seg = await findSeg(page, SEG_ID);
      return (seg as unknown as { text_transforms?: { applied_map_ids?: string[] } })
        ?.text_transforms?.applied_map_ids ?? [];
    }, { timeout: 10_000 }).toContain('pm_e2e_diaodong');

    // ── 触发合成（先清音频回 idle，再点生成） ──
    await resetSegmentAudio(page);
    await goToStudio(page);
    await searchNavigateToSeg(page);

    const synthResponsePromise = interceptPostResponse(page, '/synthesize');
    const row = page.locator(`[data-segment-id="${SEG_ID}"]`);
    await row.locator('[class*="compactGenBtn"]').click();
    const synthResponse = await synthResponsePromise;
    expect(synthResponse.status).toBe(200);

    // ── 双读: effective_text = 替换后文本；原文不变 ──
    await expect.poll(async () => {
      const seg = await findSeg(page, SEG_ID);
      return (seg?.generated_params as Record<string, unknown> | undefined)?.effective_text ?? null;
    }, { timeout: 60_000 }).toBe('他掉动了 REST API 接口。');

    const seg = await findSeg(page, SEG_ID);
    expect(seg!.text).toBe('他调动了 REST API 接口。');
    expect(errors).toEqual([]);
  });

  test('pronunciation_apply_all 无脑流程：项目开关 -> 任意段全量生效', async ({ page }) => {
    test.setTimeout(120_000);
    await setLocaleToZhCN(page);
    // 项目设置开关经 API 打开（UI 开关的单元测试已覆盖回调链路）
    await patchProjectConfigs(page, { pronunciation_apply_all: true });
    // 清掉段级引用：证明生效不依赖逐段勾选
    const resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const project = await resp.json();
    const seg = project.chapters
      .flatMap((c: { segments: { id: string }[] }) => c.segments)
      .find((s: { id: string }) => s.id === SEG_ID);
    delete seg.text_transforms;
    seg.audio = { format: 'mp3' };
    seg.status = 'idle';
    await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });

    await goToStudio(page);
    await searchNavigateToSeg(page);
    const synthResponsePromise = interceptPostResponse(page, '/synthesize');
    await page.locator(`[data-segment-id="${SEG_ID}"]`).locator('[class*="compactGenBtn"]').click();
    expect((await synthResponsePromise).status).toBe(200);

    await expect.poll(async () => {
      const s = await findSeg(page, SEG_ID);
      return (s?.generated_params as Record<string, unknown> | undefined)?.effective_text ?? null;
    }, { timeout: 60_000 }).toBe('他掉动了 REST API 接口。');

    await patchProjectConfigs(page, { pronunciation_apply_all: null });
  });

  test('大写转小写：项目默认开 -> 段级关覆盖 -> 恢复跟随项目', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    await patchProjectConfigs(page, { lowercase_latin: true, pronunciation_apply_all: true });

    // ── 段级关覆盖（UI：搜索跳转选中段 -> 编辑面板三态「关」） ──
    await resetSegmentAudio(page);
    await goToStudio(page);
    await searchNavigateToSeg(page);
    const editPanel = page.locator('[class*="accordionWrapper"]');
    await editPanel.getByRole('button', { name: '关', exact: true }).click();

    await expect.poll(async () => {
      const s = await findSeg(page, SEG_ID);
      return (s as unknown as { text_transforms?: { lowercase_latin?: boolean | null } })
        ?.text_transforms?.lowercase_latin ?? null;
    }, { timeout: 10_000 }).toBe(false);

    // 段级关 -> REST API 保持大写；发音映射（apply_all）仍生效
    let synthResponsePromise = interceptPostResponse(page, '/synthesize');
    await resetSegmentAudio(page);
    await goToStudio(page);
    await searchNavigateToSeg(page);
    await page.locator(`[data-segment-id="${SEG_ID}"]`).locator('[class*="compactGenBtn"]').click();
    expect((await synthResponsePromise).status).toBe(200);
    await expect.poll(async () => {
      const s = await findSeg(page, SEG_ID);
      return (s?.generated_params as Record<string, unknown> | undefined)?.effective_text ?? null;
    }, { timeout: 60_000 }).toBe('他掉动了 REST API 接口。');

    // ── 恢复「跟随项目」-> 项目默认开 -> 小写化生效 ──
    await page.locator('[class*="accordionWrapper"]').getByRole('button', { name: '跟随项目' }).click();
    await expect.poll(async () => {
      const s = await findSeg(page, SEG_ID);
      return (s as unknown as { text_transforms?: { lowercase_latin?: boolean | null } })
        ?.text_transforms?.lowercase_latin ?? null;
    }, { timeout: 10_000 }).toBe(null);

    synthResponsePromise = interceptPostResponse(page, '/synthesize');
    await resetSegmentAudio(page);
    await goToStudio(page);
    await searchNavigateToSeg(page);
    await page.locator(`[data-segment-id="${SEG_ID}"]`).locator('[class*="compactGenBtn"]').click();
    expect((await synthResponsePromise).status).toBe(200);
    await expect.poll(async () => {
      const s = await findSeg(page, SEG_ID);
      return (s?.generated_params as Record<string, unknown> | undefined)?.effective_text ?? null;
    }, { timeout: 60_000 }).toBe('他掉动了 rest api 接口。');

    // 原文始终不变（字幕/SRT 导出同源）
    const seg = await findSeg(page, SEG_ID);
    expect(seg!.text).toBe('他调动了 REST API 接口。');

    await patchProjectConfigs(page, { lowercase_latin: null, pronunciation_apply_all: null });
    expect(errors).toEqual([]);
  });
});
