/**
 * Database-layer WRITER for E2E test scaffolding.
 *
 * After the segmented-project API granularity refactor, the big PUT no longer
 * writes server-owned fields (audio / generated_params / generated_at) on
 * EXISTING segments — only synthesis / recording / PATCH endpoints may. Tests
 * that need to simulate an already-synthesized segment therefore cannot attach
 * fake audio via PUT anymore; they must write the DB directly.
 *
 * Connection resolution mirrors dbReader.ts (DATABASE_URL → ENV_FILE overlay →
 * backend/.env → default). The e2e DB is backend/voice_clone_e2e.db (SQLite,
 * WAL mode — a direct writer is fine).
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

let cachedDb: DatabaseSync | null = null;

function resolveDatabaseUrl(): string {
  // 1) Explicit DATABASE_URL in the environment (set by e2e-run.cjs)
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // 2) ENV_FILE overlay (e.g. ENV_FILE=.env.e2e) with the test-isolated DATABASE_URL
  const overlayName = process.env.ENV_FILE;
  if (overlayName) {
    const overlayPath = path.resolve(process.cwd(), 'backend', overlayName);
    if (fs.existsSync(overlayPath)) {
      const overlayTxt = fs.readFileSync(overlayPath, 'utf-8');
      const overlayMatch = overlayTxt.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m);
      if (overlayMatch) return overlayMatch[1];
    }
  }

  // 3) Fallback: read backend/.env
  const envPath = path.resolve(process.cwd(), 'backend', '.env');
  if (fs.existsSync(envPath)) {
    const txt = fs.readFileSync(envPath, 'utf-8');
    const m = txt.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m);
    if (m) return m[1];
  }

  // 4) Hard-coded default
  return 'sqlite:///./voice_clone.db';
}

function resolveSqliteFilePath(url: string): string {
  let fp = url.replace(/^sqlite:\/\//, '');
  if (fp.startsWith('///')) fp = fp.slice(3);
  else if (fp.startsWith('//')) fp = fp.slice(2);
  fp = path.normalize(fp);

  if (path.isAbsolute(fp) && fs.existsSync(fp)) return fp;

  const stripped = fp.replace(/^[/\\]+/, '');
  const candidates = [
    path.resolve(process.cwd(), 'backend', stripped),
    path.resolve(process.cwd(), stripped),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function getDb(): DatabaseSync {
  if (cachedDb) return cachedDb;
  const url = resolveDatabaseUrl();
  if (!url.startsWith('sqlite://')) {
    throw new Error(`[dbWriter] Unsupported DATABASE_URL scheme (sqlite only): ${url}`);
  }
  const file = resolveSqliteFilePath(url);
  if (!fs.existsSync(file)) {
    throw new Error(`[dbWriter] SQLite file not found: ${file}\n(resolved from DATABASE_URL="${url}").`);
  }
  cachedDb = new DatabaseSync(file, {
    // WAL 下后端可能短暂持有写锁；给 busy timeout 避免偶发 SQLITE_BUSY
    timeout: 5000,
  });
  return cachedDb;
}

/**
 * 给已存在的段挂假音频（模拟已合成）。测试脚手架专用：PUT 契约变化后
 * 已存在段的 audio 只能由服务端自产端点写入，测试只能直写 DB。
 *
 * The caller must also write the fake audio FILE to disk itself
 * (see writeFakeAudio in the specs) — this only updates the DB row.
 *
 * Throws when the segment id does not exist.
 */
export function attachSegmentAudio(
  segmentId: string,
  relPath: string,
  opts?: { durationSec?: number; origin?: string },
): void {
  const db = getDb();
  const durationSec = opts?.durationSec ?? 0.4;
  const origin = opts?.origin ?? 'tts';
  const audio = JSON.stringify({
    format: 'mp3',
    duration_sec: durationSec,
    current: { path: relPath, format: 'mp3', origin, duration_sec: durationSec },
  });
  const generatedParams = JSON.stringify({ engine: 'edge_tts', voice: 'zh-CN-YunxiNeural' });
  const res = db
    .prepare('UPDATE segmented_project_segments SET audio = ?, generated_params = ? WHERE id = ?')
    .run(audio, generatedParams, segmentId);
  if (Number(res.changes) === 0) {
    throw new Error(`[dbWriter] segment not found: ${segmentId}`);
  }
}
