/**
 * 重拆保留已合成音频 + 同时拆分 segment E2E.
 *
 * 完整旁白文档 -> 文本库「按标题拆分章节」勾选「同时拆分 segment」-> 首轮拆分；
 * 给部分 segment 挂载假音频（写盘 + DB 直写落库）模拟已合成状态；
 * 小改文档后重拆 -> 文本未变的 segment 保留音频（文件 move 到新路径），
 * 变化的 segment 为未合成态，旧文件被 GC。
 * 验证 UI（toast 报告）+ API + DB（双读）+ 文件系统。
 * 使用独立项目，不污染共享种子数据；测试结束删除。
 *
 * @feature backend/app/services/segmented_project_service.py (batch_create_structure preserve_audio/split_segments)
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { E2E_BACKEND_URL } from '../helpers/ports';
import { collectErrors, setLocaleToZhCN, enterWorkspace } from '../helpers';
import { readDbProject } from '../helpers/dbReader';
import { attachSegmentAudio } from '../helpers/dbWriter';
import { projectDirNameForId } from '../helpers/fsAssertions';

const BACKEND = E2E_BACKEND_URL;
const PROJECT_ID = 'e2e-split-preserve-audio';
const PROJECT_NAME = '重拆保留音频测试';
const SEGMENTED_DIR = path.resolve(__dirname, '..', '..', '..', 'backend', 'data', 'projects');

// 文案约束：章节正文 ≥80 字（markdown_split 的 min_chars 合并阈值）；
// 句子不含逗号且 ≥5 字（rule_split 默认分隔符含逗号、<5 字会被合并）。
const CH1_TEXTS = [
  '春天的花开满了整片山坡到处五颜六色好看极了。',
  '蝴蝶在盛开的花丛之间来回飞舞忙着采集花蜜。',
  '孩子们在柔软碧绿的草地上尽情奔跑和欢笑。',
  '老人们坐在村口枝繁叶茂的大树下乘凉聊天。',
];
const CH2_T1 = '夜晚的天空中挂满了密密麻麻的繁星看起来格外明亮。';
const CH2_T2 = '微风轻拂着山坡上高大的树梢发出沙沙的声响。';
const CH2_T2_NEW = '月光洒在平静宽阔的湖面上泛起粼粼的波光。';
const CH2_T3 = '远处村庄里的灯火稀疏暗淡偶尔传来几声狗吠。';
const CH2_T4 = '田野里的虫鸣此起彼伏让夜晚显得更加宁静。';

const NARRATION_V1 = [
  '# 保留测试',
  '',
  '## 第一章',
  CH1_TEXTS.join(''),
  '',
  '## 第二章',
  CH2_T1 + CH2_T2 + CH2_T3 + CH2_T4,
].join('\n');

// 第二章第二句改掉：T1 保留（应复用音频），T2 消失（旧文件应被 GC），新增一句
const NARRATION_V2 = NARRATION_V1.replace(CH2_T2, CH2_T2_NEW);

interface Seg { id: string; text: string; audio?: { current?: { path?: string } } | null }
interface Ch { id: string; name: string; segments: Seg[] }

function projectPayload(narration: string) {
  return {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    schema_version: 2,
    layout: 'vertical',
    narration_script: narration,
    // 空章节：前端会注入内存态默认章节，其 sync-status 轮询不应再 404
    // （console errors 断言在用例末尾覆盖这一点）。
    chapters: [],
  };
}

/** 写假音频文件并返回 DB 存储的相对路径 */
function writeFakeAudio(dirName: string, chapterId: string, segmentId: string): string {
  const rel = `${dirName}/chapters/${chapterId}/segments/${segmentId}.mp3`;
  const abs = path.join(SEGMENTED_DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from('fake-mp3-audio'));
  return rel;
}

