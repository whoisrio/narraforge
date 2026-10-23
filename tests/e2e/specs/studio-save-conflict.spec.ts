/**
 * 分段项目细粒度保存 + 冲突恢复 E2E.
 *
 * 背景：整包 PUT 已退出自动保存热路径。项目/章节/段/文档分别走 PATCH/PUT
 * 专用端点，因此"保存期间的假冲突"不再存在；只有加载期检测到的陈旧本地草稿
 * 会进入第二层裁决（force save 仍走整包 PUT，且不带 base）。
 *
 * 覆盖：
 *   1. 章节改名只发 PATCH /chapters/{id}，零整包 PUT、零冲突弹窗，API + DB 双读一致。
 *   2. 加载期真冲突「用草稿」：陈旧 IndexedDB 草稿 + 外部写入 → 裁决弹窗 →
 *      force save（无 base）落库；被放弃的后端版本不是草稿，不进入归档。
 *   3. 加载期真冲突「用后端」：采纳权威态，仍可从冲突草稿归档找回并再次裁决落库。
 *
 * @feature docs/plans/2026-09-23-segmented-save-conflict-recovery-design.md
 * @feature docs/plans/2026-08-27-segmented-api-granularity-design.md
 */
import { expect, test, type Page } from '@playwright/test';
import { E2E_BACKEND_URL } from '../helpers/ports';
import {
  collectErrors,
  enterWorkspace,
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

/**
 * 后端 updated_at 是**不带时区**的 UTC ISO（如 2026-10-21T09:28:32.743179）。
 * 加载期冲突比较用 `new Date()` 解析两端，必须保持同一种格式；混入 `Z`
 * 会让浏览器把服务端值当本地时间，在 UTC+8 下差出 8 小时，冲突永远判不出来。
 */
function naiveIsoMinus(iso: string, secondsAgo: number): string {
  return new Date(Date.parse(iso) - secondsAgo * 1000).toISOString().replace(/Z$/, '');
}

/** 整包 PUT 的 URL（正则锚定结尾，不吃 PATCH/POST 的段级端点）。 */
const PROJECT_PUT_RE = new RegExp(`/api/segmented-projects/${PROJECT_ID}$`);
/** 章节 PATCH 的 URL。 */
const CHAPTER_PATCH_RE = new RegExp(
  `/api/segmented-projects/${PROJECT_ID}/chapters/${CHAPTER1_ID}$`,
);

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

// ── 操作 ─────────────────────────────────────────────────────────────────────

/** 确保文本库的章节编辑器打开（幂等）。 */
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

/** 在文本库改第一章标题 → RENAME_CHAPTER → 章节 PATCH（细粒度）。 */
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

interface DraftRecordShape {
  project_id: string;
  draft: Record<string, unknown>;
  base_updated_at: string;
  updated_at: string;
  dirty: boolean;
}

async function readDraftRecord(page: Page, projectId: string): Promise<DraftRecordShape | null> {
  return page.evaluate(async (pid) => {
    return await new Promise<DraftRecordShape | null>((resolve, reject) => {
      const open = indexedDB.open('voice_clone_studio');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('project_drafts', 'readonly');
        const req = tx.objectStore('project_drafts').get(pid);
        req.onsuccess = () => { db.close(); resolve((req.result as DraftRecordShape) ?? null); };
        req.onerror = () => reject(req.error);
      };
    });
  }, projectId);
}

/** 直接写 IndexedDB 草稿，模拟"上次会话留下的、基于旧服务端版本的本地草稿"。 */
async function writeStaleDraft(page: Page, record: DraftRecordShape): Promise<void> {
  await page.evaluate(async (rec) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('voice_clone_studio');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('project_drafts', 'readwrite');
        tx.objectStore('project_drafts').put(rec);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, record);
}

/**
 * 先等页面自己 adopt 完（IndexedDB 出现 clean 记录），再写陈旧草稿，
 * 避免与 StrictMode/加载期 adopt 的 putDraft 竞争。写完再读回确认未被覆盖。
 */
