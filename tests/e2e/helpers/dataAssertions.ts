/**
 * Data-layer assertion helpers for E2E tests.
 *
 * Provides utilities to read IndexedDB state and intercept API responses
 * so tests can verify actual data changes, not just UI visibility.
 */
import type { Page, Response } from '@playwright/test';

// ── IndexedDB types (subset of frontend types) ──

interface SegmentAudio {
  current?: { id?: string; path?: string; duration_sec?: number };
  previous?: { id?: string; path?: string; duration_sec?: number };
  format: string;
  duration_sec?: number;
}

interface Segment {
  id: string;
  text: string;
  voice: { source: string; [key: string]: unknown };
  status: string;
  audio: SegmentAudio;
  emotion?: string;
  segment_kind: string;
}

interface Chapter {
  id: string;
  name: string;
  voice: Record<string, unknown>;
  split_config?: Record<string, unknown>;
  segments: Segment[];
}

interface SegmentedProject {
  id: string;
  name: string;
  chapters: Chapter[];
  created_at: string;
  updated_at: string;
}

// ── Backend API readers ──

/**
 * Read all segmented projects from the backend API.
 * Works in backend storage mode where data lives in SQLite.
 */
export async function readBackendProjects(page: Page): Promise<SegmentedProject[]> {
  return page.evaluate(async () => {
    const resp = await fetch('/api/segmented-projects');
    if (!resp.ok) return [];
    const list = await resp.json();
    // The list endpoint returns summary data; fetch full detail for each
    const projects: SegmentedProject[] = [];
    for (const item of list) {
      const detailResp = await fetch(`/api/segmented-projects/${item.id}`);
      if (detailResp.ok) {
        projects.push(await detailResp.json());
      }
    }
    return projects;
  });
}

/**
 * Read a single segmented project from the backend API by ID.
 */
export async function readBackendProject(page: Page, projectId: string): Promise<SegmentedProject | undefined> {
  return page.evaluate(async (id) => {
    const resp = await fetch(`/api/segmented-projects/${id}`);
    if (!resp.ok) return undefined;
    return resp.json();
  }, projectId);
}

/**
 * Read all segmented projects — uses backend API (works with backend storage mode).
 */
export async function readIndexedDBProjects(page: Page): Promise<SegmentedProject[]> {
  return readBackendProjects(page);
}

/**
 * Read a single segmented project by ID — uses backend API.
 */
export async function readIndexedDBProject(page: Page, projectId: string): Promise<SegmentedProject | undefined> {
  return readBackendProject(page, projectId);
}

/**
 * Find the active project by picking the most recently updated project from the backend.
 */
export async function readActiveProject(page: Page): Promise<SegmentedProject | undefined> {
  const projects = await readBackendProjects(page);
  if (projects.length === 0) return undefined;
  return projects.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
}

// ── API interception helpers ──

/**
 * Set up a response interceptor that captures the next API response matching
 * the given URL pattern and HTTP method.
 *
 * Returns a promise that resolves with the parsed JSON body of the response.
 * Call this BEFORE triggering the action that causes the API call.
 */
