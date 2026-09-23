/**
 * 分段项目保存冲突自愈与草稿保护 E2E.
 *
 * 链路：UI 编辑 → 整包 PUT 撞乐观锁 409 → 第一层自愈（假冲突静默重试）或
 * 第二层裁决（真冲突模态弹窗 + 草稿归档）→ API 层 + DB 层双读校验。
 *
 * 三层场景：
 *   1. 假冲突自愈 —— 整包 PUT 在途时本端细粒度写推进服务端版本，PUT 落地即 409，
 *      但该版本是本端自己写的 → 零 UI 打扰重试成功，编辑零丢失。
 *   2. 真冲突裁决「用草稿」—— 外部写入（模拟 agent / 另一标签页）推进服务端，
 *      PUT 409 → 归档 + 模态弹窗 → force save 把用户选的草稿真正落库。
 *   3. 真冲突裁决「用后端」+ 归档找回 —— 采纳权威态后仍可从「冲突草稿」入口
 *      找回被放弃的草稿，再走一次裁决落库。
 *
 * 关键手法：用 page.route 把整包 PUT 扣住不发给服务端，让"制造并发写"与
 * "放行 PUT"两步的顺序完全可控，避免靠 sleep 赌时序。
 *
 * @feature docs/plans/2026-09-23-segmented-save-conflict-recovery-design.md
 */
import { expect, test, type Page } from '@playwright/test';
import { E2E_BACKEND_URL } from '../helpers/ports';
import {
  collectErrors,
  goToStudio,
  readBackendProject,
  seedTestProject,
  setLocaleToZhCN,
} from '../helpers';
import { readDbProject } from '../helpers/dbReader';
import { verifyDbWithScreenshot } from '../helpers/dualReadSnapshot';

const BACKEND = E2E_BACKEND_URL;
const PROJECT_ID = 'test-e2e-project';
const CHAPTER1_ID = 'test-chapter-1';

const LOCAL_CHAPTER_NAME = '第1章 夜路·本地改';
const EXTERNAL_CHAPTER_NAME = '第1章 外部改名';
const LOCAL_SEGMENT_TEXT = '这是一段被 E2E 改写过的段落文本。';

/** 本项目整包 PUT 的 URL（正则锚定结尾，不吃 PATCH/POST 的段级端点）。 */
const PROJECT_PUT_RE = new RegExp(`/api/segmented-projects/${PROJECT_ID}$`);

// ── 读取 ─────────────────────────────────────────────────────────────────────

async function readProject(page: Page) {
  const p = await readBackendProject(page, PROJECT_ID);
  expect(p, `项目 ${PROJECT_ID} 应存在于后端`).toBeTruthy();
  return p!;
}

async function readApiChapterName(page: Page): Promise<string> {
  return (await readProject(page)).chapters.find((c) => c.id === CHAPTER1_ID)?.name ?? '';
}

async function readDbChapterName(): Promise<string> {
  const db = await readDbProject(PROJECT_ID);
  expect(db, `项目 ${PROJECT_ID} 应存在于 DB`).toBeTruthy();
  return db!.chapters.find((c) => c.id === CHAPTER1_ID)?.name ?? '';
}

/** 等前端在途写完全落库：网络空闲 + 服务端 updated_at 连续 1.5s 不变。 */
async function waitForStableProject(page: Page): Promise<void> {
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
      if (stableMs >= 1_500) return;
    } else {
      stableMs = 0;
      last = now;
    }
  }
}

// ── 整包 PUT 闸门 ─────────────────────────────────────────────────────────────

interface PutGate {
  /** 放行所有被扣住的 PUT（放行后再来的 PUT 直接通过）。 */
  release: () => void;
  /** 等到至少一个 PUT 已被扣住。 */
  waitForFirstPut: () => Promise<void>;
}

/**
 * 扣住前端发往服务端的整包 PUT，直到 release()。
 * 这样"PUT 已在途但还没落地"这个窗口可以被无限拉长，制造并发写变得确定。
 */
async function gateProjectPuts(page: Page): Promise<PutGate> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let markSeen!: () => void;
  const firstPut = new Promise<void>((resolve) => { markSeen = resolve; });
  let seen = false;

  await page.route(PROJECT_PUT_RE, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    if (!seen) {
      seen = true;
      markSeen();
    }
    await gate;
    await route.continue();
  });

  return { release, waitForFirstPut: () => firstPut };
}