async function seedStaleDraft(page: Page, record: DraftRecordShape): Promise<void> {
  await expect.poll(async () => {
    const rec = await readDraftRecord(page, record.project_id);
    return rec ? rec.dirty : null;
  }, { timeout: 10_000 }).toBe(false);

  for (let attempt = 0; attempt < 3; attempt++) {
    await writeStaleDraft(page, record);
    await page.waitForTimeout(400);
    const rec = await readDraftRecord(page, record.project_id);
    if (rec?.dirty && rec.base_updated_at === record.base_updated_at) return;
  }
  throw new Error('陈旧草稿写入后仍被加载期 adopt 覆盖');
}

/** 打开项目并进入工作室，预期加载期冲突弹窗出现。 */
async function openProjectExpectingConflict(page: Page): Promise<void> {
  await page.goto('/');
  await enterWorkspace(page);
  await page.getByRole('button', { name: /打开 test/ }).first().click();
  const dialog = page.getByRole('alertdialog', { name: '检测到版本冲突' });
  // 冲突检测在 TTSSynthesis 挂载时执行。工作区可能恢复到上次所在的「工作室」
  // （弹窗会立刻出现并挡住导航），也可能先落在「总览」（需要点一下工作室）。
  // 两种情况都用短超时探测，未出现弹窗才点导航，避免点击被 overlay 拦截。
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await dialog.isVisible().catch(() => false)) break;
    const studioNav = page.getByRole('button', { name: /◉ 工作室/ }).first();
    if (await studioNav.isVisible().catch(() => false)) {
      try {
        await studioNav.click({ timeout: 1_000 });
      } catch {
        // 点击瞬间弹窗出现并拦截：下一轮由 isVisible 分支结束循环
      }
    }
    await page.waitForTimeout(200);
  }
  await expect(dialog).toBeVisible({ timeout: 30_000 });
}

function nonConflictErrors(errors: string[]): string[] {
  return errors.filter((e) => !e.includes('favicon') && !/409 \(Conflict\)|stale_payload/i.test(e));
}

