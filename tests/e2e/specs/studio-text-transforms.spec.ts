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

// 良性冲突白名单：本 spec 刻意用 out-of-band raw PUT 并发改动服务端，
// 与前端 auto-save flush 抢乐观锁，必然偶发 stale_payload 409。该 409 已被产品
// 优雅恢复（adoptBackendVersion + info toast），非功能缺陷，断言时放过；
// 真实错误（422 段落超长 / 5xx / 未捕获异常等）仍照常捕获。
function benignErrorsOnly(errors: string[]): string[] {
  return errors.filter((e) => !/409 \(Conflict\)|stale_payload/i.test(e));
}

/** 段级 PATCH 清掉 text_transforms（整量 PUT 无法清除，tri-state 得走 PATCH）。 */
async function clearSegmentTransforms(page: Page) {
  const r = await page.request.patch(
    `${BACKEND}/api/segmented-projects/${PROJECT_ID}/chapters/test-chapter-2/segments/${SEG_ID}`,
    { data: { text_transforms: null } },
  );
  expect(r.status()).toBe(200);
}

/** 清掉目标段音频使其回到 idle（compact 模式只有 idle 有生成按钮）。
 * 后端 design：已存在段的 audio/generated_params/generated_at 是服务端自产字段，
 * 整量 PUT 一律忽略，防陈旧 autosave 快照把合成状态回退掉。因此测试不能靠
 * `seg.audio={format:'mp3'}` 清掉已存在段的音频。
 * 本 helper 的 workaround：先把目标段从项目里删除落库，再作为新段加回来
 * （新段接受 payload 里的 audio），并保留 text_transforms 等用户设置。
 * 删除前会等前端待冲刷草稿完全落库，避免延迟 flush 在删除-重建之间
 * 又把带 audio.current 的段写回来。 */
async function resetSegmentAudio(page: Page) {
  // 关键：先整页重载，取消前端任何在途的 auto-save flush（导航会 abort 在途请求），
  // 确保接下来对服务端的 out-of-band 变更不会与前端草稿同步抢乐观锁（409 stale_payload）。
  // 重载后前端经 adoptBackendVersion 用最新 updated_at 重建草稿 base。
  await goStudio(page);
  // 等网络空闲 + 服务端 updated_at 连续 1.5s 不变，确认无在途写之后再动服务端。
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  const getUpdatedAt = async () => {
    const r = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    return (await r.json()).updated_at as string;
  };
  let last = await getUpdatedAt();
  let stableMs = 0;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    const now = await getUpdatedAt();
    if (now === last) {
      stableMs += 300;
      if (stableMs >= 1500) break;
    } else {
      stableMs = 0;
      last = now;
    }
  }

  const resp1 = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
  const p1 = await resp1.json();
  const ch2_1 = p1.chapters.find((c: { id: string }) => c.id === 'test-chapter-2');
  const oldSeg = ch2_1.segments.find((s: { id: string }) => s.id === SEG_ID);
  ch2_1.segments = ch2_1.segments.filter((s: { id: string }) => s.id !== SEG_ID);
  await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: p1 });

  const resp2 = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
  const p2 = await resp2.json();
  const ch2_2 = p2.chapters.find((c: { id: string }) => c.id === 'test-chapter-2');
  ch2_2.segments.push({
    id: SEG_ID,
    position: ch2_2.segments.length,
    text: oldSeg.text,
    segment_kind: oldSeg.segment_kind ?? 'narration',
    emotion: oldSeg.emotion ?? 'neutral',
    role_id: oldSeg.role_id,
    voice: oldSeg.voice ?? { source: 'chapter' },
    audio: { format: 'mp3' },
    text_transforms: oldSeg.text_transforms,
  });
  await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: p2 });
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

/** 进入工作室并等待网络空闲。
 * 关键：整页重载后前端会经 adoptBackendVersion 把草稿乐观锁 base 设为
 * 服务端当前 updated_at；等待 networkidle 确保初始加载的 adopt 落盘、
 * 初始自动保存完全平息，再交还控制权给用例——避免紧随其后的用户动作 flush
 * 在 adopt 尚未稳定时携带陈旧 base，进而偶发 409 stale_payload。
 * （本 spec 的失败经排查为跨用例共享 test-e2e-project 的状态串扰，非产品缺陷。） */