test.describe('重拆保留已合成音频', () => {
  test.setTimeout(120_000);
  test('首轮拆章节+segment -> 挂假音频 -> 小改重拆 -> 未变段保留音频（UI + API + DB + FS）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    const createResp = await page.request.post(`${BACKEND}/api/segmented-projects`, { data: projectPayload(NARRATION_V1) });
    expect(createResp.status()).toBe(201);

    // 记录旧音频相对路径，供后面断言 GC / move
    const oldAudioPaths: string[] = [];

    try {
      // ── 1. 首轮拆分（勾选框仅首拆可见且默认勾选；注入默认章时为重拆路径、
      //       勾选框隐藏但恒拆分 segment）──
      await page.goto('/');
      await enterWorkspace(page);
      await page.getByRole('button', { name: new RegExp(`打开 ${PROJECT_NAME}`) }).first().click();
      await page.getByRole('button', { name: /文本库/ }).click();
      await page.getByRole('button', { name: '按标题拆分章节' }).click();
      let modal = page.getByRole('dialog', { name: '按标题拆分章节' });
      await expect(modal.getByText('H2 (2)')).toBeVisible({ timeout: 10_000 });
      const firstCheckbox = modal.getByRole('checkbox', { name: '同时拆分 segment' });
      if (await firstCheckbox.isVisible()) await firstCheckbox.check();
      await modal.getByRole('button', { name: '预览拆分' }).click();
      await expect(modal.locator('ol li strong')).toHaveCount(2, { timeout: 10_000 });
      await modal.getByRole('button', { name: '应用到项目' }).click();
      // 新项目可能自带一个默认章节 -> 会弹替换确认
      const confirm1 = page.getByRole('alertdialog', { name: '确认替换章节' });
      if (await confirm1.isVisible()) {
        await confirm1.getByRole('button', { name: '确认替换' }).click();
      }
      await expect(modal).toBeHidden({ timeout: 15_000 });

      // ── 2. 首轮拆分结果：章节 + 规则拆分出的 segment ──
      const detail1 = await (await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`)).json();
      expect(detail1.chapters).toHaveLength(2);
      const [ch1, ch2] = detail1.chapters as Ch[];
      expect(ch1.segments.map((s) => s.text)).toEqual(CH1_TEXTS);
      expect(ch2.segments.map((s) => s.text)).toEqual([CH2_T1, CH2_T2, CH2_T3, CH2_T4]);

      // ── 3. 挂载假音频：第一章全部 4 段 + 第二章第 1/2 段（模拟已合成）──
      const withAudio = new Set([...ch1.segments.map((s) => s.id), ch2.segments[0].id, ch2.segments[1].id]);
      // save_project 会写 manifest，先 PUT 一次再解析 slug。
      // 注意：payload 不带 audio/generated_params —— PUT 契约变化后已存在段的
      // 这些字段为服务端自产字段，PUT 会被忽略，只能直写 DB（attachSegmentAudio）。
      const buildPut = (narration: string, chapters: Ch[]) => ({
        id: PROJECT_ID,
        name: PROJECT_NAME,
        schema_version: 2,
        layout: 'vertical',
        narration_script: narration,
        chapters: chapters.map((c, ci) => ({
          id: c.id,
          position: ci,
          name: c.name,
          voice: (c as unknown as { voice: unknown }).voice,
          split_config: (c as unknown as { split_config: unknown }).split_config,
          original_text: (c as unknown as { original_text: unknown }).original_text,
          narration_script: (c as unknown as { narration_script: unknown }).narration_script,
          segments: c.segments.map((s, si) => ({
            id: s.id,
            position: si,
            text: s.text,
            emotion: (s as unknown as { emotion: unknown }).emotion ?? 'neutral',
            role_id: null,
            segment_kind: 'narration',
            voice: { source: 'chapter' },
          })),
        })),
      });

      let putResp = await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: buildPut(NARRATION_V1, detail1.chapters) });
      expect(putResp.status()).toBe(200);
      const dirName = projectDirNameForId(PROJECT_ID);
      expect(dirName, 'project asset dir (manifest) should exist after save').toBeTruthy();

      // 写假音频文件 + DB 直写挂上 audio/generated_params
      for (const c of detail1.chapters as Ch[]) {
        for (const s of c.segments) {
          if (!withAudio.has(s.id)) continue;
          const rel = writeFakeAudio(dirName!, c.id, s.id);
          attachSegmentAudio(s.id, rel);
          oldAudioPaths.push(rel);
        }
      }
      // 这个 PUT 只承担把 narration_script 改成 V2 的正当用途（不再带 audio 字段）
      putResp = await page.request.put(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`, { data: buildPut(NARRATION_V2, detail1.chapters) });
      expect(putResp.status()).toBe(200, await putResp.text());

      // 确认假音频已落库
      const detail2 = await (await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`)).json();
      const withAudioCount = (detail2.chapters as Ch[]).flatMap((c) => c.segments).filter((s) => s.audio?.current?.path).length;
      expect(withAudioCount).toBe(6);

      // ── 4. 小改后重拆（A3：重拆路径隐藏勾选框，恒拆分 segment）──
      await page.reload();
      await enterWorkspace(page);
      await page.getByRole('button', { name: new RegExp(`打开 ${PROJECT_NAME}`) }).first().click();
      await page.getByRole('button', { name: /文本库/ }).click();
      await page.getByRole('button', { name: '按标题拆分章节' }).click();
      modal = page.getByRole('dialog', { name: '按标题拆分章节' });
      await expect(modal.getByText('H2 (2)')).toBeVisible({ timeout: 10_000 });
      await expect(modal.getByRole('checkbox', { name: '同时拆分 segment' })).toBeHidden();
      await modal.getByRole('button', { name: '预览拆分' }).click();
      await expect(modal.locator('ol li strong')).toHaveCount(2, { timeout: 10_000 });
      await modal.getByRole('button', { name: '应用到项目' }).click();
      const confirm = page.getByRole('alertdialog', { name: '确认替换章节' });
      await confirm.getByRole('button', { name: '确认替换' }).click();

      // toast 报告：5 段保留（第一章 4 + 第二章 T1），3 段新增（T2' + 无音频的 T3/T4）
      await expect(page.getByText('拆分完成：保留 5 段已合成音频，新增 3 段')).toBeVisible({ timeout: 15_000 });
      await expect(modal).toBeHidden({ timeout: 15_000 });

      // ── 5. API：未变段保留音频（path 指向新 id），变化段未合成 ──
      const detail3 = await (await page.request.get(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`)).json();
      const [nch1, nch2] = detail3.chapters as Ch[];
      expect(nch1.segments.map((s) => s.text)).toEqual(CH1_TEXTS);
      expect(nch2.segments.map((s) => s.text)).toEqual([CH2_T1, CH2_T2_NEW, CH2_T3, CH2_T4]);

      for (const s of nch1.segments) {
        const rel = s.audio?.current?.path;
        expect(rel, `reused segment should keep audio: ${s.text}`).toBeTruthy();
        expect(rel).toContain(nch1.id); // 已 move 到新章节目录
        expect(rel).toContain(s.id); // 已 move 到新 segment 规范路径
        expect(fs.existsSync(path.join(SEGMENTED_DIR, rel!)), `file should exist: ${rel}`).toBe(true);
        expect((s as unknown as { generated_params: { engine: string } }).generated_params.engine).toBe('edge_tts');
      }
      const reusedCh2 = nch2.segments[0];
      expect(reusedCh2.audio?.current?.path).toBeTruthy();
      expect(reusedCh2.audio?.current?.path).toContain(nch2.id);
      // 变化段与原本无音频段：未合成态
      expect(nch2.segments[1].audio ?? null).toBeNull();
      expect(nch2.segments[2].audio ?? null).toBeNull();
      expect(nch2.segments[3].audio ?? null).toBeNull();

      // 旧路径全部失效（复用的被 move，T2 未复用被 GC）
      for (const rel of oldAudioPaths) {
        expect(fs.existsSync(path.join(SEGMENTED_DIR, rel)), `old path should be gone: ${rel}`).toBe(false);
      }

      // ── 6. DB 双读：audio JSON 落库且 origin 保留 ──
      const db = await readDbProject(PROJECT_ID);
      expect(db).toBeTruthy();
      const dbSegs = db!.segments;
      expect(dbSegs).toHaveLength(8);
      const audioByText = new Map(
        dbSegs.map((s) => [s.text, s.audio ? (JSON.parse(s.audio) as { current: { origin: string } }) : null]),
      );
      for (const text of [...CH1_TEXTS, CH2_T1]) {
        expect(audioByText.get(text)?.current.origin, `db audio for: ${text}`).toBe('tts');
      }
      for (const text of [CH2_T2_NEW, CH2_T3, CH2_T4]) {
        expect(audioByText.get(text), `db audio should be null for: ${text}`).toBeNull();
      }
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${PROJECT_ID}`);
    }

    expect(errors).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 共用：给项目全部 segment 挂载假音频（写盘 + DB 直写落库），返回旧相对路径
// PUT 契约变化后，已存在段的 audio/generated_params 为服务端自产字段，
// PUT 会被忽略 —— 挂音频只能直写 DB；PUT 仅保留 narration_script 更新等正当用途。
// ────────────────────────────────────────────────────────────────────────────

interface FullSeg extends Seg { emotion?: string | null }
interface FullCh extends Ch {
  voice?: unknown;
  split_config?: unknown;
  original_text?: unknown;
  narration_script?: unknown;
  segments: FullSeg[];
}

async function attachFakeAudioToAll(
  page: import('@playwright/test').Page,
  projectId: string,
  projectName: string,
  narration: string,
): Promise<{ chapters: FullCh[]; oldPaths: string[] }> {
  const detail = await (await page.request.get(`${BACKEND}/api/segmented-projects/${projectId}`)).json();
  const chapters = detail.chapters as FullCh[];
  const buildPut = () => ({
    id: projectId,
    name: projectName,
    schema_version: 2,
    layout: 'vertical',
    narration_script: narration,
    chapters: chapters.map((c, ci) => ({
      id: c.id,
      position: ci,
      name: c.name,
      voice: c.voice,
      split_config: c.split_config,
      original_text: c.original_text,
      narration_script: c.narration_script,
      segments: c.segments.map((s, si) => ({
        id: s.id,
        position: si,
        text: s.text,
        emotion: s.emotion ?? 'neutral',
        role_id: null,
        segment_kind: 'narration',
        voice: { source: 'chapter' },
      })),
    })),
  });
  // save_project 会写 manifest，先 PUT 一次再解析 slug
  let resp = await page.request.put(`${BACKEND}/api/segmented-projects/${projectId}`, { data: buildPut() });
  expect(resp.status()).toBe(200, await resp.text());
  const dirName = projectDirNameForId(projectId);
  expect(dirName, 'project asset dir (manifest) should exist after save').toBeTruthy();
  // 写假音频文件 + DB 直写挂上 audio/generated_params（PUT 已无法挂已存在段的 audio）
  const oldPaths: string[] = [];
  for (const c of chapters) {
    for (const s of c.segments) {
      const rel = writeFakeAudio(dirName!, c.id, s.id);
      attachSegmentAudio(s.id, rel);
      oldPaths.push(rel);
    }
  }
  // 第二个 PUT 只承担 narration_script 更新（如 V1→V2），payload 不带 audio 字段
  resp = await page.request.put(`${BACKEND}/api/segmented-projects/${projectId}`, { data: buildPut() });
  expect(resp.status()).toBe(200, await resp.text());
  return { chapters, oldPaths };
}

/** 打开拆分弹窗（返回 modal locator；预览点击留给调用方，便于先注册 dry_run 等待） */
async function openSplitModal(page: import('@playwright/test').Page, projectName: string, h2Text: string) {
  await page.getByRole('button', { name: new RegExp(`打开 ${projectName}`) }).first().click();
  await page.getByRole('button', { name: /文本库/ }).click();
  await page.getByRole('button', { name: '按标题拆分章节' }).click();
  const modal = page.getByRole('dialog', { name: '按标题拆分章节' });
  await expect(modal.getByText(h2Text)).toBeVisible({ timeout: 10_000 });
  return modal;
}

/** 等重拆预览后的 dry_run 请求完成（A4 诚实确认的数据来源） */
function waitForDryRun(page: import('@playwright/test').Page) {
  return page.waitForResponse(
    (resp) => resp.url().includes('chapters:batch') && resp.request().postDataJSON()?.dry_run === true,
    { timeout: 15_000 },
  );
}

// ────────────────────────────────────────────────────────────────────────────
// S1 修复：真实 UI 默认路径（不碰任何勾选框）重拆同一文档 -> 音频保留
// ────────────────────────────────────────────────────────────────────────────

test.describe('S1: 默认路径重拆保留音频', () => {
  test.setTimeout(120_000);
  const S1_ID = 'e2e-split-preserve-s1';
  const S1_NAME = '重拆默认路径测试';

  test('首轮拆分 -> 全部挂音频 -> 文档不改默认路径重拆 -> 8 段音频全保留（UI + API + DB + FS）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    await page.request.delete(`${BACKEND}/api/segmented-projects/${S1_ID}`);
    const createResp = await page.request.post(`${BACKEND}/api/segmented-projects`, {
      data: { id: S1_ID, name: S1_NAME, schema_version: 2, layout: 'vertical', narration_script: NARRATION_V1, chapters: [] },
    });
    expect(createResp.status()).toBe(201);

    try {
      // ── 1. 首轮拆分 ──
      await page.goto('/');
      await enterWorkspace(page);
      let modal = await openSplitModal(page, S1_NAME, 'H2 (2)');
      await modal.getByRole('button', { name: '预览拆分' }).click();
      await expect(modal.locator('ol li strong')).toHaveCount(2, { timeout: 10_000 });
      await modal.getByRole('button', { name: '应用到项目' }).click();
      const confirm1 = page.getByRole('alertdialog', { name: '确认替换章节' });
      if (await confirm1.isVisible()) {
        await confirm1.getByRole('button', { name: '确认替换' }).click();
      }
      await expect(modal).toBeHidden({ timeout: 15_000 });

      // ── 2. 全部 8 段挂假音频 ──
      const { oldPaths } = await attachFakeAudioToAll(page, S1_ID, S1_NAME, NARRATION_V1);
      expect(oldPaths).toHaveLength(8);

      // ── 3. 文档一字不改，真实 UI 默认路径重拆（A3：重拆无勾选框可碰）──
      await page.reload();
      await enterWorkspace(page);
      modal = await openSplitModal(page, S1_NAME, 'H2 (2)');
      await expect(modal.getByRole('checkbox', { name: '同时拆分 segment' })).toBeHidden();
      // 先注册 dry_run 等待再点预览（A4：确认框如实展示保留明细的数据来源）
      const dryRunDone = waitForDryRun(page);
      await modal.getByRole('button', { name: '预览拆分' }).click();
      await expect(modal.locator('ol li strong')).toHaveCount(2, { timeout: 10_000 });
      await dryRunDone;
      await modal.getByRole('button', { name: '应用到项目' }).click();
      const confirm = page.getByRole('alertdialog', { name: '确认替换章节' });
      await expect(confirm.getByText('将替换为 2 章。')).toBeVisible();
      await expect(confirm.getByText('预计保留 8 段已合成音频。')).toBeVisible();
      await confirm.getByRole('button', { name: '确认替换' }).click();

      await expect(page.getByText('拆分完成：保留 8 段已合成音频，新增 0 段')).toBeVisible({ timeout: 15_000 });
      await expect(modal).toBeHidden({ timeout: 15_000 });

      // ── 4. API：8 段全部保留音频（路径指向新 id）──
      const detail = await (await page.request.get(`${BACKEND}/api/segmented-projects/${S1_ID}`)).json();
      const newChapters = detail.chapters as Ch[];
      expect(newChapters).toHaveLength(2);
      for (const c of newChapters) {
        for (const s of c.segments) {
          const rel = s.audio?.current?.path;
          expect(rel, `reused segment should keep audio: ${s.text}`).toBeTruthy();
          expect(rel).toContain(c.id);
          expect(rel).toContain(s.id);
          expect(fs.existsSync(path.join(SEGMENTED_DIR, rel!)), `file should exist: ${rel}`).toBe(true);
        }
      }
      // 旧路径全部失效（全部被 move，无 GC 误删）
      for (const rel of oldPaths) {
        expect(fs.existsSync(path.join(SEGMENTED_DIR, rel)), `old path should be gone: ${rel}`).toBe(false);
      }

      // ── 5. DB 双读 ──
      const db = await readDbProject(S1_ID);
      expect(db).toBeTruthy();
      expect(db!.segments).toHaveLength(8);
      for (const s of db!.segments) {
        const audio = s.audio ? (JSON.parse(s.audio) as { current: { origin: string } }) : null;
        expect(audio?.current.origin, `db audio for: ${s.text}`).toBe('tts');
      }
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${S1_ID}`);
    }

    expect(errors).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// S3 修复：章节重组（文档加标题、segment 文本逐字未动）-> 全局兜底保留
// ────────────────────────────────────────────────────────────────────────────

const S3_TEXTS = [
  '山间的清晨总是伴着薄薄的雾气和清脆的鸟叫。',
  '砍柴的老人沿着熟悉的小路一步一步慢慢上山。',
  '溪水缓缓流过布满青苔的石头发出轻轻声响。',
  '阳光穿过茂密枝叶在地上洒下点点金色光斑。',
  '午后的村庄安静得只能听见远处的阵阵蝉鸣。',
  '屋顶的炊烟袅袅升起然后慢慢散开不见了。',
  '放学的孩子背着书包蹦蹦跳跳跑过石板桥。',
  '田野里的稻穗在微风里轻轻摇晃泛起波浪。',
];
const S3_V1 = ['# 重组测试', '', '## 大章', S3_TEXTS.join('')].join('\n');
const S3_V2 = [
  '# 重组测试', '',
  '## 大章(上)', S3_TEXTS.slice(0, 4).join(''), '',
  '## 大章(下)', S3_TEXTS.slice(4).join(''),
].join('\n');

test.describe('S3: 章节重组兜底保留音频', () => {
  test.setTimeout(120_000);
  const S3_ID = 'e2e-split-preserve-s3';
  const S3_NAME = '章节重组保留测试';

  test('一章拆两章（文本未动）-> 8 段音频跨章兜底保留（UI + API + DB + FS）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);
    await page.request.delete(`${BACKEND}/api/segmented-projects/${S3_ID}`);
    const createResp = await page.request.post(`${BACKEND}/api/segmented-projects`, {
      data: { id: S3_ID, name: S3_NAME, schema_version: 2, layout: 'vertical', narration_script: S3_V1, chapters: [] },
    });
    expect(createResp.status()).toBe(201);

    try {
      // ── 1. 首轮拆分：1 章 8 段 ──
      await page.goto('/');
      await enterWorkspace(page);
      let modal = await openSplitModal(page, S3_NAME, 'H2 (1)');
      await modal.getByRole('button', { name: '预览拆分' }).click();
      await expect(modal.locator('ol li strong')).toHaveCount(1, { timeout: 10_000 });
      await modal.getByRole('button', { name: '应用到项目' }).click();
      const confirm1 = page.getByRole('alertdialog', { name: '确认替换章节' });
      if (await confirm1.isVisible()) {
        await confirm1.getByRole('button', { name: '确认替换' }).click();
      }
      await expect(modal).toBeHidden({ timeout: 15_000 });

      const detail1 = await (await page.request.get(`${BACKEND}/api/segmented-projects/${S3_ID}`)).json();
      expect(detail1.chapters).toHaveLength(1);
      expect(detail1.chapters[0].segments.map((s: Seg) => s.text)).toEqual(S3_TEXTS);

      // ── 2. 全部 8 段挂假音频，同时把文档改成 V2（加标题拆两章，文本未动）──
      const { oldPaths } = await attachFakeAudioToAll(page, S3_ID, S3_NAME, S3_V2);
      expect(oldPaths).toHaveLength(8);

      // ── 3. 重拆：新标题对不上旧标题，靠全局兜底保留 ──
      await page.reload();
      await enterWorkspace(page);
      modal = await openSplitModal(page, S3_NAME, 'H2 (2)');
      const dryRunDone = waitForDryRun(page);
      await modal.getByRole('button', { name: '预览拆分' }).click();
      await expect(modal.locator('ol li strong')).toHaveCount(2, { timeout: 10_000 });
      await dryRunDone;
      await modal.getByRole('button', { name: '应用到项目' }).click();
      const confirm = page.getByRole('alertdialog', { name: '确认替换章节' });
      await expect(confirm.getByText('预计保留 8 段已合成音频。')).toBeVisible();
      await confirm.getByRole('button', { name: '确认替换' }).click();

      await expect(page.getByText('拆分完成：保留 8 段已合成音频，新增 0 段')).toBeVisible({ timeout: 15_000 });
      await expect(modal).toBeHidden({ timeout: 15_000 });

      // ── 4. API：两章各 4 段，文本原样，音频全部保留并 move 到对应新章目录 ──
      const detail = await (await page.request.get(`${BACKEND}/api/segmented-projects/${S3_ID}`)).json();
      const newChapters = detail.chapters as Ch[];
      expect(newChapters).toHaveLength(2);
      expect(newChapters[0].segments.map((s) => s.text)).toEqual(S3_TEXTS.slice(0, 4));
      expect(newChapters[1].segments.map((s) => s.text)).toEqual(S3_TEXTS.slice(4));
      for (const c of newChapters) {
        for (const s of c.segments) {
          const rel = s.audio?.current?.path;
          expect(rel, `reused segment should keep audio: ${s.text}`).toBeTruthy();
          expect(rel).toContain(c.id);
          expect(rel).toContain(s.id);
          expect(fs.existsSync(path.join(SEGMENTED_DIR, rel!)), `file should exist: ${rel}`).toBe(true);
        }
      }
      for (const rel of oldPaths) {
        expect(fs.existsSync(path.join(SEGMENTED_DIR, rel)), `old path should be gone: ${rel}`).toBe(false);
      }

      // ── 5. DB 双读 ──
      const db = await readDbProject(S3_ID);
      expect(db).toBeTruthy();
      expect(db!.segments).toHaveLength(8);
      for (const s of db!.segments) {
        const audio = s.audio ? (JSON.parse(s.audio) as { current: { origin: string } }) : null;
        expect(audio?.current.origin, `db audio for: ${s.text}`).toBe('tts');
      }
    } finally {
      await page.request.delete(`${BACKEND}/api/segmented-projects/${S3_ID}`);
    }

    expect(errors).toEqual([]);
  });
});
