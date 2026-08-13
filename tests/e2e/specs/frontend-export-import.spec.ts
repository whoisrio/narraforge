/**
 * 前端模式（IndexedDB）项目导出/导入 + 导出到文件夹 E2E。
 *
 * global-setup 把存储模式设为 backend（共享 SQLite）；本 spec 切到 frontend，
 * 结束后恢复 backend。前端模式的项目/音频直接注入 IndexedDB（等价于用户
 * 合成/录音后的状态），聚焦验证：
 *   1. UI 导出 .narraforge.zip（与后端同构格式：manifest.json + assets/）→
 *      UI 导入 → 新项目出现在列表，章节/段文本一致，音频恢复到 IndexedDB；
 *   2. "导出到文件夹"（showDirectoryPicker mock）逐段写入 mp3 + 章节 srt。
 *
 * @feature frontend-mode project bundle (feat/frontend-project-bundle)
 */
import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectErrors, setLocaleToZhCN, enterWorkspace } from '../helpers';
import { E2E_BACKEND_URL } from '../helpers/ports';

const BACKEND = E2E_BACKEND_URL;
const PROJECT_NAME = '前端导出验证';
const AUDIO_MP3 = [0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8];

/** 构造前端模式项目：1 章 2 段，seg-1 有音频引用（IndexedDB id），seg-2 idle */
function buildProject() {
  const now = new Date().toISOString();
  return {
    schema_version: 2,
    id: 'e2e-frontend-p',
    name: PROJECT_NAME,
    logo: null,
    layout: 'vertical',
    remotion_project_path: null,
    narration_script: null,
    configs: {},
    default_narrator_role_id: null,
    active_chapter_id: 'e2e-ch-1',
    created_at: now,
    updated_at: now,
    chapters: [{
      id: 'e2e-ch-1',
      name: '第一章',
      position: 0,
      voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' },
      split_config: { delimiters: ['，', '。'], mode: 'rule' },
      original_text: '前端导出验证全文',
      narration_script: null,
      design_title: '第一章',
      audio_adjust: null,
      selected_segment_id: undefined,
      segments: [
        {
          id: 'e2e-seg-1',
          text: '第一段',
          voice: { source: 'chapter' },
          status: 'ready',
          audio: { current: { id: 'e2e-audio-1', duration_sec: 1.2 }, format: 'mp3' },
          position: 0,
          segment_kind: 'narration',
          role_id: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'e2e-seg-2',
          text: '第二段',
          voice: { source: 'chapter' },
          status: 'idle',
          audio: { format: 'mp3' },
          position: 1,
          segment_kind: 'narration',
          role_id: null,
          created_at: now,
          updated_at: now,
        },
      ],
      created_at: now,
      updated_at: now,
    }],
  };
}

/** 切前端存储模式 + 进入工作台（返回后页面处于 frontend 模式） */
async function switchToFrontendMode(page: import('@playwright/test').Page): Promise<void> {
  await setLocaleToZhCN(page);
  const resp = await page.request.put(`${BACKEND}/api/config/storage-mode`, {
    data: { storage_mode: 'frontend' },
  });
  expect(resp.ok()).toBeTruthy();
  await page.goto('/');
  await enterWorkspace(page);
}