test.describe('分段保存：细粒度端点与冲突恢复', () => {
  test.beforeEach(async ({ page }) => {
    await seedTestProject(page);
    await setLocaleToZhCN(page);
  });

  test('章节改名只发 PATCH /chapters/{id}：零整包 PUT、零冲突弹窗、双读一致', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = collectErrors(page);

    await goToStudio(page);
    await waitForStableProject(page);

    const fullPuts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && PROJECT_PUT_RE.test(new URL(r.url()).pathname)) {
        fullPuts.push(r.url());
      }
    });

    const patchDone = page.waitForResponse(
      (r) => r.request().method() === 'PATCH'
        && CHAPTER_PATCH_RE.test(new URL(r.url()).pathname)
        && r.status() === 200,
      { timeout: 20_000 },
    );
    await renameChapterInLibrary(page, LOCAL_CHAPTER_NAME);
    const patch = await patchDone;
    expect(patch.request().postDataJSON()).toEqual({ name: LOCAL_CHAPTER_NAME });

    // 跨过旧实现的 1s 防抖窗口：确认没有任何整包 PUT 被触发
    await page.waitForTimeout(1_500);
    expect(fullPuts, `章节改名不得触发整包 PUT（实际 ${JSON.stringify(fullPuts)}）`).toEqual([]);

    // 零 UI 打扰
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText(/检测到项目已在别处更新|检测到版本冲突/)).toHaveCount(0);

    // 双读：API + DB 都是新章节名
    await expect.poll(() => readApiChapterName(page), { timeout: 20_000 }).toBe(LOCAL_CHAPTER_NAME);
    await verifyDbWithScreenshot(page, PROJECT_ID, '章节改名-细粒度PATCH-双读');
    expect(await readDbChapterName()).toBe(LOCAL_CHAPTER_NAME);

    expect(nonConflictErrors(errors)).toEqual([]);
  });

  test('加载期真冲突「用草稿」：裁决后 force save（无 base）落库，不产生草稿归档', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);

    await goToStudio(page);
    await waitForStableProject(page);

    const serverProject = await readProject(page);
    const staleDraft: DraftRecordShape = {
      project_id: PROJECT_ID,
      draft: {
        ...serverProject,
        chapters: serverProject.chapters.map((c) =>
          c.id === CHAPTER1_ID ? { ...c, name: LOCAL_CHAPTER_NAME } : c),
      },
      // 远旧于服务端版本（>2s 容差），确保加载期判为真冲突；格式与服务端一致
      base_updated_at: naiveIsoMinus(serverProject.updated_at, 60),
      updated_at: new Date().toISOString(),
      dirty: true,
    };
    await seedStaleDraft(page, staleDraft);
    await externalRenameChapter(page, EXTERNAL_CHAPTER_NAME);

    await openProjectExpectingConflict(page);
    const dialog = page.getByRole('alertdialog', { name: '检测到版本冲突' });
    await expect(dialog).toContainText('本地草稿');
    await expect(dialog).toContainText('恢复本地修改或使用后端版本');

    const forceSaveReq = page.waitForRequest(
      (r) => r.method() === 'PUT' && PROJECT_PUT_RE.test(new URL(r.url()).pathname),
      { timeout: 20_000 },
    );
    await dialog.getByRole('button', { name: '恢复本地草稿' }).click();
    const req = await forceSaveReq;
    expect(req.postDataJSON().base_updated_at, 'force save 不得携带 base').toBeUndefined();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect.poll(() => readApiChapterName(page), { timeout: 20_000 }).toBe(LOCAL_CHAPTER_NAME);
    await verifyDbWithScreenshot(page, PROJECT_ID, '加载期冲突-用草稿-双读');
    expect(await readDbChapterName()).toBe(LOCAL_CHAPTER_NAME);

    // "用草稿"放弃的是后端版本，它不是本地草稿，不应出现在冲突草稿归档里
    // （只有裁决为"用后端"时才会归档被放弃的本地草稿）。
    await page.waitForTimeout(1_000);
    await expect(page.getByRole('button', { name: /^冲突草稿/ })).toHaveCount(0);

    expect(nonConflictErrors(errors)).toEqual([]);
  });

  test('加载期真冲突「用后端」：采纳权威态后仍可从归档找回并再次裁决落库', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);

    await goToStudio(page);
    await waitForStableProject(page);

    const serverProject = await readProject(page);
    const staleDraft: DraftRecordShape = {
      project_id: PROJECT_ID,
      draft: {
        ...serverProject,
        chapters: serverProject.chapters.map((c) =>
          c.id === CHAPTER1_ID ? { ...c, name: LOCAL_CHAPTER_NAME } : c),
      },
      base_updated_at: naiveIsoMinus(serverProject.updated_at, 60),
      updated_at: new Date().toISOString(),
      dirty: true,
    };
    await seedStaleDraft(page, staleDraft);
    await externalRenameChapter(page, EXTERNAL_CHAPTER_NAME);

    await openProjectExpectingConflict(page);
    const dialog = page.getByRole('alertdialog', { name: '检测到版本冲突' });
    await dialog.getByRole('button', { name: '使用后端版本' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect.poll(() => readApiChapterName(page), { timeout: 20_000 }).toBe(EXTERNAL_CHAPTER_NAME);
    await verifyDbWithScreenshot(page, PROJECT_ID, '加载期冲突-用后端-双读');
    expect(await readDbChapterName()).toBe(EXTERNAL_CHAPTER_NAME);

    // UI 回显权威态
    await expectChapterTitleInLibrary(page, EXTERNAL_CHAPTER_NAME);

    // 归档找回 → 再次进入裁决 → 用草稿落库（仍在工作室，直接点侧栏）
    await page.getByRole('button', { name: /◉ 工作室/ }).first().click();
    const entry = page.getByRole('button', { name: '冲突草稿 (1)' });
    await expect(entry).toBeVisible({ timeout: 20_000 });
    await entry.click();

    const archiveDialog = page.getByRole('alertdialog', { name: '冲突草稿归档' });
    await expect(archiveDialog).toBeVisible({ timeout: 15_000 });
    await expect(archiveDialog).toContainText('归档于');
    await expect(archiveDialog).toContainText('2 章 · 5 段');

    await archiveDialog.getByRole('button', { name: '恢复此草稿' }).click();
    const again = page.getByRole('alertdialog', { name: '检测到版本冲突' });
    await expect(again).toBeVisible({ timeout: 30_000 });

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
