/**
 * 前端模式项目打包导出 / 导入（与后端 .narraforge.zip bundle 同构）。
 *
 * 打包格式对齐后端 project_export_service.py：
 * - manifest.json：bundle_version=1，project/chapters/segments/roles/voice_profiles/source_documents
 * - assets/segments/{segId}[.prev].{fmt}：分段音频（前端从 IndexedDB 取 Blob 打进包内）
 * - segment.audio 引用改写为 bundle 内 path（后端导入只认 path 引用）
 *
 * 前端模式角色/音色暂不导出（roles/voice_profiles 留空数组，用户拍板）。
 * 导入时把 bundle 解包并适配成前端模式：音频写回 IndexedDB tts_results，
 * audio 引用改回 {id}，项目重建到 IndexedDB（新 ID，避免覆盖现有项目）。
 */
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';
import type { SegmentedProject, Chapter, Segment } from '../types';
import { getTTSAudioBlob, saveTTSResult } from './indexedDB';
import { indexedDBStorage } from './segmentedProjectStorage';

const BUNDLE_VERSION = 1;

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function audioMime(fmt: string): string {
  if (fmt === 'mp3') return 'audio/mpeg';
  if (fmt === 'ogg') return 'audio/ogg';
  if (fmt === 'm4a') return 'audio/mp4';
  return 'audio/wav';
}

/** 把 segment.audio 里的 IndexedDB id 引用重写为 bundle 内 path 引用，音频打进 files */
async function rewriteSegmentAudioForExport(
  seg: Segment,
  files: Record<string, Uint8Array>,
): Promise<Record<string, unknown> | null> {
  if (!seg.audio) return null;
  const audio: Record<string, unknown> = { ...seg.audio } as Record<string, unknown>;
  for (const slot of ['current', 'previous'] as const) {
    const entry = audio[slot];
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { id?: string; format?: string };
    if (!e.id) continue;
    const fmt = e.format ?? 'mp3';
    const bundlePath = `assets/segments/${seg.id}${slot === 'previous' ? '.prev' : ''}.${fmt}`;
    const blob = await getTTSAudioBlob(e.id);
    if (blob) {
      files[bundlePath] = new Uint8Array(await blob.arrayBuffer());
      // 保留 origin/duration_sec/format 等字段，仅把 id 引用换成 path 引用
      const rest = { ...e };
      delete rest.id;
      audio[slot] = { ...rest, path: bundlePath };
    } else {
      // 源音频缺失：保留原引用并标记 missing（后端导入会原样保留该 entry）
      audio[slot] = { ...e, missing: true };
    }
  }
  return audio;
}

/**
 * 前端模式项目 → 后端同构 .narraforge.zip（Blob）。
 * 导出为纯内存操作，不落盘；音频从 IndexedDB 读取打进 assets/。
 */
export async function exportProjectBundle(project: SegmentedProject): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const now = new Date().toISOString();

  const chapters = (project.chapters ?? []).map((ch) => ({
    id: ch.id,
    position: ch.position ?? 0,
    name: ch.name,
    design_title: ch.design_title ?? null,
    voice: ch.voice ?? {},
    split_config: ch.split_config ?? { delimiters: ['，', '。', '！', '？', '；'], mode: 'rule' },
    original_text: ch.original_text ?? null,
    narration_script: ch.narration_script ?? null,
  }));

  const segments: Record<string, unknown>[] = [];
  for (const ch of project.chapters ?? []) {
    for (const seg of ch.segments ?? []) {
      segments.push({
        id: seg.id,
        chapter_id: ch.id,
        position: seg.position ?? 0,
        text: seg.text,
        emotion: seg.emotion ?? null,
        role_id: seg.role_id ?? null,
        segment_kind: seg.segment_kind ?? 'narration',
        voice: seg.voice ?? {},
        generated_params: seg.generated_params ?? null,
        generated_at: null,
        animation_spec_json: seg.animation_spec ? JSON.stringify(seg.animation_spec) : null,
        audio: await rewriteSegmentAudioForExport(seg, files),
      });
    }
  }

  const manifest = {
    bundle_version: BUNDLE_VERSION,
    exported_at: now,
    project: {
      name: project.name,
      schema_version: project.schema_version ?? 2,
      layout: project.layout ?? 'vertical',
      original_text: null,
      animation_theme: null,
      configs: project.configs ?? {},
      active_chapter_id: project.active_chapter_id ?? null,
      default_narrator_role_id: null,
      // remotion_project_path / narration 文档等本地路径字段不可移植，不导出
    },
    chapters,
    segments,
    roles: [],
    voice_profiles: [],
    source_documents: [],
  };

  const u8 = zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    ...files,
  });
  // fflate 返回 Uint8Array<ArrayBufferLike>；实际为全新 ArrayBuffer（offset 0），直接取 buffer 构造 Blob
  return new Blob([u8.buffer as ArrayBuffer], { type: 'application/zip' });
}

