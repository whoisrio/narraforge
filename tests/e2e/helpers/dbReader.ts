/**
 * Database-layer reader + assertions for E2E tests.
 *
 * Reads the RAW project rows directly from the database (via node:sqlite for
 * sqlite:// URLs; pg/mysql2 guarded for remote URLs) so tests can verify that
 * writes actually persisted — independently of what the API returns.
 *
 * This complements readBackendProject (API layer, see dataAssertions.ts).
 * Each layer is validated against its OWN contract:
 *   - API  → Pydantic schemas / docs/api-reference.md   (use validateChapter/validateSegment)
 *   - DB   → docs/database-schema.md                    (use validateDbProjectRow)
 *
 * We do NOT assert api === db. They are two independent layers and can each
 * diverge (e.g. service-layer datetime serialization, column mapping). Reading
 * both and validating each against its contract is the point.
 *
 * Connector is connection-string-driven via DATABASE_URL, so it works whether
 * the DB is local (sqlite://) or remote (postgresql://, mysql://).
 */
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  validateEngineParams,
  validateVoiceSource,
  validateAudioMeta,
  validateSplitConfig,
  VALID_ENGINES,
  VALID_EMOTIONS,
} from './dataAssertions';

// ── Types ──

export interface DbProjectRow {
  id: string;
  name: string;
  schema_version: number;
  layout: string;
  active_chapter_id: string | null;
  original_text: string | null;
  animation_theme: string | null;
  remotion_project_path: string | null;
  source_document: string | null;
  default_narrator_role_id: string | null;
  default_narrator_snapshot: unknown;
  configs: unknown;
  created_at: string | null;
  updated_at: string | null;
  [key: string]: unknown;
}

export interface DbChapterRow {
  id: string;
  project_id: string;
  position: number;
  name: string;
  voice: string;
  split_config: string;
  original_text: string | null;
  design_title: string | null;
  created_at: string | null;
  updated_at: string | null;
  [key: string]: unknown;
}

export interface DbSegmentRow {
  id: string;
  chapter_id: string;
  position: number;
  text: string;
  emotion: string | null;
  role_id: string | null;
  segment_kind: string;
  voice: string;
  generated_params: string | null;
  audio: string | null;
  generated_at: string | null;
  animation_spec_json: string | null;
  created_at: string | null;
  updated_at: string | null;
  [key: string]: unknown;
}

export interface DbRoleRow {
  id: string;
  name: string;
  avatar: string | null;
  description: string | null;
  role_kind: string;
  voice: string;
  favorite_styles: string;
  created_at: string | null;
  updated_at: string | null;
  [key: string]: unknown;
}

export interface DbProjectBundle {
  project: DbProjectRow;
  chapters: DbChapterRow[];
  segments: DbSegmentRow[];
  roles: DbRoleRow[];
}

// ── Connection-string-driven connector ──

let cachedDb: DatabaseSync | null = null;

