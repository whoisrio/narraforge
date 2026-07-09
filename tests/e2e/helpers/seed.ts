/**
 * Test data seed helper.
 * Creates the "test" project with chapters and roles that E2E tests depend on.
 */
import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE_URL = 'http://127.0.0.1:8002';
const ROOT = path.resolve(__dirname, '..', '..', '..');

/** Delete all roles with the given name to avoid duplicates from prior runs. */
async function deleteRolesByName(page: Page, name: string): Promise<void> {
  const resp = await page.request.get(`${BASE_URL}/api/roles`);
  if (!resp.ok()) return;
  const roles: Array<{ id: string; name: string }> = await resp.json();
  for (const role of roles) {
    if (role.name === name) {
      await page.request.delete(`${BASE_URL}/api/roles/${role.id}`).catch(() => {});
    }
  }
}

/** Create a role via the backend API, cleaning up duplicates first. */
async function createRole(page: Page, id: string, name: string, voice: Record<string, unknown>): Promise<string> {
  // Remove any existing roles with the same name to prevent strict-mode violations in tests
  await deleteRolesByName(page, name);

  const resp = await page.request.post(`${BASE_URL}/api/roles`, {
    data: {
      id,
      name,
      description: 'Cast',
      role_kind: 'cast',
      voice,
      favorite_styles: [],
    },
  });
  if (!resp.ok()) {
    console.warn(`[seed] Role "${name}" creation failed with ${resp.status()}: ${await resp.text()}`);
  }
  const body = await resp.json();
  return body.id;
}

/**
 * Create or update a project with chapters via the backend API.
 * Uses PUT to upsert — if the project already exists, it will be updated.
 */
async function upsertProject(
  page: Page,
  projectId: string,
  name: string,
  chapters: Array<{ id: string; name: string; voice: Record<string, unknown>; segments?: Array<Record<string, unknown>> }>,
): Promise<void> {
  const data = {
    id: projectId,
    name,
    schema_version: 2,
    layout: 'vertical',
    active_chapter_id: chapters[0]?.id ?? null,
    chapters: chapters.map((ch, i) => ({
      id: ch.id,
      position: i,
      name: ch.name,
      voice: ch.voice,
      split_config: { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
      segments: ch.segments ?? [],
    })),
  };

  // Try PUT first (upsert), fall back to POST
  let resp = await page.request.put(`${BASE_URL}/api/segmented-projects/${projectId}`, { data });
  if (resp.status() === 404) {
    resp = await page.request.post(`${BASE_URL}/api/segmented-projects`, { data });
  }
}

/**
 * Seed the test project with chapters and roles.
 * Call this in global setup to ensure test data exists.
 */
export async function seedTestProject(page: Page): Promise<{
  projectId: string;
  chapter1Id: string;
  chapter2Id: string;
  roleXiaomingId: string;
  roleXiaohongId: string;
}> {
  const projectId = 'test-e2e-project';
  const chapter1Id = 'test-chapter-1';
  const chapter2Id = 'test-chapter-2';

  // Clean up stale audio files from prior test runs (avoids false positives
  // when tests assert that deleted segments have their files removed).
  const segDir = path.join(ROOT, 'backend', 'uploads', 'segmented', projectId);
  try { fs.rmSync(segDir, { recursive: true, force: true }); } catch { /* ignore */ }

  // Create project with chapters (each chapter has sample segments for studio tests)
  await upsertProject(page, projectId, 'test', [
    {
      id: chapter1Id,
      name: '第1章 夜路',
      voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' },
      segments: [
        { id: 'seg-1-1', text: '夜色渐浓，小路两旁的树影摇曳。', position: 0, segment_kind: 'narration', emotion: 'neutral', voice: { source: 'chapter' }, status: 'idle', audio: { format: 'mp3' } },
        { id: 'seg-1-2', text: '远处传来几声犬吠，打破了夜晚的寂静。', position: 1, segment_kind: 'narration', emotion: 'calm', voice: { source: 'chapter' }, status: 'idle', audio: { format: 'mp3' } },
        { id: 'seg-1-3', text: '他加快了脚步，心中隐隐有些不安。', position: 2, segment_kind: 'narration', emotion: 'neutral', voice: { source: 'chapter' }, status: 'idle', audio: { format: 'mp3' } },
      ],
    },
    {
      id: chapter2Id,
      name: '第2章 破庙',
      voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' },
      segments: [
        { id: 'seg-2-1', text: '破庙的门半掩着，里面透出微弱的灯光。', position: 0, segment_kind: 'narration', emotion: 'neutral', voice: { source: 'chapter' }, status: 'idle', audio: { format: 'mp3' } },
        { id: 'seg-2-2', text: '他推开门，看到一个老人坐在火堆旁。', position: 1, segment_kind: 'narration', emotion: 'calm', voice: { source: 'chapter' }, status: 'idle', audio: { format: 'mp3' } },
      ],
    },
  ]);

  // Create roles
  const roleXiaomingId = await createRole(page, 'test-role-xiaoming', '小明', {
    engine: 'edge_tts',
    voice: 'zh-CN-YunxiNeural',
    rate: '+0%',
    volume: '+0%',
  });
  const roleXiaohongId = await createRole(page, 'test-role-xiaohong', '小红', {
    engine: 'edge_tts',
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '+0%',
    volume: '+0%',
  });

  return { projectId, chapter1Id, chapter2Id, roleXiaomingId, roleXiaohongId };
}
