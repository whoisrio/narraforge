import type { SegmentedProject, Chapter, Segment, EngineParams, SegmentKind, EmotionType, VoiceSource, RoleSnapshot, ProsodyMark } from '../types';
import { t } from '../i18n';

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
    split_config: inheritFrom?.split_config || { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
    created_at: now,
    updated_at: now,
  };
}

export function createInitialProject(): SegmentedProject {
  const now = new Date().toISOString();
  const ch = makeChapter(t('segmentedProject.defaultChapterName'));
  return {
    schema_version: 2,
    id: uid(),
    name: t('segmentedProject.newProject'),
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
  const rawAudio = (raw as Record<string, unknown>).audio as Record<string, unknown> | undefined;
  const hasAudio = !!(rawAudio?.current || rawAudio?.previous);
  const voice: VoiceSource = ((raw as Record<string, unknown>).voice as VoiceSource) ?? { source: 'chapter' } as VoiceSource;
  const audio: Segment['audio'] = (rawAudio as Segment['audio']) ?? { format: 'mp3' };
  // Backend returns duration_sec under audio.current — lift to audio.duration_sec for frontend consistency
  if (!audio.duration_sec && audio.current?.duration_sec) {
    audio.duration_sec = audio.current.duration_sec;
  }
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
    created_at: raw.created_at || now,
    updated_at: raw.updated_at || now,
  };
  return base;
}