async function goStudio(page: Page) {
  await goToStudio(page);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
}

test.describe('Studio 搜索 + 文本变换', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await seedTestProject(page);
    } finally {
      await page.close();
    }
  });

  // 每个用例独立基线：清掉变换配置 + 确保专用段以 idle 状态存在，
  // 再整页重载让前端草稿同步 adopt 最新服务端版本。
  // 目的：消除用例间共享 test-e2e-project 导致的状态串扰（表现为偶发 409
  // stale_payload，进而让后续 UI 断言超时）——这是测试隔离问题，不是产品缺陷。
  test.beforeEach(async ({ page }) => {
    const resp = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const project = await resp.json();
    project.configs = {
      ...(project.configs ?? {}),
      pronunciation_map: [{ id: 'pm_e2e_diaodong', source: '调动', target: '掉动' }],
      pronunciation_apply_all: null,
      lowercase_latin: null,
    };
    const ch2 = project.chapters.find((c: { id: string }) => c.id === 'test-chapter-2');
    const segExists = ch2.segments.some((s: { id: string }) => s.id === SEG_ID);
    if (!segExists) {
      ch2.segments.push({
        id: SEG_ID, position: ch2.segments.length,
        text: '他调动了 REST API 接口。', segment_kind: 'narration',
        emotion: 'neutral', voice: { source: 'chapter' }, audio: { format: 'mp3' },
      });
    }
    await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });

    // 已存在段：整量 PUT 不能清 audio（后端视为服务端自产字段），
    // 必须 PATCH 清掉 text_transforms 后再 delete+recreate 重建为 idle。
    if (segExists) {
      await clearSegmentTransforms(page);
      await resetSegmentAudio(page);
    }
    await goStudio(page);
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
    await goStudio(page);

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
    expect(benignErrorsOnly(errors)).toEqual([]);
  });

  test('发音映射：面板勾选命中段 -> 合成文本替换，原文不变', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    await goStudio(page);

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
    await goStudio(page);
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
    expect(benignErrorsOnly(errors)).toEqual([]);
  });

  test('pronunciation_apply_all 无脑流程：项目开关 -> 任意段全量生效', async ({ page }) => {
    test.setTimeout(120_000);
    await setLocaleToZhCN(page);
    // 项目设置开关经 API 打开（UI 开关的单元测试已覆盖回调链路）
    await patchProjectConfigs(page, { pronunciation_apply_all: true });
    // 清掉段级引用：证明生效不依赖逐段勾选。
    // 整量 PUT 无法清已存在段的 audio 和 text_transforms，用 PATCH + 删段重建。
    await clearSegmentTransforms(page);
    await resetSegmentAudio(page);

    await goStudio(page);
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
    await goStudio(page);
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
    await goStudio(page);
    await searchNavigateToSeg(page);
    await page.locator(`[data-segment-id="${SEG_ID}"]`).locator('[class*="compactGenBtn"]').click();
    expect((await synthResponsePromise).status).toBe(200);
    await expect.poll(async () => {
      const s = await findSeg(page, SEG_ID);
      return (s?.generated_params as Record<string, unknown> | undefined)?.effective_text ?? null;
    }, { timeout: 60_000 }).toBe('他掉动了 REST API 接口。');

    // 第一次合成的自动保存 flush 会让 UI 重渲染，编辑面板可能折叠；等它落库平息后重新展开段编辑面板
    await page.waitForLoadState('networkidle').catch(() => {});
    await searchNavigateToSeg(page);

    // ── 恢复「跟随项目」-> 项目默认开 -> 小写化生效 ──
    await page.locator('[class*="accordionWrapper"]').getByRole('button', { name: '跟随项目' }).click();
    await expect.poll(async () => {
      const s = await findSeg(page, SEG_ID);
      return (s as unknown as { text_transforms?: { lowercase_latin?: boolean | null } })
        ?.text_transforms?.lowercase_latin ?? null;
    }, { timeout: 10_000 }).toBe(null);

    synthResponsePromise = interceptPostResponse(page, '/synthesize');
    await resetSegmentAudio(page);
    await goStudio(page);
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
    expect(benignErrorsOnly(errors)).toEqual([]);
  });
});