// ── 操作 ─────────────────────────────────────────────────────────────────────

/** 应用内切到「工作室」（TTSSynthesis 保持挂载，draftSync 不重建）。 */
async function goStudioSection(page: Page): Promise<void> {
  await page.getByRole('button', { name: /◉ 工作室/ }).first().click();
  await expect(page.getByRole('button', { name: /批量合成|Batch Synthesize/ }).first())
    .toBeVisible({ timeout: 15_000 });
}

/**
 * 确保文本库的章节编辑器打开（幂等）：
 * 已在编辑器里就直接返回；否则 文本库 → 章节 → 打开文本。
 * 不能无脑重复点「文本库」——冲突裁决后页面本来就停在编辑器里，
 * 再点一次侧边栏会退到别的视图，反而找不到「章节」标签。
 */
async function openChapterEditor(page: Page): Promise<void> {
  const titleInput = page.getByRole('textbox', { name: '章节标题' });
  if (await titleInput.isVisible().catch(() => false)) return;

  const chapterTab = page.getByRole('button', { name: '章节', exact: true });
  if (!(await chapterTab.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /文本库/ }).first().click();
  }
  await expect(chapterTab).toBeVisible({ timeout: 15_000 });
  await chapterTab.click();
  await page.getByRole('button', { name: '打开文本' }).first().click();
  await expect(titleInput).toBeVisible({ timeout: 10_000 });
}

/**
 * 在文本库改第一章标题 → RENAME_CHAPTER（touch=true）→ markDirty → 1s 防抖整包 PUT。
 * 这是"产生脏草稿"的最省事入口，也是设计 §1.3 里用户最常走的路径。
 */
async function renameChapterInLibrary(page: Page, name: string): Promise<void> {
  await openChapterEditor(page);
  const titleInput = page.getByRole('textbox', { name: '章节标题' });
  await titleInput.fill(name);
}

/** 断言文本库编辑器里的章节标题（UI 回显层校验）。 */
async function expectChapterTitleInLibrary(page: Page, name: string): Promise<void> {
  await openChapterEditor(page);
  await expect(page.getByRole('textbox', { name: '章节标题' }))
    .toHaveValue(name, { timeout: 15_000 });
}

/** 在工作室改写第一个段落的文本 → 段级 PATCH（细粒度端点，touch=false）。 */
async function editFirstSegmentText(page: Page, text: string): Promise<string> {
  await goStudioSection(page);
  const row = page.locator('[class*="compactCard"]').first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const segId = await row.getAttribute('data-segment-id');
  expect(segId, 'compact 段落行应带 data-segment-id').toBeTruthy();

  // onSelect 是 toggle 语义：已展开时再点会关掉，故先探一下
  const panel = page.locator('[class*="accordionWrapper"]');
  if (!(await panel.isVisible())) {
    await row.locator('[class*="compactText"]').click();
  }
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const patchDone = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes(`/segments/${segId}`),
    { timeout: 15_000 },
  );
  await panel.locator('textarea').fill(text);
  expect((await patchDone).status()).toBe(200);
  return segId!;
}

/** 绕开前端直连后端改章节名（模拟 agent 写入 / 另一个标签页）。 */
async function externalRenameChapter(page: Page, name: string): Promise<void> {
  const r = await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
  const project = await r.json();
  const chapter = project.chapters.find((c: { id: string }) => c.id === CHAPTER1_ID);
  chapter.name = name;
  // 不带 base_updated_at → 后端放行（老客户端/agent 语义），服务端版本前移
  const put = await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: project });
  expect(put.status(), '外部整包 PUT 应被放行').toBe(200);
}

/** 把 409 冲突响应本身从 console 错误里滤掉（它是被测行为，不是缺陷）。 */
function nonConflictErrors(errors: string[]): string[] {
  return errors.filter((e) => !e.includes('favicon') && !/409 \(Conflict\)|stale_payload/i.test(e));
}

