import type { SegmentedProject, Chapter, Segment, EngineParams, SegmentKind, EmotionType, VoiceSource, RoleSnapshot, ProsodyMark, SegmentTextTransforms, PronunciationMapEntry } from '../types';
import { createTranslator } from '../i18n';

let _idCounter = 0;
function uid(): string {
  _idCounter++;
  return `${Date.now()}-${_idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeChapter(name: string, inheritFrom?: Chapter): Chapter {
  const now = new Date().toISOString();
  const defaultVoice = inheritFrom?.voice || { engine: 'edge_tts' as const, voice: '', rate: '+0%', volume: '+0%' };
  return {
    id: uid(),
    name,
    voice: defaultVoice,
    segments: [],
    split_config: inheritFrom?.split_config || { delimiters: ['，', '。', '！', '？', '；'], mode: 'rule' },
    created_at: now,
    updated_at: now,
  };
}

export function createInitialProject(translate?: (key: string) => string): SegmentedProject {
  const _t = translate ?? createTranslator('zh-CN');
  const now = new Date().toISOString();
  const ch = makeChapter(_t('segmentedProject.defaultChapterName'));
  return {
    schema_version: 2,
    id: uid(),
    name: _t('segmentedProject.newProject'),
    chapters: [ch],
    active_chapter_id: ch.id,
    layout: 'vertical',
    remotion_project_path: null,
    created_at: now,
    updated_at: now,
  };
}

type RawSegment = Omit<Partial<Segment>, 'voice' | 'audio'> & {
  voice?: unknown;
  audio?: unknown;
  generated_params?: unknown;
};

type RawChapter = Partial<Chapter> & { segments?: RawSegment[] };
export type RawSegmentedProject = Omit<Partial<SegmentedProject>, 'schema_version'> & { schema_version?: number; chapters?: RawChapter[]; segments?: Segment[] };

function isEmotionType(value: unknown): value is EmotionType {
  return typeof value === 'string' && ['happy', 'sad', 'angry', 'calm', 'neutral', 'excited'].includes(value);
}

function enrichSegment(raw: RawSegment): Segment {
  const now = new Date().toISOString();
  const rawAudio = raw.audio as Segment['audio'] | undefined;
  // A segment is ready only when its *current* audio ref is valid. In backend
  // mode the server sets current.file_exists=false when the mp3 is gone
  // (db/fs desync) -> drop to idle so the UI matches export's current-file
  // check. file_exists absent (frontend id-mode, or in-memory fresh synth)
  // falls back to "ref present" to stay backward compatible.
  const cur = rawAudio?.current;
  const hasAudio = !!cur && cur.file_exists !== false && !!(cur.path || cur.id);
  const voice: VoiceSource = ((raw as Record<string, unknown>).voice as VoiceSource) ?? { source: 'chapter' } as VoiceSource;
  const audio: Segment['audio'] = rawAudio ?? { format: 'mp3' };
  // Always use audio.current.duration_sec as the authoritative source.
  // The top-level duration_sec can be stale (leaked from a prior autosave),
  // and the old !audio.duration_sec guard would silently keep the wrong value
  // after post-synthesis speed adjustment. Force-overwrite every time.
  audio.duration_sec = audio.current?.duration_sec;
  const base: Segment = {
    id: raw.id ?? uid(),
    text: raw.text ?? '',
    voice,
    status: raw.status ?? (hasAudio ? 'ready' : 'idle'),
    error: raw.error,
    audio,
    generated_params: (raw.generated_params as Partial<EngineParams>) ?? undefined,
    emotion: isEmotionType(raw.emotion) ? raw.emotion : undefined,
    role_id: raw.role_id ?? null,
    segment_kind: raw.segment_kind ?? 'narration',
    // 透传后端 animation_spec（分镜 brief），否则分镜视图拿不到数据
    animation_spec: raw.animation_spec ?? null,
    // 合成时文本变换（发音映射段级引用 + 小写化覆盖），IndexedDB 透传
    text_transforms: raw.text_transforms ?? undefined,
    created_at: raw.created_at || now,
    updated_at: raw.updated_at || now,
  };
  return base;
}

export function migrateV1(raw: RawSegmentedProject, translate?: (key: string) => string): SegmentedProject {
  const _t = translate ?? createTranslator('zh-CN');
  if (raw.schema_version === 2 && raw.chapters) {
    // Enrich segments with frontend-only fields that the backend doesn't return
    const chapters: Chapter[] = raw.chapters.map((ch) => {
      const voice = ch.voice || { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' };
      return {
        ...ch,
        voice: voice,
        split_config: ch.split_config || { delimiters: ['，', '。', '！', '？', '；'], mode: 'rule' },
        design_title: ch.design_title ?? ch.name,
        segments: (ch.segments || []).map((s) => enrichSegment(s)),
      };
    });
    return {
      ...raw,
      default_narrator_role_id: raw.default_narrator_role_id ?? null,
      chapters,
    } as SegmentedProject;
  }
  // Legacy v1 format — raw may be missing fields, use loose typing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  const now = new Date().toISOString();
  const ch: Chapter = {
    id: uid(),
    name: _t('segmentedProject.defaultChapterName'),
    voice: r.voice || { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' },
    original_text: r.original_text,
    segments: r.segments || [],
    selected_segment_id: r.selected_segment_id,
    split_config: r.split_config || { delimiters: ['，', '。', '！', '？', '；'], mode: 'rule' },
    created_at: r.created_at || now,
    updated_at: r.updated_at || now,
  };
  return {
    schema_version: 2,
    id: r.id ?? uid(),
    name: r.name || _t('segmentedProject.unnamedProject'),
    chapters: [ch],
    active_chapter_id: ch.id,
    layout: r.layout || 'vertical',
    remotion_project_path: r.remotion_project_path ?? null,
    default_narrator_role_id: r.default_narrator_role_id ?? null,
    created_at: r.created_at || now,
    updated_at: now,
  };
}

function cloneSegments(segs: Segment[]): Segment[] {
  return segs.map(s => ({ ...s }));
}

// ---- Helpers for active chapter ----

function getActiveChapter(p: SegmentedProject): Chapter | undefined {
  return p.chapters.find(c => c.id === p.active_chapter_id) || p.chapters[0];
}

function updateChapter(
  p: SegmentedProject,
  chapterId: string,
  updater: (ch: Chapter) => Chapter,
  opts?: { touch?: boolean },
): SegmentedProject {
  const now = new Date().toISOString();
  return {
    ...p,
    chapters: p.chapters.map(c => c.id === chapterId ? updater(c) : c),
    // touch=false：纯 UI 状态变更（如 GENERATE_START 的 pending 标记）不 bump
    // 项目 updated_at —— 自动保存以 project.updated_at 判脏，此类变更不值得
    // 触发整包 PUT（过期 PUT 会被 SQLite 写锁序列化到合成提交之后落库，覆盖
    // 新音频元数据，曾表现为"合成成功但播放 404"）。
    updated_at: opts?.touch === false ? p.updated_at : now,
  };
}

/** Renumber `position` to match array index for every chapter in the project. */
function renumberChapters(chapters: Chapter[]): Chapter[] {
  return chapters.map((c, i) => ({ ...c, position: i }));
}

function updateActive(p: SegmentedProject, updater: (ch: Chapter) => Chapter): SegmentedProject {
  const ch = getActiveChapter(p);
  if (!ch) return p;
  return updateChapter(p, ch.id, updater);
}

// ---- Actions ----

export type Action =
  | { type: 'LOAD_PROJECT'; project: SegmentedProject }
  | { type: 'RENAME_PROJECT'; name: string }
  | { type: 'SET_PROJECT_META'; meta: { remotion_project_path?: string | null; description?: string | null; export_directory?: string | null; underscore_to_space?: boolean | null; skip_parenthesized?: boolean | null; pronunciation_map?: PronunciationMapEntry[] | null; pronunciation_apply_all?: boolean | null; lowercase_latin?: boolean | null } }
  | { type: 'SET_SOURCE_DOCUMENT'; text: string }
  | { type: 'SET_NARRATION_SCRIPT'; text: string }
  | { type: 'SET_LAYOUT'; layout: 'vertical' | 'horizontal' }
  // Chapter management
  | { type: 'ADD_CHAPTER'; name: string }
  | { type: 'DELETE_CHAPTER'; id: string }
  | { type: 'SELECT_CHAPTER'; id: string }
  | { type: 'RENAME_CHAPTER'; id: string; name: string }
  | { type: 'MOVE_CHAPTER'; id: string; direction: 'up' | 'down' }
  // Per-chapter settings
  | { type: 'SET_DEFAULT_PARAMS'; params: EngineParams }
  // 应用全局音色设置到所有章节（面板“应用”按钮；SET_DEFAULT_PARAMS 仅作用当前章节，供重拆分等场景用）
  | { type: 'SET_ALL_CHAPTERS_PARAMS'; params: EngineParams }
  | { type: 'SET_SPLIT_CONFIG'; config: Chapter['split_config'] }
  // meta 除 original_text/design_title 外还透传面板状态字段（engine/edge_voice/...），运行时会整体并入 chapter
  | { type: 'SET_CHAPTER_META'; meta: Partial<Pick<Chapter, 'original_text' | 'design_title'>> & Record<string, unknown> }
  | { type: 'SET_CHAPTER_META_BY_ID'; id: string; meta: Partial<Pick<Chapter, 'original_text' | 'design_title'>> }
  // Segment operations (on active chapter)
  | { type: 'APPLY_SPLIT'; items: { text: string; emotion?: string; segment_kind?: SegmentKind; role_id?: string | null; role_snapshot?: RoleSnapshot | null; voice_ref?: import('../types').VoiceRef }[] }
  | { type: 'APPEND_SEGMENT'; text?: string; voice_ref?: import('../types').VoiceRef }
  | { type: 'INSERT_SEGMENT'; afterId: string; text?: string; voice_ref?: import('../types').VoiceRef }
  | { type: 'DELETE_SEGMENT'; id: string }
  | { type: 'DELETE_SEGMENTS'; ids: string[] }
  | { type: 'UPDATE_TEXT'; id: string; text: string }
  | { type: 'UPDATE_SSML'; id: string; ssml: string; by_llm?: boolean }
  | { type: 'BATCH_SET_SSML'; updates: { id: string; ssml: string }[]; by_llm?: boolean }
  | { type: 'UPDATE_PARAMS'; id: string; params: Partial<EngineParams>; convertFromRole?: boolean }
  | { type: 'UPDATE_EMOTION'; id: string; emotion: string }
  | { type: 'SET_PROJECT_NARRATOR'; roleId: string | null }
  | { type: 'SET_SEGMENT_ROLE'; id: string; roleId: string | null; roleSnapshot: RoleSnapshot | null }
  | { type: 'SET_SEGMENT_KIND'; id: string; segmentKind: SegmentKind }
  | { type: 'UPDATE_PROSODY_MARKS'; id: string; prosodyMarks: ProsodyMark[] }
  | { type: 'REORDER'; fromIndex: number; toIndex: number }
  | { type: 'MARK_QUEUED'; ids: string[] }
  | { type: 'GENERATE_START'; id: string }
  | { type: 'GENERATE_SUCCESS'; id: string; audio_id?: string; duration_sec?: number; generated_voice_id?: string; updated_params?: Partial<import('../types').EngineParams>; current_audio_path?: string; previous_audio_path?: string; audio_format?: string; generated_params?: Record<string, unknown>; origin?: 'tts' | 'recorded' }
  | { type: 'GENERATE_FAIL'; id: string; error: string }
  | { type: 'UNDO_REGENERATE'; id: string }
  | { type: 'RECORD_SUCCESS'; id: string; audio_id?: string; audio_path?: string; duration_sec?: number; audio_format?: string }
  | { type: 'UNLOCK_SEGMENT_AUDIO'; id: string }
  | { type: 'CLEAR_SEGMENT_AUDIO'; id: string }
  | { type: 'TOGGLE_INDEPENDENT_VOICE'; id: string }
  | { type: 'MERGE_SEGMENTS'; id: string; direction?: 'up' | 'down' }
  | { type: 'SPLIT_SEGMENT'; id: string; position: number }
  | { type: 'SELECT_SEGMENT'; id: string | undefined }
  | { type: 'SET_SEGMENT_TEXT_TRANSFORMS'; id: string; transforms: SegmentTextTransforms | null }
  | { type: 'CLEAR_ROLE_FROM_SEGMENTS'; roleId: string };

export interface State { project: SegmentedProject }

function makeSegment(text: string, _params?: unknown, segmentKind: SegmentKind = 'narration'): Segment {
  const now = new Date().toISOString();
  return {
    id: uid(),
    text,
    voice: { source: 'chapter' },
    status: 'idle',
    audio: { format: 'mp3' },
    segment_kind: segmentKind,
    created_at: now,
    updated_at: now,
  };
}

function updateSegment(
  p: SegmentedProject,
  segmentId: string,
  updater: (segment: Segment) => Segment,
): SegmentedProject {
  return updateActive(p, ch => ({
    ...ch,
    segments: ch.segments.map(segment => {
      return segment.id === segmentId ? updater(segment) : segment;
    }),
    updated_at: new Date().toISOString(),
  }));
}

/**
 * 按 segment id 全局查找所在章节并更新（不局限 active chapter）。
 *
 * 合成/录音/撤销/解锁/清除音频等"音频生命周期"操作可能作用于任意章节
 * （如批量合成、章节面板直接合成非活动章节的 segment）。用 updateActive
 * 会让非活动章节的更新静默丢失：合成的 audio 元数据不进前端 state，随后
 * 整包 PUT 自动保存会用合成前的旧值（无 current.path）覆盖后端 DB 并删除
 * 磁盘音频文件 —— 表现即"合成成功但播放 404"。
 *
 * 找不到 segment 时返回原 project（不 bump updated_at，避免空保存）。
 */
function updateSegmentById(
  p: SegmentedProject,
  segmentId: string,
  updater: (segment: Segment) => Segment,
  opts?: { touch?: boolean },
): SegmentedProject {
  const ch = p.chapters.find(c => c.segments.some(s => s.id === segmentId));
  if (!ch) return p;
  return updateChapter(p, ch.id, ch2 => ({
    ...ch2,
    segments: ch2.segments.map(s => (s.id === segmentId ? updater({ ...s }) : s)),
    updated_at: new Date().toISOString(),
  }), opts);
}

export function segmentedReducer(state: State, action: Action): State {
  const p = state.project;

  switch (action.type) {
    case 'LOAD_PROJECT': {
      const savedLocale = typeof window !== 'undefined' ? localStorage.getItem('narraforge-locale') : null;
      const _t = createTranslator(savedLocale === 'en-US' ? 'en-US' : 'zh-CN');
      const migrated = migrateV1(action.project, _t);
      if (migrated.chapters.length === 0) {
        // Project has no chapters — add a default one
        const ch = makeChapter(_t('segmentedProject.defaultChapterName'));
        migrated.chapters = [ch];
        migrated.active_chapter_id = ch.id;
      }
      return { project: migrated };
    }
    case 'RENAME_PROJECT':
      return { project: { ...p, name: action.name, updated_at: new Date().toISOString() } };
    case 'SET_PROJECT_META': {
      const { remotion_project_path, description, export_directory, underscore_to_space, skip_parenthesized, pronunciation_map, pronunciation_apply_all, lowercase_latin } = action.meta;
      const nextConfigs = { ...(p.configs ?? {}) };
      if ('description' in action.meta) nextConfigs.description = description ?? null;
      if ('export_directory' in action.meta) nextConfigs.export_directory = export_directory ?? null;
      if ('underscore_to_space' in action.meta) nextConfigs.underscore_to_space = underscore_to_space ?? null;
      if ('skip_parenthesized' in action.meta) nextConfigs.skip_parenthesized = skip_parenthesized ?? null;
      if ('pronunciation_map' in action.meta) nextConfigs.pronunciation_map = pronunciation_map ?? null;
      if ('pronunciation_apply_all' in action.meta) nextConfigs.pronunciation_apply_all = pronunciation_apply_all ?? null;
      if ('lowercase_latin' in action.meta) nextConfigs.lowercase_latin = lowercase_latin ?? null;
      const next: SegmentedProject = {
        ...p,
        ...("remotion_project_path" in action.meta ? { remotion_project_path: remotion_project_path ?? null } : {}),
        configs: nextConfigs,
        updated_at: new Date().toISOString(),
      };
      return { project: next };
    }
    case 'SET_SOURCE_DOCUMENT':
      return { project: { ...p, source_document: action.text, updated_at: new Date().toISOString() } };
    case 'SET_NARRATION_SCRIPT':
      return { project: { ...p, narration_script: action.text, updated_at: new Date().toISOString() } };
    case 'SET_LAYOUT':
      return { project: { ...p, layout: action.layout, updated_at: new Date().toISOString() } };

    // ---- Chapter management ----
    case 'ADD_CHAPTER': {
      // New chapter inherits all settings from the currently active chapter
      const activeCh = p.chapters.find(c => c.id === p.active_chapter_id);
      const ch = makeChapter(action.name, activeCh);
      return { project: { ...p, chapters: [...p.chapters, ch], active_chapter_id: ch.id, updated_at: new Date().toISOString() } };
    }
    case 'DELETE_CHAPTER': {
      if (p.chapters.length <= 1) return state; // don't delete last chapter
      const remaining = p.chapters.filter(c => c.id !== action.id);
      const newActive = p.active_chapter_id === action.id ? remaining[0].id : p.active_chapter_id;
      return { project: { ...p, chapters: remaining, active_chapter_id: newActive, updated_at: new Date().toISOString() } };
    }
    case 'SELECT_CHAPTER':
      return { project: { ...p, active_chapter_id: action.id } };
    case 'RENAME_CHAPTER':
      return { project: updateChapter(p, action.id, ch => ({ ...ch, name: action.name, updated_at: new Date().toISOString() })) };
    case 'MOVE_CHAPTER': {
      const idx = p.chapters.findIndex(c => c.id === action.id);
      if (idx < 0) return state;
      const swapWith = action.direction === 'up' ? idx - 1 : idx + 1;
      // Boundary: first chapter can't move up, last can't move down.
      if (swapWith < 0 || swapWith >= p.chapters.length) return state;
      const chapters = p.chapters.map(c => ({ ...c }));
      const tmp = chapters[idx];
      chapters[idx] = chapters[swapWith];
      chapters[swapWith] = tmp;
      return { project: { ...p, chapters: renumberChapters(chapters), updated_at: new Date().toISOString() } };
    }

    // ---- Per-chapter settings ----
    case 'SET_DEFAULT_PARAMS':
      return { project: updateActive(p, ch => ({ ...ch, voice: action.params, updated_at: new Date().toISOString() })) };
    case 'SET_ALL_CHAPTERS_PARAMS': {
      const now = new Date().toISOString();
      return { project: { ...p, chapters: p.chapters.map(c => ({ ...c, voice: action.params, updated_at: now })), updated_at: now } };
    }
    case 'SET_SPLIT_CONFIG':
      return { project: updateActive(p, ch => ({ ...ch, split_config: action.config, updated_at: new Date().toISOString() })) };
    case 'SET_CHAPTER_META':
      return { project: updateActive(p, ch => ({ ...ch, ...action.meta, updated_at: new Date().toISOString() })) };
    case 'SET_CHAPTER_META_BY_ID':
      return { project: updateChapter(p, action.id, ch => ({ ...ch, ...action.meta, updated_at: new Date().toISOString() })) };

    // ---- Segment operations (active chapter) ----
    case 'APPLY_SPLIT': {
      return { project: updateActive(p, ch => {
        const newSegs = action.items.map(item => {
          const seg = makeSegment(item.text, ch.voice, item.segment_kind ?? 'narration');
          if (item.emotion && isEmotionType(item.emotion)) seg.emotion = item.emotion;
          if (item.role_id !== undefined) seg.role_id = item.role_id;
          // Build voice from role_snapshot or voice_ref
          if (item.role_snapshot && item.role_id) {
            seg.voice = { source: 'role', role_id: item.role_id };
          } else if ((item as Record<string, unknown>).voice_ref) {
            const vr = (item as Record<string, unknown>).voice_ref as { source?: string; engine?: string; voice_id?: string } | undefined;
            if (vr?.source === 'role') seg.voice = { source: 'role', role_id: item.role_id || '' };
            else if (vr?.source === 'custom') seg.voice = { source: 'custom', engine: (vr.engine as EngineParams['engine']) || 'edge_tts', params: {} as EngineParams };
            else seg.voice = { source: 'chapter' };
          }
          return seg;
        });
        return { ...ch, segments: newSegs, selected_segment_id: undefined, updated_at: new Date().toISOString() };
      })};
    }
    case 'APPEND_SEGMENT': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = makeSegment(action.text ?? '', ch.voice);
        s.push(seg);
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'INSERT_SEGMENT': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const idx = s.findIndex(x => x.id === action.afterId);
        if (idx >= 0) {
          const seg = makeSegment(action.text ?? '', ch.voice);
          s.splice(idx + 1, 0, seg);
        }
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'DELETE_SEGMENT': {
      return { project: updateActive(p, ch => {
        const s = ch.segments.filter(x => x.id !== action.id);
        return { ...ch, segments: s, selected_segment_id: ch.selected_segment_id === action.id ? undefined : ch.selected_segment_id, updated_at: new Date().toISOString() };
      })};
    }
    case 'DELETE_SEGMENTS': {
      return { project: updateActive(p, ch => {
        const ids = new Set(action.ids);
        const s = ch.segments.filter(x => !ids.has(x.id));
        return { ...ch, segments: s, selected_segment_id: ch.selected_segment_id && ids.has(ch.selected_segment_id) ? undefined : ch.selected_segment_id, updated_at: new Date().toISOString() };
      })};
    }
    case 'UPDATE_TEXT': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg) { seg.text = action.text; seg.updated_at = new Date().toISOString(); }
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'UPDATE_SSML': {
      // SSML is no longer stored on Segment in V3
      return state;
    }
    case 'BATCH_SET_SSML': {
      // SSML is no longer stored on Segment in V3
      return state;
    }
    case 'UPDATE_PARAMS': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg) {
          if (action.convertFromRole) {
            // Caller resolved effective params → convert to custom with full params (replace, don't merge)
            const p = action.params as unknown as Record<string, unknown>;
            const engine = (p.engine as string) || 'edge_tts';
            seg.voice = { source: 'custom', engine: engine as 'edge_tts', params: p, role_id: seg.role_id || undefined } as unknown as Segment['voice'];
          } else if (seg.voice.source === 'custom') {
            seg.voice.params = { ...seg.voice.params, ...action.params as unknown as Record<string, unknown> };
          } else {
            // Fallback: create empty custom (will be incomplete — caller should use convertFromRole)
            // Partial<EngineParams> 直接断言为 EngineParams：原有运行时装箱行为不变
            seg.voice = { source: 'custom', engine: 'edge_tts', params: action.params as EngineParams };
          }
          seg.updated_at = new Date().toISOString();
        }
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'UPDATE_EMOTION': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg && isEmotionType(action.emotion)) { seg.emotion = action.emotion; seg.updated_at = new Date().toISOString(); }
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'SET_PROJECT_NARRATOR':
      return {
        project: {
          ...p,
          default_narrator_role_id: action.roleId,
          updated_at: new Date().toISOString(),
        },
      };
    case 'SET_SEGMENT_ROLE':
      return {
        project: updateSegment(p, action.id, seg => {
          if (action.roleId && action.roleSnapshot) {
            return {
              ...seg,
              role_id: action.roleId,
              voice: { source: 'role', role_id: action.roleId },
              updated_at: new Date().toISOString(),
            };
          }
          // Clearing role: go back to chapter defaults
          return {
            ...seg,
            role_id: null,
            voice: { source: 'chapter' },
            updated_at: new Date().toISOString(),
          };
        }),
      };
    case 'SET_SEGMENT_KIND':
      return {
        project: updateSegment(p, action.id, seg => ({
          ...seg,
          segment_kind: action.segmentKind,
          updated_at: new Date().toISOString(),
        })),
      };
    case 'UPDATE_PROSODY_MARKS':
      return {
        project: updateSegment(p, action.id, seg => ({
          ...seg,
          prosody_marks: action.prosodyMarks.map(mark => ({ ...mark, style_tags: [...mark.style_tags] })),
          updated_at: new Date().toISOString(),
        })),
      };
    case 'REORDER': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const [removed] = s.splice(action.fromIndex, 1);
        s.splice(action.toIndex, 0, removed);
        // Renumber positions to match the new array order. The backend trusts
        // `position` on save (falls back to array index only when null), so
        // stale positions would silently revert the reorder.
        const renumbered = s.map((seg, i) => ({ ...seg, position: i }));
        return { ...ch, segments: renumbered, updated_at: new Date().toISOString() };
      })};
    }
    case 'MARK_QUEUED': {
      // 批量合成可能覆盖多个章节（"合成未合成"遍历全项目），
      // 按 id 全局标记，避免非活动章节的 segment 丢失 queued 状态。
      const ids = new Set(action.ids);
      let touched = false;
      const chapters = p.chapters.map(ch => {
        let chChanged = false;
        const segs = ch.segments.map(seg => {
          if (ids.has(seg.id) && seg.status === 'idle') {
            touched = true;
            chChanged = true;
            return { ...seg, status: 'queued' as const };
          }
          return seg;
        });
        return chChanged ? { ...ch, segments: segs } : ch;
      });
      return { project: touched ? { ...p, chapters, updated_at: new Date().toISOString() } : p };
    }
    case 'GENERATE_START': {
      // pending 是纯 UI 状态（后端不存 status）：不 bump 项目 updated_at，
      // 避免触发无意义的自动保存 PUT（见 updateChapter 的 touch 说明）
      return { project: updateSegmentById(p, action.id, seg => {
        seg.status = 'pending';
        seg.error = undefined;
        return seg;
      }, { touch: false })};
    }
    case 'GENERATE_SUCCESS': {
      return { project: updateSegmentById(p, action.id, seg => {
        // Frontend mode: audio stored in IndexedDB via audio_id
        if (action.audio_id) {
          seg.audio.previous = seg.audio.current ? { ...seg.audio.current } : undefined;
          seg.audio.current = {
            id: action.audio_id,
            ...(action.origin ? { origin: action.origin } : {}),
            ...(action.duration_sec != null ? { duration_sec: action.duration_sec } : {}),
          };
        }
        // Backend mode: audio stored on filesystem via audio_path
        if (action.current_audio_path !== undefined) {
          seg.audio.previous = seg.audio.current ? { ...seg.audio.current } : undefined;
          seg.audio.current = {
            path: action.current_audio_path,
            ...(action.origin ? { origin: action.origin } : {}),
            ...(action.duration_sec != null ? { duration_sec: action.duration_sec } : {}),
          };
        }
        if (action.previous_audio_path !== undefined) {
          // previous 即旧的 current（force 重合成时被降级的录音），origin 随之一并保留
          seg.audio.previous = {
            path: action.previous_audio_path,
            ...(seg.audio.previous?.origin ? { origin: seg.audio.previous.origin } : {}),
          };
        }
        if (action.audio_format) seg.audio.format = action.audio_format;
        seg.audio.duration_sec = action.duration_sec ?? seg.audio.duration_sec;
        seg.status = 'ready';
        seg.error = undefined;
        seg.updated_at = new Date().toISOString();
        // Update segment voice with actually-used engine/voice
        if (action.updated_params) {
          const p = action.updated_params as Record<string, unknown>;
          if (seg.voice.source === 'custom') {
            seg.voice = { ...seg.voice, params: { ...seg.voice.params, ...p } };
          }
          // role/chapter segments: keep their source; generated_params handles staleness
        }
        if (action.generated_params) {
          seg.generated_params = action.generated_params as Partial<EngineParams>;
        }
        return seg;
      })};
    }
    case 'GENERATE_FAIL': {
      return { project: updateSegmentById(p, action.id, seg => {
        seg.status = 'failed';
        seg.error = action.error;
        return seg;
      })};
    }
    case 'UNDO_REGENERATE': {
      return { project: updateSegmentById(p, action.id, seg => {
        // Swap current/previous audio
        if (seg.audio.previous) {
          const tmp = seg.audio.current;
          seg.audio.current = seg.audio.previous;
          seg.audio.previous = tmp;
        }
        // Keep top-level duration in sync with the restored current entry
        // (enrichSegment treats audio.current.duration_sec as authoritative).
        seg.audio.duration_sec = seg.audio.current?.duration_sec;
        seg.updated_at = new Date().toISOString();
        return seg;
      })};
    }
    case 'RECORD_SUCCESS': {
      // 用户自录入音频（录音/上传）落库成功 —— 与 GENERATE_SUCCESS 同构，
      // 但 audio.current.origin 标记为 'recorded'（锁定该片段，跳过 TTS）
      return { project: updateSegmentById(p, action.id, seg => {
        const entry: NonNullable<Segment['audio']['current']> = { origin: 'recorded' };
        if (action.audio_id) entry.id = action.audio_id;
        if (action.audio_path) entry.path = action.audio_path;
        if (action.duration_sec != null) entry.duration_sec = action.duration_sec;
        seg.audio.previous = seg.audio.current ? { ...seg.audio.current } : undefined;
        seg.audio.current = entry;
        if (action.audio_format) seg.audio.format = action.audio_format;
        seg.audio.duration_sec = action.duration_sec ?? seg.audio.duration_sec;
        seg.status = 'ready';
        seg.error = undefined;
        seg.updated_at = new Date().toISOString();
        return seg;
      })};
    }
    case 'UNLOCK_SEGMENT_AUDIO': {
      // 解锁 = 清除 audio.current 的 origin 标记，之后可重新合成（force）
      return { project: updateSegmentById(p, action.id, seg => {
        if (seg.audio.current?.origin) {
          seg.audio.current = { ...seg.audio.current, origin: undefined };
          seg.updated_at = new Date().toISOString();
        }
        return seg;
      })};
    }
    case 'CLEAR_SEGMENT_AUDIO': {
      return { project: updateSegmentById(p, action.id, seg => {
        seg.audio.previous = seg.audio.current ? { ...seg.audio.current } : undefined;
        seg.audio.current = undefined;
        seg.audio.duration_sec = undefined;
        seg.status = 'idle';
        return seg;
      })};
    }
    case 'TOGGLE_INDEPENDENT_VOICE': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg) {
          if (seg.voice.source === 'custom') {
            // Remove custom voice → follow chapter (or restore role if assigned)
            seg.voice = seg.role_id ? { source: 'role' as const, role_id: seg.role_id } : { source: 'chapter' as const };
          } else {
            // Enable independent voice: copy current effective params to custom source
            // Source was 'chapter' or 'role' → now 'custom'
            // 空 params 原为裸 {}，断言为 EngineParams 仅为过类型检查，运行时不变
            seg.voice = { source: 'custom' as const, engine: 'edge_tts', params: {} as EngineParams };
          }
          seg.updated_at = new Date().toISOString();
        }
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'MERGE_SEGMENTS': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const direction = action.direction ?? 'down';
        const srcIdx = s.findIndex(x => x.id === action.id);
        if (srcIdx < 0) return ch;
        // Normalize to "keep prev segment, merge next" by adjusting the target index
        const keepIdx = direction === 'down' ? srcIdx : srcIdx - 1;
        if (keepIdx < 0 || keepIdx >= s.length - 1) return ch;
        const cur = s[keepIdx];
        const nxt = s[keepIdx + 1];
        // Never merge a segment with in-flight synthesis — the late GENERATE_SUCCESS
        // would attach audio generated from the OLD text to the merged NEW text.
        if (cur.status === 'pending' || cur.status === 'queued' ||
            nxt.status === 'pending' || nxt.status === 'queued') return ch;
        // Merge text (no space — Chinese doesn't need it)
        cur.text = cur.text + nxt.text;
        // Clear audio since text changed (also drop stale params snapshot / deprecated fields)
        cur.audio = { format: 'mp3' };
        cur.status = 'idle';
        cur.error = undefined;
        cur.generated_params = undefined;
        cur.duration_sec = undefined;
        cur.current_audio_id = undefined;
        cur.current_audio_path = undefined;
        cur.previous_audio_id = undefined;
        cur.previous_audio_path = undefined;
        cur.generated_voice_id = undefined;
        cur.updated_at = new Date().toISOString();
        // Remove next segment
        s.splice(keepIdx + 1, 1);
        // If selected segment was removed, select the kept one
        const sel = ch.selected_segment_id === nxt.id ? cur.id : ch.selected_segment_id;
        return { ...ch, segments: s, selected_segment_id: sel, updated_at: new Date().toISOString() };
      })};
    }
    case 'SPLIT_SEGMENT': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const idx = s.findIndex(x => x.id === action.id);
        if (idx < 0) return ch;
        const seg = s[idx];
        const pos = Math.max(0, Math.min(action.position, seg.text.length));
        if (pos === 0 || pos === seg.text.length) return ch;
        const textBefore = seg.text.slice(0, pos);
        const textAfter = seg.text.slice(pos);
        // Update current segment with first half
        seg.text = textBefore;
        seg.audio = { format: 'mp3' };
        seg.status = 'idle';
        seg.error = undefined;
        seg.updated_at = new Date().toISOString();
        // Create new segment for second half
        const newSeg = makeSegment(textAfter, {} as EngineParams);
        if (seg.emotion) newSeg.emotion = seg.emotion;
        // Inherit voice
        newSeg.voice = { ...seg.voice };
        s.splice(idx + 1, 0, newSeg);
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'SELECT_SEGMENT': {
      const activeCh = getActiveChapter(p);
      if (!activeCh) return { project: p };
      return {
        project: {
          ...p,
          chapters: p.chapters.map(c => c.id === activeCh.id ? { ...c, selected_segment_id: action.id } : c),
        },
      };
    }
    case 'CLEAR_ROLE_FROM_SEGMENTS': {
      const now = new Date().toISOString();
      return {
        project: {
          ...p,
          chapters: p.chapters.map(ch => ({
            ...ch,
            segments: ch.segments.map(seg =>
              seg.role_id === action.roleId
                ? { ...seg, role_id: null, voice: { source: 'chapter' as const }, updated_at: now }
                : seg
            ),
            updated_at: now,
          })),
          updated_at: now,
        },
      };
    }
    case 'SET_SEGMENT_TEXT_TRANSFORMS': {
      // 跨章节按 id 更新（搜索/映射面板可作用于非活动章节的段）；
      // updateSegmentById 找不到时原样返回（不 bump updated_at，不触发空保存）
      return { project: updateSegmentById(p, action.id, seg => ({
        ...seg,
        text_transforms: action.transforms ?? undefined,
        updated_at: new Date().toISOString(),
      })) };
    }
    default:
      return state;
  }
}

// -----------------------------------------------------------------------
// Hook wrapper
// -----------------------------------------------------------------------
import { useReducer, useEffect } from 'react';
import { segmentedProjectDB } from '../services/segmentedProjectDB';

export { getActiveChapter };

export function useSegmentedProject(projectId: string | null = null) {
  const [state, dispatch] = useReducer(
    segmentedReducer,
    { project: createInitialProject() },
  );

  useEffect(() => {
    if (projectId) {
      segmentedProjectDB.getProject(projectId).then((p) => {
        if (p) dispatch({ type: 'LOAD_PROJECT', project: p });
      }).catch(e => console.warn('Load project failed:', e));
    }
  }, [projectId]);

  return [state, dispatch] as const;
}