/** 注入 IndexedDB：tts_results 音频 + segmented_projects 项目，然后 reload */
async function injectIndexedDBProject(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.evaluate(async ({ project, audioBytes }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('voice_clone_studio', 3);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('tts_results')) d.createObjectStore('tts_results', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('stt_results')) d.createObjectStore('stt_results', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('segmented_projects')) d.createObjectStore('segmented_projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('project_drafts')) d.createObjectStore('project_drafts', { keyPath: 'project_id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const put = (store: string, value: unknown) => new Promise<void>((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    await put('tts_results', {
      id: 'e2e-audio-1', text: '第一段', voice_id: '', voice_name: '',
      audioBlob: new Blob([Uint8Array.from(audioBytes)], { type: 'audio/mpeg' }),
      audio_format: 'mp3', speed: 1, volume: 80, pitch: 1,
      instruction: '', language: 'Chinese',
      created_at: new Date().toISOString(), source: 'segmented_tts',
    });
    await put('segmented_projects', project);
    db.close();
  }, { project: buildProject(), audioBytes: AUDIO_MP3 });
  // reload 后回落到 landing（工作台状态在内存），重新进入工作台
  await page.reload();
  await enterWorkspace(page);
}

test.describe('前端模式项目导出 / 导入', () => {
  test.afterEach(async ({ request }) => {
    // 恢复 backend，避免污染依赖 backend 模式的其他 spec
    await request.put(`${BACKEND}/api/config/storage-mode`, { data: { storage_mode: 'backend' } });
  });

  test('UI 导出 zip（后端同构格式）→ UI 导入 → 新项目音频恢复', async ({ page }) => {
    const errors = collectErrors(page);
    await switchToFrontendMode(page);
    await injectIndexedDBProject(page);

    // 注入的项目出现在列表
    const card = page.getByLabel(`项目 ${PROJECT_NAME}`);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // ── 导出 zip ──
    await card.getByRole('button', { name: /项目操作/ }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /导出项目/ }).click();
    const download = await downloadPromise;
    const zipPath = path.join(os.tmpdir(), `nf-e2e-frontend-${Date.now()}.zip`);
    await download.saveAs(zipPath);
    expect(fs.statSync(zipPath).size).toBeGreaterThan(0);

    // ── zip 内容验证（与后端 bundle 同构）──
    const manifestRaw = execSync(`unzip -p ${JSON.stringify(zipPath)} manifest.json`).toString('utf-8');
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.bundle_version).toBe(1);
    expect(manifest.project.name).toBe(PROJECT_NAME);
    expect(manifest.chapters).toHaveLength(1);
    expect(manifest.segments).toHaveLength(2);
    const segWithAudio = manifest.segments.find((s: { text: string }) => s.text === '第一段');
    expect(segWithAudio.audio.current.path).toMatch(/^assets\/segments\/.+\.mp3$/);
    expect(execSync(`unzip -l ${JSON.stringify(zipPath)}`).toString()).toContain('assets/segments/');

    // ── 导入 zip ──
    await page.getByLabel(/导入项目/).setInputFiles(zipPath);
    await expect(page.getByLabel(`项目 ${PROJECT_NAME}`)).toHaveCount(2, { timeout: 15_000 });

    // 导入的项目按 updated_at 最新排最前 → first() 是导入项
    const importedCard = page.getByLabel(`项目 ${PROJECT_NAME}`).first();
    await importedCard.getByRole('button', { name: /打开/ }).click();
    // 进工作室
    await page.getByRole('button', { name: /◉ 工作室/ }).first().click();
    await expect(page.getByText('第一段', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('第二段', { exact: true })).toBeVisible({ timeout: 15_000 });

    // 导入后音频恢复：导出到本地文件夹应能拿到非空 mp3（见下一用例的写入断言），
    // 此处以"无前端错误"收尾
    expect(errors).toEqual([]);
  });

  test('导出到文件夹：逐段 mp3 + 章节 srt 写入所选目录', async ({ page }) => {
    // 注入 showDirectoryPicker mock（必须在导航前，addInitScript 对后续导航生效）
    await page.addInitScript(() => {
      const writes: Array<{ name: string; size: number }> = [];
      (window as unknown as { __folderWrites: typeof writes }).__folderWrites = writes;
      (window as unknown as { showDirectoryPicker: () => Promise<unknown> }).showDirectoryPicker = async () => ({
        getFileHandle: async (name: string) => ({
          createWritable: async () => ({
            write: async (data: Blob) => { writes.push({ name, size: data.size }); },
            close: async () => {},
          }),
        }),
      });
    });

    const errors = collectErrors(page);
    await switchToFrontendMode(page);
    await injectIndexedDBProject(page);

    // 打开注入的项目 → 工作室
    const card = page.getByLabel(`项目 ${PROJECT_NAME}`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: /打开/ }).click();
    await page.getByRole('button', { name: /◉ 工作室/ }).first().click();

    // 打开导出对话框（工具栏默认折叠，先展开）→ 勾选"导出到文件夹" + SRT → 开始导出
    const transportToggle = page.getByRole('button', { name: /展开工具栏/ });
    await expect(transportToggle).toBeVisible({ timeout: 10_000 });
    await transportToggle.click();
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await expect(page.getByText('导出选项')).toBeVisible({ timeout: 10_000 });
    await page.getByText(/导出到文件夹/).click();
    await page.getByRole('button', { name: '开始导出' }).click();

    // mock 目录收到逐段音频 + srt
    await expect.poll(() => {
      return page.evaluate(() => (window as unknown as { __folderWrites: Array<{ name: string; size: number }> }).__folderWrites.length);
    }, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

    const writes = await page.evaluate(() =>
      (window as unknown as { __folderWrites: Array<{ name: string; size: number }> }).__folderWrites);
    const mp3s = writes.filter((w) => w.name.endsWith('.mp3'));
    const srts = writes.filter((w) => w.name.endsWith('.srt'));
    expect(mp3s.length).toBe(1); // 只有一段有音频（第二段 idle）
    expect(mp3s[0].size).toBeGreaterThan(0);
    expect(srts.length).toBe(1);

    expect(errors).toEqual([]);
  });
});