test.describe('分段保存冲突：自愈与裁决', () => {
  test.beforeEach(async ({ page }) => {
    await seedTestProject(page);
    await setLocaleToZhCN(page);
  });

  test('假冲突自愈：整包 PUT 在途时本端细粒度写推进版本，409 静默重试（无弹窗、编辑零丢失）', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);

    await goToStudio(page);
    await waitForStableProject(page);
    const initialVersion = (await readProject(page)).updated_at;

    const putStatuses: number[] = [];
    page.on('response', (r) => {
      if (r.request().method() === 'PUT' && PROJECT_PUT_RE.test(new URL(r.url()).pathname)) {
        putStatuses.push(r.status());
      }
    });

    const gate = await gateProjectPuts(page);

    // 1) 文本库改章节名 → 脏草稿 → 1s 后整包 PUT 发出，被闸门扣住（此时还没到服务端）
    await renameChapterInLibrary(page, LOCAL_CHAPTER_NAME);
    await gate.waitForFirstPut();

    // 2) PUT 在途期间做一次细粒度写：段文本 PATCH 推进服务端版本，
    //    且该版本经 noteServerVersion 登记进"本端已知集合"
    const segId = await editFirstSegmentText(page, LOCAL_SEGMENT_TEXT);
    const advancedAfterPatch = (await readProject(page)).updated_at;

    // 3) 放行：扣住的 PUT 携带旧 base 落地 → 409（S=advancedAfterPatch ∈ 已知集）→
    //    第一层换 base + 换最新草稿内容重试 → 200。全程不外泄到 UI
    gate.release();

    await expect.poll(() => putStatuses.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => putStatuses[putStatuses.length - 1], { timeout: 30_000 }).toBe(200);

    // 核心断言 1：确实撞过锁（否则本用例没验到东西）
    expect(putStatuses, `PUT 状态序列应含一次 409（实际 ${JSON.stringify(putStatuses)}）`).toContain(409);
    // 核心断言 2：段级 PATCH 确实推进了服务端版本（并发写真实发生过）
    expect(advancedAfterPatch).not.toBe(initialVersion);
    // 核心断言 3：零 UI 打扰 —— 无裁决弹窗、无"已在别处更新"提示
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText(/检测到项目已在别处更新|检测到版本冲突/)).toHaveCount(0);

    // 双读：两处编辑都落库，一段不丢（重试若复用旧快照，段文本会被覆盖回旧值）
    await expect.poll(() => readApiChapterName(page), { timeout: 20_000 }).toBe(LOCAL_CHAPTER_NAME);
    const api = await readProject(page);
    expect(api.chapters.find((c) => c.id === CHAPTER1_ID)?.segments.find((s) => s.id === segId)?.text)
      .toBe(LOCAL_SEGMENT_TEXT);

    await verifyDbWithScreenshot(page, PROJECT_ID, '假冲突自愈-双读');
    expect(await readDbChapterName()).toBe(LOCAL_CHAPTER_NAME);

    expect(nonConflictErrors(errors)).toEqual([]);
  });

  test('真冲突裁决「用草稿」：外部写入触发 409 → 草稿归档 + 模态弹窗 → force save 落库', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);

    await goToStudio(page);
    await waitForStableProject(page);

    const gate = await gateProjectPuts(page);

    // 1) 本地脏草稿（改章节名），整包 PUT 被扣住
    await renameChapterInLibrary(page, LOCAL_CHAPTER_NAME);
    await gate.waitForFirstPut();

    // 2) 外部写入推进服务端版本（该版本不属于本端任何写）
    await externalRenameChapter(page, EXTERNAL_CHAPTER_NAME);

    // 3) 放行 → 409 且 S 未知 → 真冲突 → 归档 + 拉权威态 + 模态裁决
    gate.release();
    const dialog = page.getByRole('alertdialog', { name: '检测到版本冲突' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText('本地草稿已自动归档');
    // 弹窗同时给出两侧版本，用户能看到自己会丢什么
    await expect(dialog).toContainText('本地草稿');

    // 4) 裁决：用草稿 → force save（base_updated_at=null），用户的选择真正落库
    const forceSaveReq = page.waitForRequest(
      (r) => r.method() === 'PUT' && PROJECT_PUT_RE.test(new URL(r.url()).pathname),
      { timeout: 20_000 },
    );
    await dialog.getByRole('button', { name: '恢复本地草稿' }).click();
    const req = await forceSaveReq;
    expect(req.postDataJSON().base_updated_at, 'force save 不得携带 base（否则又被锁拦下）').toBeUndefined();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    // 5) 双读：服务端 = 本地草稿内容（不是外部写入的内容）
    await expect.poll(() => readApiChapterName(page), { timeout: 20_000 }).toBe(LOCAL_CHAPTER_NAME);
    await verifyDbWithScreenshot(page, PROJECT_ID, '真冲突-用草稿-双读');
    expect(await readDbChapterName()).toBe(LOCAL_CHAPTER_NAME);

    // 6) 被放弃的一侧已归档，工具栏入口可见（归档 +1）
    await goStudioSection(page);
    await expect(page.getByRole('button', { name: '冲突草稿 (1)' })).toBeVisible({ timeout: 20_000 });

    // 7) 裁决后 autosave 已恢复：再编辑一次能正常落库（回归：裁决后永久暂停）
    await renameChapterInLibrary(page, `${LOCAL_CHAPTER_NAME}·二次`);
    await expect.poll(() => readApiChapterName(page), { timeout: 20_000 }).toBe(`${LOCAL_CHAPTER_NAME}·二次`);

    expect(nonConflictErrors(errors)).toEqual([]);
  });

  test('真冲突裁决「用后端」+ 归档找回：采纳权威态后仍可找回被放弃的草稿并落库', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);

    await goToStudio(page);
    await waitForStableProject(page);

    const gate = await gateProjectPuts(page);

    await renameChapterInLibrary(page, LOCAL_CHAPTER_NAME);
    await gate.waitForFirstPut();
    await externalRenameChapter(page, EXTERNAL_CHAPTER_NAME);
    gate.release();

    const dialog = page.getByRole('alertdialog', { name: '检测到版本冲突' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    // 1) 裁决：用后端 → 采纳权威态
    await dialog.getByRole('button', { name: '使用后端版本' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect.poll(() => readApiChapterName(page), { timeout: 20_000 }).toBe(EXTERNAL_CHAPTER_NAME);
    await verifyDbWithScreenshot(page, PROJECT_ID, '真冲突-用后端-双读');
    expect(await readDbChapterName()).toBe(EXTERNAL_CHAPTER_NAME);

    // UI 回显权威态：文本库章节标题 = 外部改名（裁决后就停在编辑器里，直接断言）
    await expectChapterTitleInLibrary(page, EXTERNAL_CHAPTER_NAME);

    // 2) 被放弃的本地草稿仍在归档里可找回
    await goStudioSection(page);
    const entry = page.getByRole('button', { name: '冲突草稿 (1)' });
    await expect(entry).toBeVisible({ timeout: 20_000 });
    await entry.click();

    const archiveDialog = page.getByRole('alertdialog', { name: '冲突草稿归档' });
    await expect(archiveDialog).toBeVisible({ timeout: 15_000 });
    // 归档项按 spec §6.5 展示归档时间 / 草稿更新时间 / 章段计数（不展示章节名）
    await expect(archiveDialog).toContainText('归档于');
    // 归档的是整份项目草稿：种子项目共 2 章 5 段
    await expect(archiveDialog).toContainText('2 章 · 5 段');

    // 3) 恢复该归档 → 拉当前后端态 → 再次进入同一个裁决弹窗（不做静默覆盖服务器的捷径）
    await archiveDialog.getByRole('button', { name: '恢复此草稿' }).click();
    const again = page.getByRole('alertdialog', { name: '检测到版本冲突' });
    await expect(again).toBeVisible({ timeout: 30_000 });

    // 4) 用草稿 → 归档内容落库
    const forceSaveReq = page.waitForRequest(
      (r) => r.method() === 'PUT' && PROJECT_PUT_RE.test(new URL(r.url()).pathname),
      { timeout: 20_000 },
    );
    await again.getByRole('button', { name: '恢复本地草稿' }).click();
    expect((await forceSaveReq).postDataJSON().base_updated_at).toBeUndefined();
    await expect(again).toBeHidden({ timeout: 20_000 });

    await expect.poll(() => readApiChapterName(page), { timeout: 20_000 }).toBe(LOCAL_CHAPTER_NAME);
    await verifyDbWithScreenshot(page, PROJECT_ID, '归档找回后-双读');
    expect(await readDbChapterName()).toBe(LOCAL_CHAPTER_NAME);

    expect(nonConflictErrors(errors)).toEqual([]);
  });
});