export function migrateV1(raw: RawSegmentedProject): SegmentedProject {
  if (raw.schema_version === 2 && raw.chapters) {
    // Enrich segments with frontend-only fields that the backend doesn't return
    const chapters: Chapter[] = raw.chapters.map((ch) => {
      const voice = ch.voice || { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' };
      return {
        ...ch,
        voice: voice,
        split_config: ch.split_config || { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
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
    name: t('segmentedProject.defaultChapterName'),
    voice: r.voice || { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' },
    original_text: r.original_text,
    segments: r.segments || [],
    selected_segment_id: r.selected_segment_id,
    split_config: r.split_config || { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
    created_at: r.created_at || now,
    updated_at: r.updated_at || now,
  };
  return {
    schema_version: 2,
    id: r.id ?? uid(),
    name: r.name || t('segmentedProject.unnamedProject'),
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

function updateChapter(p: SegmentedProject, chapterId: string, updater: (ch: Chapter) => Chapter): SegmentedProject {
  const now = new Date().toISOString();
  return {
    ...p,
    chapters: p.chapters.map(c => c.id === chapterId ? updater(c) : c),
    updated_at: now,
  };
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
  | { type: 'SET_PROJECT_META'; meta: Partial<Pick<SegmentedProject, 'remotion_project_path' | 'description' | 'export_directory'>> }
  | { type: 'SET_SOURCE_DOCUMENT'; text: string }
  | { type: 'SET_LAYOUT'; layout: 'vertical' | 'horizontal' }
  // Chapter management
  | { type: 'ADD_CHAPTER'; name: string }
  | { type: 'DELETE_CHAPTER'; id: string }
  | { type: 'SELECT_CHAPTER'; id: string }
  | { type: 'RENAME_CHAPTER'; id: string; name: string }
  // Per-chapter settings
  | { type: 'SET_DEFAULT_PARAMS'; params: EngineParams }
  | { type: 'SET_SPLIT_CONFIG'; config: Chapter['split_config'] }
  | { type: 'SET_CHAPTER_META'; meta: Partial<Pick<Chapter, 'original_text' | 'design_title'>> }
  | { type: 'SET_CHAPTER_META_BY_ID'; id: string; meta: Partial<Pick<Chapter, 'original_text' | 'design_title'>> }
  // Segment operations (on active chapter)
  | { type: 'APPLY_SPLIT'; items: { text: string; emotion?: string; segment_kind?: SegmentKind; role_id?: string | null; role_snapshot?: RoleSnapshot | null; voice_ref?: import('../types').VoiceRef }[] }
  | { type: 'APPEND_SEGMENT'; text?: string; voice_ref?: import('../types').VoiceRef }
  | { type: 'INSERT_SEGMENT'; afterId: string; text?: string; voice_ref?: import('../types').VoiceRef }
  | { type: 'DELETE_SEGMENT'; id: string }
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
  | { type: 'GENERATE_SUCCESS'; id: string; audio_id?: string; duration_sec?: number; generated_voice_id?: string; updated_params?: Partial<import('../types').EngineParams>; current_audio_path?: string; previous_audio_path?: string; audio_format?: string; generated_params?: Record<string, unknown> }
  | { type: 'GENERATE_FAIL'; id: string; error: string }
  | { type: 'UNDO_REGENERATE'; id: string }
  | { type: 'CLEAR_SEGMENT_AUDIO'; id: string }
  | { type: 'TOGGLE_INDEPENDENT_VOICE'; id: string }
  | { type: 'MERGE_SEGMENTS'; id: string; direction?: 'up' | 'down' }
  | { type: 'SPLIT_SEGMENT'; id: string; position: number }
  | { type: 'SELECT_SEGMENT'; id: string | undefined }
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

export function segmentedReducer(state: State, action: Action): State {
  const p = state.project;

  switch (action.type) {
    case 'LOAD_PROJECT': {
      const migrated = migrateV1(action.project);
      if (migrated.chapters.length === 0) {
        // Project has no chapters — add a default one
        const ch = makeChapter(t('segmentedProject.defaultChapterName'));
        migrated.chapters = [ch];
        migrated.active_chapter_id = ch.id;
      }
      return { project: migrated };
    }
    case 'RENAME_PROJECT':
      return { project: { ...p, name: action.name, updated_at: new Date().toISOString() } };
    case 'SET_PROJECT_META':
      return { project: { ...p, ...action.meta, updated_at: new Date().toISOString() } };
    case 'SET_SOURCE_DOCUMENT':
      return { project: { ...p, source_document: action.text, updated_at: new Date().toISOString() } };
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

    // ---- Per-chapter settings ----
    case 'SET_DEFAULT_PARAMS':
      return { project: updateActive(p, ch => ({ ...ch, voice: action.params, updated_at: new Date().toISOString() })) };
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
            else if (vr?.source === 'custom') seg.voice = { source: 'custom', engine: (vr.engine as EngineParams['engine']) || 'edge_tts', params: {} };
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
            seg.voice = { source: 'custom', engine: engine as 'edge_tts', params: p, role_id: seg.role_id || undefined } as Segment['voice'];
          } else if (seg.voice.source === 'custom') {
            seg.voice.params = { ...seg.voice.params, ...action.params as unknown as Record<string, unknown> };
          } else {
            // Fallback: create empty custom (will be incomplete — caller should use convertFromRole)
            seg.voice = { source: 'custom', engine: 'edge_tts', params: action.params as unknown as Record<string, unknown> };
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
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'MARK_QUEUED': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        for (const id of action.ids) { const seg = s.find(x => x.id === id); if (seg && seg.status === 'idle') seg.status = 'queued'; }
        return { ...ch, segments: s };
      })};
    }
    case 'GENERATE_START': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg) { seg.status = 'pending'; seg.error = undefined; }
        return { ...ch, segments: s };
      })};
    }
    case 'GENERATE_SUCCESS': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg) {
          // Frontend mode: audio stored in IndexedDB via audio_id
          if (action.audio_id) {
            seg.audio.previous = seg.audio.current ? { ...seg.audio.current } : undefined;
            seg.audio.current = { id: action.audio_id };
          }
          // Backend mode: audio stored on filesystem via audio_path
          if (action.current_audio_path !== undefined) {
            seg.audio.previous = seg.audio.current ? { ...seg.audio.current } : undefined;
            seg.audio.current = {
              path: action.current_audio_path,
              ...(action.duration_sec != null ? { duration_sec: action.duration_sec } : {}),
            };
          }
          if (action.previous_audio_path !== undefined) {
            seg.audio.previous = { path: action.previous_audio_path };
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
        }
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'GENERATE_FAIL': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg) { seg.status = 'failed'; seg.error = action.error; }
        return { ...ch, segments: s };
      })};
    }
    case 'UNDO_REGENERATE': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (!seg) return ch;
        // Swap current/previous audio
        if (seg.audio.previous) {
          const tmp = seg.audio.current;
          seg.audio.current = seg.audio.previous;
          seg.audio.previous = tmp;
        }
        seg.updated_at = new Date().toISOString();
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'CLEAR_SEGMENT_AUDIO': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg) {
          seg.audio.previous = seg.audio.current ? { ...seg.audio.current } : undefined;
          seg.audio.current = undefined;
          seg.audio.duration_sec = undefined;
          seg.status = 'idle';
        }
        return { ...ch, segments: s };
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
            seg.voice = { source: 'custom' as const, engine: 'edge_tts', params: {} as Record<string, unknown> };
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
        // Merge text (no space — Chinese doesn't need it)
        cur.text = cur.text + nxt.text;
        // Clear audio since text changed
        cur.audio = { format: 'mp3' };
        cur.status = 'idle';
        cur.error = undefined;
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