function resolveDatabaseUrl(): string {
  // 1) Explicit DATABASE_URL in the environment (set by e2e-run.cjs)
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  // 2) If ENV_FILE is set (e.g. ENV_FILE=.env.e2e), read the overlay .env
  //    which typically contains the test-isolated DATABASE_URL.
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
  // Normalize — on Windows this may turn "/./foo" into "\foo" which
  // path.isAbsolute wrongly treats as drive-root absolute.
  fp = path.normalize(fp);

  // Absolute path that actually exists → use directly
  // (only for truly absolute paths like C:\foo on Windows or /foo on Unix)
  if (path.isAbsolute(fp) && fs.existsSync(fp)) return fp;

  // Strip any leading slash/backslash so path.resolve treats it as relative.
  // E.g. on Windows "\voice_clone.db" → "voice_clone.db"
  const stripped = fp.replace(/^[/\\]+/, '');

  // Try candidates relative to CWD
  const candidates = [
    path.resolve(process.cwd(), 'backend', stripped),
    path.resolve(process.cwd(), stripped),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Return the most likely location even if it doesn't exist yet
  return candidates[0];
}

function getDb(): DatabaseSync {
  if (cachedDb) return cachedDb;
  const url = resolveDatabaseUrl();
  if (url.startsWith('sqlite://')) {
    const file = resolveSqliteFilePath(url);
    if (!fs.existsSync(file)) {
      throw new Error(`[dbReader] SQLite file not found: ${file}\n(resolved from DATABASE_URL="${url}").`);
    }
    cachedDb = new DatabaseSync(file, { readOnly: true });
    return cachedDb;
  }
  if (url.startsWith('postgresql://') || url.startsWith('postgres://') || url.startsWith('mysql://')) {
    throw new Error(
      `[dbReader] Remote DB ("${url.split('://')[0]}") is not supported in Phase 0. ` +
      `Install 'pg'/'mysql2' and add a connector shim. The local sqlite:// dev DB is fully covered.`,
    );
  }
  throw new Error(`[dbReader] Unsupported DATABASE_URL scheme: ${url}`);
}

// ── JSON parsing helper ──

function parseJson(v: unknown, label: string): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`[dbReader] ${label} is not valid JSON: ${(e as Error).message}`);
    }
  }
  throw new Error(`[dbReader] ${label} expected JSON object/string, got ${typeof v}`);
}

/**
 * Validate that params captured at synthesis time are well-formed.
 * NOTE: segment.generated_params uses the FLAT SegmentEngineParams shape
 * (edge_voice / edge_rate / ...), which differs from the EngineParams
 * discriminated union (voice / rate / ...) stored in chapter.voice / roles.voice.
 * We therefore only assert the engine is valid here — not the full union.
 */
function validateGeneratedParams(p: Record<string, unknown>, label: string): void {
  if (!p || typeof p !== 'object') throw new Error(`${label}: must be an object, got ${typeof p}`);
  if (!p.engine || typeof p.engine !== 'string') throw new Error(`${label}: missing "engine"`);
  if (!VALID_ENGINES.includes(p.engine as string)) {
    throw new Error(`${label}: engine "${p.engine}" not in [${VALID_ENGINES.join(', ')}]`);
  }
}

// ── Readers ──

/**
 * Read a single project bundle (project + chapters + segments + referenced roles)
 * directly from the database. Returns undefined if the project id does not exist.
 */
export async function readDbProject(projectId: string): Promise<DbProjectBundle | undefined> {
  const db = getDb();
  const project = db
    .prepare('SELECT * FROM segmented_projects WHERE id = ?')
    .get(projectId) as DbProjectRow | undefined;
  if (!project) return undefined;

  const chapters = db
    .prepare('SELECT * FROM segmented_project_chapters WHERE project_id = ? ORDER BY position ASC')
    .all(projectId) as DbChapterRow[];

  const segments = db
    .prepare(
      `SELECT s.* FROM segmented_project_segments s
       JOIN segmented_project_chapters c ON s.chapter_id = c.id
       WHERE c.project_id = ?
       ORDER BY c.position ASC, s.position ASC`,
    )
    .all(projectId) as DbSegmentRow[];

  const roleIds: string[] = [];
  if (project.default_narrator_role_id) roleIds.push(project.default_narrator_role_id);
  for (const s of segments) if (s.role_id) roleIds.push(s.role_id);

  let roles: DbRoleRow[] = [];
  if (roleIds.length > 0) {
    const placeholders = roleIds.map(() => '?').join(',');
    roles = db.prepare(`SELECT * FROM roles WHERE id IN (${placeholders})`).all(...roleIds) as DbRoleRow[];
  }

  return { project, chapters, segments, roles };
}

/**
 * Read all project summary rows from the database (for count / existence assertions).
 * Does NOT include nested chapters/segments.
 */
export async function readDbProjects(): Promise<DbProjectRow[]> {
  const db = getDb();
  return db.prepare('SELECT * FROM segmented_projects').all() as DbProjectRow[];
}