function downloadZip(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 前端模式导出：生成 zip 并触发下载（文件名带项目名，中文安全） */
export async function downloadProjectBundle(project: SegmentedProject): Promise<void> {
  const blob = await exportProjectBundle(project);
  const safeName = (project.name || 'project').replace(/[/\\:*?"<>|]/g, '_').slice(0, 60);
  downloadZip(blob, `${safeName}.narraforge.zip`);
}

/** 从 bundle 恢复某个 segment 的音频：path 引用 → IndexedDB tts_results，返回 {id} 引用形态 */
async function importSegmentAudio(
  s: Record<string, unknown>,
  files: Map<string, Uint8Array>,
): Promise<Segment['audio'] | undefined> {
  const rawAudio = s.audio as {
    format?: string;
    current?: Record<string, unknown> | undefined;
    previous?: Record<string, unknown> | undefined;
  } | undefined;
  if (!rawAudio) return undefined;

  const out: Segment['audio'] = { format: rawAudio.format ?? 'mp3' };
  let hasAudio = false;

  for (const slot of ['current', 'previous'] as const) {
    const entry = rawAudio[slot];
    if (!entry || typeof entry !== 'object') continue;
    const path = entry.path as string | undefined;
    const data = path ? files.get(path) : undefined;
    if (data) {
      const fmt = (entry.format as string | undefined) ?? 'mp3';
      const blob = new Blob([data.buffer as ArrayBuffer], { type: audioMime(fmt) });
      const newAudioId = newId();
      await saveTTSResult({
        id: newAudioId,
        text: (s.text as string) ?? '',
        voice_id: '',
        voice_name: '',
        audioBlob: blob,
        audio_format: fmt,
        speed: 1,
        volume: 80,
        pitch: 1,
        instruction: '',
        language: 'Chinese',
        created_at: new Date().toISOString(),
        source: 'segmented_tts',
      });
      out[slot] = {
        id: newAudioId,
        ...(entry.origin ? { origin: entry.origin as 'tts' | 'recorded' } : {}),
        ...(entry.duration_sec != null ? { duration_sec: entry.duration_sec as number } : {}),
        ...(fmt ? { format: fmt } : {}),
      };
      hasAudio = true;
    } else if (entry.id && slot === 'current') {
      // 包内只有 id 引用（如前端导出时缺失音频的段）：本地已有则复用，否则丢弃该段音频
      const existing = await getTTSAudioBlob(entry.id as string);
      if (existing) {
        out.current = { ...out.current, id: entry.id as string };
        hasAudio = true;
      }
    }
  }
  return hasAudio ? out : undefined;
}

/**
 * 导入后端/前端同构 .narraforge.zip → 重建为前端模式项目（IndexedDB）。
 * 生成全新 ID（不覆盖现有项目）；roles/voice_profiles/source_documents 不导入。
 */
export async function importProjectBundle(data: ArrayBuffer | Uint8Array): Promise<SegmentedProject> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const unzipped = unzipSync(bytes);
  const manifestStr = unzipped['manifest.json'];
  if (!manifestStr) throw new Error('invalid bundle: manifest.json missing');
  const manifest = JSON.parse(strFromU8(manifestStr));
  if (manifest.bundle_version !== BUNDLE_VERSION) {
    throw new Error(`unsupported bundle_version: ${manifest.bundle_version} (expected ${BUNDLE_VERSION})`);
  }
  const files = new Map<string, Uint8Array>(
    Object.entries(unzipped).filter(([k]) => k !== 'manifest.json'),
  );

  const now = new Date().toISOString();
  const chapterMap = new Map<string, string>();

  const chapters: Chapter[] = (manifest.chapters ?? []).map((c: Record<string, unknown>) => {
    const newCid = newId();
    chapterMap.set(c.id as string, newCid);
    return {
      id: newCid,
      name: (c.name as string) ?? 'Chapter',
      position: c.position as number,
      voice: (c.voice as Chapter['voice']) ?? { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' },
      split_config: (c.split_config as Chapter['split_config']) ?? { delimiters: ['，', '。', '！', '？', '；'], mode: 'rule' },
      original_text: (c.original_text as string | undefined) ?? undefined,
      narration_script: (c.narration_script as string | null | undefined) ?? null,
      design_title: (c.design_title as string | undefined) ?? (c.name as string | undefined),
      audio_adjust: null,
      selected_segment_id: undefined,
      segments: [],
      created_at: now,
      updated_at: now,
    };
  });

  for (const s of (manifest.segments ?? []) as Record<string, unknown>[]) {
    const newSid = newId();
    const newCid = chapterMap.get(s.chapter_id as string);
    const chapter = chapters.find((c) => c.id === newCid);
    if (!chapter) continue; // 章节缺失 → 容错跳过该段
    const audio = await importSegmentAudio(s, files);
    chapter.segments.push({
      id: newSid,
      text: (s.text as string) ?? '',
      voice: (s.voice as Segment['voice']) ?? { source: 'chapter' },
      status: audio ? 'ready' : 'idle',
      audio: audio ?? { format: 'mp3' },
      position: (s.position as number) ?? chapter.segments.length,
      generated_params: (s.generated_params as Segment['generated_params']) ?? undefined,
      emotion: (s.emotion as Segment['emotion']) ?? undefined,
      role_id: (s.role_id as string | null) ?? null,
      segment_kind: (s.segment_kind as Segment['segment_kind']) ?? 'narration',
      animation_spec: s.animation_spec_json ? JSON.parse(s.animation_spec_json as string) : null,
      error: undefined,
      created_at: now,
      updated_at: now,
    });
  }

  const project: SegmentedProject = {
    schema_version: 2,
    id: newId(),
    name: (manifest.project?.name as string) ?? 'Imported Project',
    logo: null,
    chapters,
    active_chapter_id: chapterMap.get(manifest.project?.active_chapter_id as string),
    layout: (manifest.project?.layout as SegmentedProject['layout']) ?? 'vertical',
    remotion_project_path: null,
    narration_script: null,
    configs: (manifest.project?.configs as SegmentedProject['configs']) ?? {},
    default_narrator_role_id: null,
    created_at: now,
    updated_at: now,
  };

  await indexedDBStorage.saveProject(project);
  return project;
}

/** 供 UI 触发：解析上传的 File 并导入 */
export async function importProjectBundleFromFile(file: File): Promise<SegmentedProject> {
  return importProjectBundle(await file.arrayBuffer());
}

// 导出供测试断言引用（不改变公共行为）
export const __test = { BUNDLE_VERSION, newId };
