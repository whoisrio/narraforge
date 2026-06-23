import type { SegmentedProject, Chapter, Segment, SegmentEngineParams, ProsodyMark, RoleSnapshot, SegmentKind } from '../types';

let _idCounter = 0;
function uid(): string {
  _idCounter++;
  return `${Date.now()}-${_idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeChapter(name: string, inheritFrom?: Chapter): Chapter {
  const now = new Date().toISOString();
  const defaultParams = inheritFrom?.default_params || { engine: 'edge_tts' };
  return {
    id: uid(),
    name,
    engine: defaultParams.engine,
    voice_id: defaultParams.voice_id,
    edge_voice: defaultParams.edge_voice,
    edge_rate: typeof defaultParams.edge_rate === 'string' ? parseFloat(defaultParams.edge_rate) : defaultParams.edge_rate ?? 0,
    edge_volume: typeof defaultParams.edge_volume === 'string' ? parseFloat(defaultParams.edge_volume) : defaultParams.edge_volume ?? 0,
    mimo_mode: defaultParams.mimo_mode,
    mimo_preset_voice: defaultParams.mimo_preset_voice,
    mimo_instruction: defaultParams.mimo_instruction,
    mimo_clone_voice_id: defaultParams.mimo_clone_voice_id,
    voxcpm_mode: defaultParams.voxcpm_mode,
    voxcpm_voice_description: defaultParams.voxcpm_voice_description,
    voxcpm_style_control: defaultParams.voxcpm_style_control,
    voxcpm_prompt_text: defaultParams.voxcpm_prompt_text,
    voxcpm_cfg_value: defaultParams.voxcpm_cfg_value,
    voxcpm_inference_timesteps: defaultParams.voxcpm_inference_timesteps,
    language: defaultParams.language,
    speed: defaultParams.speed,
    volume: defaultParams.volume,
    pitch: defaultParams.pitch,
    segments: [],
    default_params: defaultParams as SegmentEngineParams,
    split_config: inheritFrom?.split_config || { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
    panel_open: inheritFrom?.panel_open ?? true,
    created_at: now,
    updated_at: now,
  };
}

export function createInitialProject(): SegmentedProject {
  const now = new Date().toISOString();
  const ch = makeChapter('第一章');
  return {
    schema_version: 2,
    id: uid(),
    name: '新项目',
    chapters: [ch],
    active_chapter_id: ch.id,
    layout: 'vertical',
    remotion_project_path: null,
    created_at: now,
    updated_at: now,
  };
}

/** Migrate v1 project (no chapters) to v2 */
/** Enrich a raw backend project/chapter/segment object with missing frontend-only fields. */
function enrichSegment(raw: any, defaultParams: SegmentEngineParams): Segment {
  const now = new Date().toISOString();
  const hasAudio = !!(raw.current_audio_path || raw.current_audio_id);
  return {
    id: raw.id,
    text: raw.text ?? '',
    ssml: raw.ssml,
    params: { ...defaultParams, ...raw.params },
    status: raw.status ?? (hasAudio ? 'ready' : 'idle'),
    error: raw.error,
    current_audio_id: raw.current_audio_id,
    previous_audio_id: raw.previous_audio_id,
    current_audio_path: raw.current_audio_path,
    previous_audio_path: raw.previous_audio_path,
    audio_format: raw.audio_format ?? 'mp3',
    generated_params: raw.generated_params,
    duration_sec: raw.duration_sec,
    ssml_annotated_by_llm: raw.ssml_annotated_by_llm,
    emotion: raw.emotion,
    overrides: raw.overrides ?? raw.locked_params?.map((k: string) => k) ?? [],
    generated_voice_id: raw.generated_voice_id,
    role_id: raw.role_id ?? null,
    role_snapshot: raw.role_snapshot ?? null,
    segment_kind: raw.segment_kind ?? 'narration',
    prosody_marks: raw.prosody_marks ?? [],
    created_at: raw.created_at || now,
    updated_at: raw.updated_at || now,
  };
}

export function migrateV1(raw: any): SegmentedProject {
  if (raw.schema_version === 2 && raw.chapters) {
    // Enrich segments with frontend-only fields that the backend doesn't return
    const chapters: Chapter[] = raw.chapters.map((ch: any) => {
      const defaultParams = ch.default_params || { engine: 'edge_tts' } as SegmentEngineParams;
      return {
        ...ch,
        default_params: defaultParams,
        split_config: ch.split_config || { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
        design_title: ch.design_title ?? ch.name,
        segments: (ch.segments || []).map((s: any) => enrichSegment(s, defaultParams)),
      };
    });
    return {
      ...raw,
      default_narrator_role_id: raw.default_narrator_role_id ?? null,
      default_narrator_snapshot: raw.default_narrator_snapshot ?? null,
      chapters,
    } as SegmentedProject;
  }
  const now = new Date().toISOString();
  const ch: Chapter = {
    id: uid(),
    name: '第一章',
    engine: raw.engine,
    voice_id: raw.voice_id,
    edge_voice: raw.edge_voice,
    edge_rate: raw.edge_rate,
    edge_volume: raw.edge_volume,
    mimo_mode: raw.mimo_mode,
    mimo_preset_voice: raw.mimo_preset_voice,
    mimo_instruction: raw.mimo_instruction,
    mimo_clone_voice_id: raw.mimo_clone_voice_id,
    voxcpm_mode: raw.voxcpm_mode,
    voxcpm_voice_description: raw.voxcpm_voice_description,
    voxcpm_style_control: raw.voxcpm_style_control,
    voxcpm_prompt_text: raw.voxcpm_prompt_text,
    voxcpm_cfg_value: raw.voxcpm_cfg_value,
    voxcpm_inference_timesteps: raw.voxcpm_inference_timesteps,
    language: raw.language,
    speed: raw.speed,
    volume: raw.volume,
    pitch: raw.pitch,
    original_text: raw.original_text,
    segments: raw.segments || [],
    selected_segment_id: raw.selected_segment_id,
    default_params: raw.default_params || { engine: 'edge_tts' } as SegmentEngineParams,
    split_config: raw.split_config || { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
    created_at: raw.created_at || now,
    updated_at: raw.updated_at || now,
  };
  return {
    schema_version: 2,
    id: raw.id,
    name: raw.name || '未命名项目',
    chapters: [ch],
    active_chapter_id: ch.id,
    layout: raw.layout || 'vertical',
    remotion_project_path: raw.remotion_project_path ?? null,
    default_narrator_role_id: raw.default_narrator_role_id ?? null,
    default_narrator_snapshot: raw.default_narrator_snapshot ?? null,
    created_at: raw.created_at || now,
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
  | { type: 'SET_PROJECT_META'; meta: Partial<Pick<SegmentedProject, 'remotion_project_path' | 'description' | 'project_type' | 'default_language' | 'export_directory' | 'export_naming_template'>> }
  | { type: 'SET_LAYOUT'; layout: 'vertical' | 'horizontal' }
  // Chapter management
  | { type: 'ADD_CHAPTER'; name: string }
  | { type: 'DELETE_CHAPTER'; id: string }
  | { type: 'SELECT_CHAPTER'; id: string }
  | { type: 'RENAME_CHAPTER'; id: string; name: string }
  // Per-chapter settings
  | { type: 'SET_DEFAULT_PARAMS'; params: SegmentEngineParams }
  | { type: 'SET_SPLIT_CONFIG'; config: Chapter['split_config'] }
  | { type: 'SET_CHAPTER_META'; meta: Partial<Pick<Chapter, 'original_text' | 'design_title' | 'engine' | 'voice_id' | 'edge_voice' | 'edge_rate' | 'edge_volume' | 'mimo_mode' | 'mimo_preset_voice' | 'mimo_instruction' | 'mimo_clone_voice_id' | 'voxcpm_mode' | 'voxcpm_voice_description' | 'voxcpm_style_control' | 'voxcpm_prompt_text' | 'voxcpm_cfg_value' | 'voxcpm_inference_timesteps' | 'language' | 'speed' | 'volume' | 'pitch' | 'panel_open'>> }
  | { type: 'SET_CHAPTER_META_BY_ID'; id: string; meta: Partial<Pick<Chapter, 'original_text' | 'design_title' | 'engine' | 'voice_id' | 'edge_voice' | 'edge_rate' | 'edge_volume' | 'mimo_mode' | 'mimo_preset_voice' | 'mimo_instruction' | 'mimo_clone_voice_id' | 'voxcpm_mode' | 'voxcpm_voice_description' | 'voxcpm_style_control' | 'voxcpm_prompt_text' | 'voxcpm_cfg_value' | 'voxcpm_inference_timesteps' | 'language' | 'speed' | 'volume' | 'pitch' | 'panel_open'>> }
  // Segment operations (on active chapter)
  | { type: 'APPLY_SPLIT'; items: { text: string; emotion?: string; segment_kind?: SegmentKind; role_id?: string | null; role_snapshot?: RoleSnapshot | null }[] }
  | { type: 'APPEND_SEGMENT'; text?: string }
  | { type: 'INSERT_SEGMENT'; afterId: string; text?: string }
  | { type: 'DELETE_SEGMENT'; id: string }
  | { type: 'UPDATE_TEXT'; id: string; text: string }
  | { type: 'UPDATE_SSML'; id: string; ssml: string; by_llm?: boolean }
  | { type: 'BATCH_SET_SSML'; updates: { id: string; ssml: string }[]; by_llm?: boolean }
  | { type: 'UPDATE_PARAMS'; id: string; params: Partial<SegmentEngineParams> }
  | { type: 'UPDATE_EMOTION'; id: string; emotion: string }
  | { type: 'SET_PROJECT_NARRATOR'; roleId: string | null; roleSnapshot: RoleSnapshot | null }
  | { type: 'SET_SEGMENT_ROLE'; id: string; roleId: string | null; roleSnapshot: RoleSnapshot | null }
  | { type: 'SET_SEGMENT_KIND'; id: string; segmentKind: SegmentKind }
  | { type: 'UPDATE_PROSODY_MARKS'; id: string; prosodyMarks: ProsodyMark[] }
  | { type: 'REORDER'; fromIndex: number; toIndex: number }
  | { type: 'MARK_QUEUED'; ids: string[] }
  | { type: 'GENERATE_START'; id: string }
  | { type: 'GENERATE_SUCCESS'; id: string; audio_id?: string; duration_sec?: number; generated_voice_id?: string; updated_params?: Partial<import('../types').SegmentEngineParams>; current_audio_path?: string; previous_audio_path?: string; audio_format?: string; generated_params?: Record<string, unknown> }
  | { type: 'GENERATE_FAIL'; id: string; error: string }
  | { type: 'UNDO_REGENERATE'; id: string }
  | { type: 'CLEAR_SEGMENT_AUDIO'; id: string }
  | { type: 'TOGGLE_INDEPENDENT_VOICE'; id: string }
  | { type: 'MERGE_SEGMENTS'; id: string; direction?: 'up' | 'down' }
  | { type: 'SPLIT_SEGMENT'; id: string; position: number }
  | { type: 'SELECT_SEGMENT'; id: string | undefined };

export interface State { project: SegmentedProject }

function makeSegment(text: string, params: SegmentEngineParams, segmentKind: SegmentKind = 'narration'): Segment {
  const now = new Date().toISOString();
  return {
    id: uid(),
    text,
    params: { ...params },
    status: 'idle',
    segment_kind: segmentKind,
    prosody_marks: [],
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
      const normalized: Segment = { ...segment, prosody_marks: segment.prosody_marks ?? [] };
      return segment.id === segmentId ? updater(normalized) : normalized;
    }),
    updated_at: new Date().toISOString(),
  }));
}

export function segmentedReducer(state: State, action: Action): State {
  const p = state.project;

  switch (action.type) {
    case 'LOAD_PROJECT': {
      const migrated = migrateV1(action.project);
      return { project: migrated };
    }
    case 'RENAME_PROJECT':
      return { project: { ...p, name: action.name, updated_at: new Date().toISOString() } };
    case 'SET_PROJECT_META':
      return { project: { ...p, ...action.meta, updated_at: new Date().toISOString() } };
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
      return { project: updateActive(p, ch => ({ ...ch, default_params: action.params, updated_at: new Date().toISOString() })) };
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
          const seg = makeSegment(item.text, ch.default_params, item.segment_kind ?? 'narration');
          if (item.emotion) seg.emotion = item.emotion as any;
          if (item.role_id !== undefined) seg.role_id = item.role_id;
          if (item.role_snapshot !== undefined) seg.role_snapshot = item.role_snapshot;
          return seg;
        });
        return { ...ch, segments: newSegs, selected_segment_id: undefined, updated_at: new Date().toISOString() };
      })};
    }
    case 'APPEND_SEGMENT': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        s.push(makeSegment(action.text ?? '', ch.default_params));
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'INSERT_SEGMENT': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const idx = s.findIndex(x => x.id === action.afterId);
        if (idx >= 0) s.splice(idx + 1, 0, makeSegment(action.text ?? '', ch.default_params));
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
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg) { seg.ssml = action.ssml; if (action.by_llm) seg.ssml_annotated_by_llm = true; seg.updated_at = new Date().toISOString(); }
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'BATCH_SET_SSML': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        for (const u of action.updates) {
          const seg = s.find(x => x.id === u.id);
          if (seg) { seg.ssml = u.ssml; if (action.by_llm) seg.ssml_annotated_by_llm = true; seg.updated_at = new Date().toISOString(); }
        }
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'UPDATE_PARAMS': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg) {
          seg.params = { ...seg.params, ...action.params };
          const overrides = [...(seg.overrides || [])];
          const addOverride = (field: NonNullable<Segment['overrides']>[number]) => {
            if (!overrides.includes(field)) overrides.push(field);
          };
          const removeOverride = (field: NonNullable<Segment['overrides']>[number]) => {
            const idx = overrides.indexOf(field);
            if (idx >= 0) overrides.splice(idx, 1);
          };
          const voiceParam = action.params.voice_id ?? action.params.edge_voice ?? action.params.mimo_preset_voice ?? action.params.mimo_clone_voice_id;
          if (voiceParam !== undefined) {
            if (voiceParam) addOverride('voice');
            else removeOverride('voice');
          }
          if (action.params.speed !== undefined) addOverride('speed');
          if (action.params.volume !== undefined) addOverride('volume');
          if (action.params.pitch !== undefined) addOverride('pitch');
          const instructionParam = action.params.instruction ?? action.params.mimo_instruction ?? action.params.voxcpm_style_control;
          if (instructionParam !== undefined) {
            if (instructionParam) addOverride('instruction');
            else removeOverride('instruction');
          }
          if (action.params.language !== undefined) addOverride('language');
          seg.overrides = overrides;
          seg.updated_at = new Date().toISOString();
        }
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'UPDATE_EMOTION': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg) { seg.emotion = action.emotion as any; seg.updated_at = new Date().toISOString(); }
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'SET_PROJECT_NARRATOR':
      return {
        project: {
          ...p,
          default_narrator_role_id: action.roleId,
          default_narrator_snapshot: action.roleSnapshot,
          updated_at: new Date().toISOString(),
        },
      };
    case 'SET_SEGMENT_ROLE':
      return {
        project: updateSegment(p, action.id, seg => ({
          ...seg,
          role_id: action.roleId,
          role_snapshot: action.roleSnapshot,
          updated_at: new Date().toISOString(),
        })),
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
            seg.previous_audio_id = seg.current_audio_id;
            seg.current_audio_id = action.audio_id;
          }
          // Backend mode: audio stored on filesystem via audio_path
          if (action.current_audio_path !== undefined) {
            seg.previous_audio_path = seg.current_audio_path;
            seg.current_audio_path = action.current_audio_path;
          }
          if (action.previous_audio_path !== undefined) {
            seg.previous_audio_path = action.previous_audio_path;
          }
          if (action.audio_format) seg.audio_format = action.audio_format;
          seg.duration_sec = action.duration_sec ?? seg.duration_sec;
          seg.status = 'ready';
          seg.error = undefined;
          seg.generated_voice_id = action.generated_voice_id;
          seg.updated_at = new Date().toISOString();
          // Update segment params with actually-used engine/voice
          if (action.updated_params) {
            seg.params = { ...seg.params, ...action.updated_params };
          }
          if (action.generated_params) {
            seg.generated_params = action.generated_params;
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
        // Frontend mode: swap IndexedDB audio_id
        if (seg.previous_audio_id) { const tmp = seg.current_audio_id; seg.current_audio_id = seg.previous_audio_id; seg.previous_audio_id = tmp; }
        // Backend mode: swap filesystem audio_path
        if (seg.previous_audio_path) { const tmp = seg.current_audio_path; seg.current_audio_path = seg.previous_audio_path; seg.previous_audio_path = tmp; }
        seg.updated_at = new Date().toISOString();
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'CLEAR_SEGMENT_AUDIO': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg) {
          seg.previous_audio_id = seg.current_audio_id; seg.current_audio_id = undefined;
          seg.previous_audio_path = seg.current_audio_path; seg.current_audio_path = undefined;
          seg.duration_sec = undefined; seg.status = 'idle'; seg.generated_voice_id = undefined;
        }
        return { ...ch, segments: s };
      })};
    }
    case 'TOGGLE_INDEPENDENT_VOICE': {
      return { project: updateActive(p, ch => {
        const s = cloneSegments(ch.segments);
        const seg = s.find(x => x.id === action.id);
        if (seg) {
          const overrides = [...(seg.overrides || [])];
          const idx = overrides.indexOf('voice');
          if (idx >= 0) {
            overrides.splice(idx, 1); // remove voice override → follow global
          } else {
            overrides.push('voice'); // add voice override → independent
          }
          seg.overrides = overrides;
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
        cur.ssml = undefined;
        cur.ssml_annotated_by_llm = undefined;
        // Clear audio since text changed
        cur.current_audio_id = undefined;
        cur.previous_audio_id = undefined;
        cur.duration_sec = undefined;
        cur.generated_voice_id = undefined;
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
        seg.ssml = undefined;
        seg.ssml_annotated_by_llm = undefined;
        seg.current_audio_id = undefined;
        seg.previous_audio_id = undefined;
        seg.duration_sec = undefined;
        seg.generated_voice_id = undefined;
        seg.status = 'idle';
        seg.error = undefined;
        seg.updated_at = new Date().toISOString();
        // Create new segment for second half
        const newSeg = makeSegment(textAfter, seg.params);
        if (seg.emotion) newSeg.emotion = seg.emotion;
        if (seg.overrides) newSeg.overrides = [...seg.overrides];
        s.splice(idx + 1, 0, newSeg);
        return { ...ch, segments: s, updated_at: new Date().toISOString() };
      })};
    }
    case 'SELECT_SEGMENT': {
      return { project: updateActive(p, ch => ({ ...ch, selected_segment_id: action.id })) };
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