export function interceptApiResponse(
  page: Page,
  urlPattern: string | RegExp,
  method?: string,
): Promise<{ status: number; body: unknown; request: { method: string; url: string; postData: unknown } }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for API response matching ${urlPattern}`)), 30_000);

    const handler = async (response: Response) => {
      try {
        const url = response.url();
        const reqMethod = response.request().method();
        const matchesUrl = typeof urlPattern === 'string' ? url.includes(urlPattern) : urlPattern.test(url);
        const matchesMethod = method ? reqMethod === method.toUpperCase() : true;
        if (matchesUrl && matchesMethod) {
          clearTimeout(timeout);
          page.removeListener('response', handler);
          const body = await response.json().catch(() => null);
          resolve({
            status: response.status(),
            body,
            request: {
              method: reqMethod,
              url,
              postData: response.request().postDataJSON(),
            },
          });
        }
      } catch (e) {
        clearTimeout(timeout);
        page.removeListener('response', handler);
        reject(e);
      }
    };

    page.on('response', handler);
  });
}

/**
 * Set up a response interceptor for a POST request to a URL pattern.
 * Returns both the request body and the response body.
 */
export function interceptPostResponse(
  page: Page,
  urlPattern: string | RegExp,
): Promise<{ status: number; body: unknown; requestBody: unknown }> {
  return interceptApiResponse(page, urlPattern, 'POST').then(result => ({
    status: result.status,
    body: result.body,
    requestBody: result.request.postData,
  }));
}

/**
 * Set up a response interceptor for a PUT request to a URL pattern.
 * Returns both the request body and the response body.
 */
export function interceptPutResponse(
  page: Page,
  urlPattern: string | RegExp,
): Promise<{ status: number; body: unknown; requestBody: unknown }> {
  return interceptApiResponse(page, urlPattern, 'PUT').then(result => ({
    status: result.status,
    body: result.body,
    requestBody: result.request.postData,
  }));
}

// ── JSON Schema Validators ──

const VALID_ENGINES = ['edge_tts', 'cosyvoice', 'mimo_tts', 'voxcpm'];
const VALID_EMOTIONS = ['happy', 'sad', 'angry', 'calm', 'neutral', 'excited'];
const VALID_SOURCES = ['chapter', 'role', 'custom'];

/**
 * Validate EngineParams JSON (discriminated union by engine field).
 * Used in: chapter.voice, segment.generated_params, roles.voice
 *
 * - edge_tts: {engine, voice, rate?, volume?}
 * - cosyvoice: {engine, voice_id, speed?, volume?, pitch?, language?, instruction?}
 * - mimo_tts: {engine, mode: "preset"|"voiceclone"|"voicedesign", voice_id?, voice_description?, instruction?}
 * - voxcpm: {engine, mode: "clone"|"ultimate"|"design", voice_id?, style_control?, cfg_value?, inference_timesteps?, voice_description?}
 */
export function validateEngineParams(params: Record<string, unknown>, label: string): void {
  if (!params || typeof params !== 'object') {
    throw new Error(`${label}: EngineParams must be an object, got ${typeof params}`);
  }
  if (!params.engine || typeof params.engine !== 'string') {
    throw new Error(`${label}: missing or invalid "engine" field`);
  }
  if (!VALID_ENGINES.includes(params.engine as string)) {
    throw new Error(`${label}: engine "${params.engine}" not in [${VALID_ENGINES.join(', ')}]`);
  }

  const engine = params.engine as string;

  if (engine === 'edge_tts') {
    // Allow empty string for newly created chapters that haven't selected a voice yet.
    if (params.voice === undefined || params.voice === null || typeof params.voice !== 'string') {
      throw new Error(`${label}: edge_tts requires "voice" (string), got ${typeof params.voice}`);
    }
    if (params.rate !== undefined && typeof params.rate !== 'string') {
      throw new Error(`${label}: edge_tts "rate" should be string like "+10%", got ${typeof params.rate}`);
    }
    if (params.volume !== undefined && typeof params.volume !== 'string') {
      throw new Error(`${label}: edge_tts "volume" should be string like "+0%", got ${typeof params.volume}`);
    }
  }

  if (engine === 'cosyvoice') {
    if (!params.voice_id || typeof params.voice_id !== 'string') {
      throw new Error(`${label}: cosyvoice requires "voice_id" (string)`);
    }
    if (params.speed !== undefined && typeof params.speed !== 'number') {
      throw new Error(`${label}: cosyvoice "speed" should be number, got ${typeof params.speed}`);
    }
    if (params.language !== undefined && !['Chinese', 'English', 'Japanese', 'Korean'].includes(params.language as string)) {
      throw new Error(`${label}: cosyvoice "language" invalid: "${params.language}"`);
    }
  }

  if (engine === 'mimo_tts') {
    const mode = (params.mode as string) ?? 'preset';
    if (!['preset', 'voiceclone', 'voicedesign'].includes(mode)) {
      throw new Error(`${label}: mimo_tts mode "${mode}" not in [preset, voiceclone, voicedesign]`);
    }
    if (mode === 'preset' && !params.voice_id) {
      throw new Error(`${label}: mimo_tts preset mode requires "voice_id"`);
    }
    if (mode === 'voicedesign' && !params.voice_description) {
      throw new Error(`${label}: mimo_tts voicedesign mode requires "voice_description"`);
    }
  }

  if (engine === 'voxcpm') {
    const mode = (params.mode as string) ?? 'clone';
    if (!['clone', 'ultimate', 'design'].includes(mode)) {
      throw new Error(`${label}: voxcpm mode "${mode}" not in [clone, ultimate, design]`);
    }
    if (params.cfg_value !== undefined && typeof params.cfg_value !== 'number') {
      throw new Error(`${label}: voxcpm "cfg_value" should be number, got ${typeof params.cfg_value}`);
    }
    if (params.inference_timesteps !== undefined && typeof params.inference_timesteps !== 'number') {
      throw new Error(`${label}: voxcpm "inference_timesteps" should be number, got ${typeof params.inference_timesteps}`);
    }
  }
}

/**
 * Validate VoiceSource JSON (discriminated union by source field).
 * Used in: segment.voice
 *
 * - chapter: {source: "chapter"}
 * - role: {source: "role", role_id: string}
 * - custom: {source: "custom", engine?: string, params?: object, role_id?: string}
 */
export function validateVoiceSource(voice: Record<string, unknown>, label: string): void {
  if (!voice || typeof voice !== 'object') {
    throw new Error(`${label}: VoiceSource must be an object, got ${typeof voice}`);
  }
  if (!voice.source || !VALID_SOURCES.includes(voice.source as string)) {
    throw new Error(`${label}: voice.source "${voice.source}" not in [${VALID_SOURCES.join(', ')}]`);
  }

  if (voice.source === 'role' && !voice.role_id) {
    throw new Error(`${label}: voice.source="role" requires "role_id"`);
  }

  if (voice.source === 'custom') {
    if (voice.engine !== undefined && !VALID_ENGINES.includes(voice.engine as string)) {
      throw new Error(`${label}: custom voice engine "${voice.engine}" not in [${VALID_ENGINES.join(', ')}]`);
    }
    if (voice.params !== undefined && typeof voice.params !== 'object') {
      throw new Error(`${label}: custom voice "params" should be an object`);
    }
  }
}

/**
 * Validate audio metadata JSON.
 * Used in: segment.audio
 *
 * {current: {id?: string, path?: string}, previous?: {...}, format: "mp3"|"wav", duration_sec?: number}
 */
export function validateAudioMeta(audio: Record<string, unknown>, label: string): void {
  if (!audio || typeof audio !== 'object') {
    throw new Error(`${label}: audio must be an object, got ${typeof audio}`);
  }
  if (!audio.format || !['mp3', 'wav'].includes(audio.format as string)) {
    throw new Error(`${label}: audio.format "${audio.format}" not in [mp3, wav]`);
  }
  // audio.current is optional — idle segments may not have generated audio yet
  if (audio.current !== undefined && audio.current !== null) {
    if (typeof audio.current !== 'object') {
      throw new Error(`${label}: audio.current must be an object`);
    }
    const current = audio.current as Record<string, unknown>;
    if (!current.id && !current.path) {
      throw new Error(`${label}: audio.current must have "id" or "path"`);
    }
  }
  if (audio.duration_sec !== undefined && (typeof audio.duration_sec !== 'number' || audio.duration_sec <= 0)) {
    throw new Error(`${label}: audio.duration_sec should be positive number, got ${audio.duration_sec}`);
  }
  if (audio.previous !== undefined && audio.previous !== null) {
    const prev = audio.previous as Record<string, unknown>;
    if (!prev.id && !prev.path) {
      throw new Error(`${label}: audio.previous must have "id" or "path" if present`);
    }
  }
}

/**
 * Validate split_config JSON.
 * Used in: chapter.split_config
 *
 * {delimiters: string[], mode: "rule"|"llm"}
 */
export function validateSplitConfig(config: Record<string, unknown>, label: string): void {
  if (!config || typeof config !== 'object') {
    throw new Error(`${label}: split_config must be an object`);
  }
  if (!Array.isArray(config.delimiters)) {
    throw new Error(`${label}: split_config.delimiters must be an array`);
  }
  if (config.delimiters.length === 0) {
    throw new Error(`${label}: split_config.delimiters must not be empty`);
  }
  if (!config.mode || !['rule', 'llm'].includes(config.mode as string)) {
    throw new Error(`${label}: split_config.mode "${config.mode}" not in [rule, llm]`);
  }
}

/**
 * Full segment validation — checks all JSON fields against schema.
 */
export function validateSegment(seg: Segment, label?: string): void {
  const id = label || `Segment "${seg.id}"`;

  // Basic fields
  if (!seg.id || typeof seg.id !== 'string') {
    throw new Error(`${id}: missing or invalid "id"`);
  }
  if (typeof seg.text !== 'string') {
    throw new Error(`${id}: "text" must be string`);
  }
  if (seg.emotion !== undefined && seg.emotion !== null && !VALID_EMOTIONS.includes(seg.emotion)) {
    throw new Error(`${id}: emotion "${seg.emotion}" not in [${VALID_EMOTIONS.join(', ')}]`);
  }
  if (!['narration', 'dialogue'].includes(seg.segment_kind)) {
    throw new Error(`${id}: segment_kind "${seg.segment_kind}" not in [narration, dialogue]`);
  }

  // JSON fields
  validateVoiceSource(seg.voice as unknown as Record<string, unknown>, `${id}.voice`);
  if (seg.audio) {
    validateAudioMeta(seg.audio as unknown as Record<string, unknown>, `${id}.audio`);
  }
  if (seg.status !== undefined && !['idle', 'queued', 'pending', 'ready', 'failed'].includes(seg.status)) {
    throw new Error(`${id}: status "${seg.status}" not in [idle, queued, pending, ready, failed]`);
  }
}

/**
 * Full chapter validation — checks voice and split_config JSON.
 */
export function validateChapter(ch: Chapter, label?: string): void {
  const id = label || `Chapter "${ch.id}"`;

  if (!ch.id || typeof ch.id !== 'string') {
    throw new Error(`${id}: missing or invalid "id"`);
  }
  if (!ch.name || typeof ch.name !== 'string') {
    throw new Error(`${id}: missing or invalid "name"`);
  }
  if (!Array.isArray(ch.segments)) {
    throw new Error(`${id}: "segments" must be an array`);
  }

  // Validate chapter voice (EngineParams)
  validateEngineParams(ch.voice as Record<string, unknown>, `${id}.voice`);

  // Validate split_config if present
  if (ch.split_config) {
    validateSplitConfig(ch.split_config as unknown as Record<string, unknown>, `${id}.split_config`);
  }

  // Validate each segment
  for (let i = 0; i < ch.segments.length; i++) {
    validateSegment(ch.segments[i], `${id}.segments[${i}]`);
  }
}

// ── Assertion helpers ──

/**
 * Assert that a segment in the active project has the expected voice source.
 */
export function assertSegmentVoiceSource(
  segments: Segment[],
  segmentIndex: number,
  expectedSource: string,
): void {
  const seg = segments[segmentIndex];
  if (!seg) throw new Error(`Segment at index ${segmentIndex} not found (total: ${segments.length})`);
  if (seg.voice.source !== expectedSource) {
    throw new Error(
      `Segment ${segmentIndex} voice.source expected "${expectedSource}" but got "${seg.voice.source}"`,
    );
  }
}

/**
 * Assert that a segment has generated audio with valid fields.
 */
export function assertSegmentHasAudio(segment: Segment): void {
  if (segment.status !== 'ready') {
    throw new Error(`Segment "${segment.id}" status expected "ready" but got "${segment.status}"`);
  }
  if (!segment.audio?.current?.path && !segment.audio?.current?.id) {
    throw new Error(`Segment "${segment.id}" has no audio path or id in audio.current`);
  }
  if (segment.audio?.format && !['mp3', 'wav'].includes(segment.audio.format)) {
    throw new Error(`Segment "${segment.id}" audio.format expected "mp3" or "wav" but got "${segment.audio.format}"`);
  }
  if (segment.audio?.duration_sec !== undefined && segment.audio.duration_sec <= 0) {
    throw new Error(`Segment "${segment.id}" audio.duration_sec should be > 0, got ${segment.audio.duration_sec}`);
  }
}

/**
 * Assert that a segment's voice source matches the expected value.
 */
export function assertVoiceSource(segment: Segment, expectedSource: string): void {
  if (segment.voice.source !== expectedSource) {
    throw new Error(
      `Segment "${segment.id}" voice.source expected "${expectedSource}" but got "${segment.voice.source}"`,
    );
  }
}

/**
 * Assert that a chapter voice has the expected engine and voice fields.
 */
export function assertChapterVoice(
  chapter: Chapter,
  expectedEngine: string,
  expectedVoice?: string,
): void {
  if (chapter.voice.engine !== expectedEngine) {
    throw new Error(
      `Chapter "${chapter.id}" voice.engine expected "${expectedEngine}" but got "${chapter.voice.engine}"`,
    );
  }
  if (expectedVoice !== undefined && chapter.voice.voice !== expectedVoice) {
    throw new Error(
      `Chapter "${chapter.id}" voice.voice expected "${expectedVoice}" but got "${chapter.voice.voice}"`,
    );
  }
}

/**
 * Assert that a segment has a valid emotion type.
 */
export function assertValidEmotion(segment: Segment): void {
  if (!segment.emotion) {
    throw new Error(`Segment "${segment.id}" has no emotion assigned`);
  }
  if (!VALID_EMOTIONS.includes(segment.emotion)) {
    throw new Error(
      `Segment "${segment.id}" emotion "${segment.emotion}" is not one of [${VALID_EMOTIONS.join(', ')}]`,
    );
  }
}

/**
 * Assert that a segment's text exactly matches the expected value.
 */
export function assertSegmentTextEquals(segment: Segment, expectedText: string): void {
  if (segment.text !== expectedText) {
    throw new Error(
      `Segment "${segment.id}" text mismatch.\nExpected: "${expectedText.slice(0, 50)}..."\nActual:   "${segment.text.slice(0, 50)}..."`,
    );
  }
}

/**
 * Assert that a segment has non-empty text.
 */
export function assertSegmentHasText(segment: Segment, minLength = 1): void {
  if (!segment.text || segment.text.trim().length < minLength) {
    throw new Error(
      `Segment "${segment.id}" text is too short (expected >= ${minLength} chars, got "${segment.text}")`,
    );
  }
}

/**
 * Count segments with status 'ready' (generated audio).
 */
export function countReadySegments(project: SegmentedProject): number {
  let count = 0;
  for (const ch of project.chapters) {
    for (const seg of ch.segments) {
      if (seg.status === 'ready') count++;
    }
  }
  return count;
}

/**
 * Get total segment count across all chapters.
 */
export function totalSegmentCount(project: SegmentedProject): number {
  return project.chapters.reduce((sum, ch) => sum + ch.segments.length, 0);
}