// ── DB-contract validator (docs/database-schema.md) ──

/**
 * Validate a raw DB project bundle against docs/database-schema.md.
 * Throws on any contract violation. Reuses the source-agnostic JSON-field
 * validators (validateEngineParams etc.) for the JSON columns.
 */
export function validateDbProjectRow(bundle: DbProjectBundle): void {
  const p = bundle.project;

  // ── segmented_projects ──
  if (typeof p.id !== 'string' || !p.id) throw new Error('[db] project.id missing or invalid');
  if (typeof p.name !== 'string' || !p.name) throw new Error(`[db] project "${p.id}" name missing`);
  if (p.schema_version !== 2) {
    throw new Error(`[db] project "${p.id}" schema_version expected 2, got ${p.schema_version}`);
  }
  if (typeof p.layout !== 'string') throw new Error(`[db] project "${p.id}" layout missing`);
  if (p.default_narrator_role_id !== null && typeof p.default_narrator_role_id !== 'string') {
    throw new Error(`[db] project "${p.id}" default_narrator_role_id invalid`);
  }
  if (p.configs !== null) {
    const cfg = parseJson(p.configs, `db project ${p.id} configs`);
    if (typeof cfg !== 'object') throw new Error(`[db] project "${p.id}" configs not an object`);
  }
  for (const key of ['created_at', 'updated_at'] as const) {
    if (p[key] !== null && typeof p[key] !== 'string') {
      throw new Error(`[db] project "${p.id}" ${key} missing`);
    }
  }

  // ── segmented_project_chapters ──
  for (const ch of bundle.chapters) {
    if (ch.project_id !== p.id) {
      throw new Error(`[db] chapter "${ch.id}" project_id "${ch.project_id}" != project "${p.id}"`);
    }
    if (typeof ch.position !== 'number') throw new Error(`[db] chapter "${ch.id}" position not a number`);
    if (typeof ch.name !== 'string' || !ch.name) throw new Error(`[db] chapter "${ch.id}" name missing`);
    const voice = parseJson(ch.voice, `db chapter ${ch.id} voice`);
    validateEngineParams(voice, `db chapter ${ch.id}.voice`);
    const split = parseJson(ch.split_config, `db chapter ${ch.id} split_config`);
    validateSplitConfig(split, `db chapter ${ch.id}.split_config`);
  }

  // ── segmented_project_segments ──
  for (const s of bundle.segments) {
    if (typeof s.position !== 'number') throw new Error(`[db] segment "${s.id}" position not a number`);
    if (typeof s.text !== 'string') throw new Error(`[db] segment "${s.id}" text missing`);
    if (s.emotion !== null && !VALID_EMOTIONS.includes(s.emotion)) {
      throw new Error(`[db] segment "${s.id}" emotion invalid: "${s.emotion}"`);
    }
    if (!['narration', 'dialogue'].includes(s.segment_kind)) {
      throw new Error(`[db] segment "${s.id}" segment_kind invalid: "${s.segment_kind}"`);
    }
    const voice = parseJson(s.voice, `db segment ${s.id} voice`);
    validateVoiceSource(voice, `db segment ${s.id}.voice`);
    if (s.audio !== null) {
      const audio = parseJson(s.audio, `db segment ${s.id} audio`);
      validateAudioMeta(audio, `db segment ${s.id}.audio`);
    }
    if (s.generated_params !== null) {
      const gp = parseJson(s.generated_params, `db segment ${s.id} generated_params`);
      validateGeneratedParams(gp, `db segment ${s.id}.generated_params`);
    }
  }

  // ── referenced roles ──
  for (const r of bundle.roles) {
    if (typeof r.id !== 'string') throw new Error('[db] role.id missing or invalid');
    const voice = parseJson(r.voice, `db role ${r.id} voice`);
    validateEngineParams(voice, `db role ${r.id}.voice`);
  }
}
