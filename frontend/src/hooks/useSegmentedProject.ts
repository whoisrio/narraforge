import type { SegmentedProject, Segment, SegmentEngineParams } from '../types';

let _idCounter = 0;
function uid(): string {
  _idCounter++;
  return `${Date.now()}-${_idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createInitialProject(): SegmentedProject {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    id: uid(),
    name: '新项目',
    segments: [],
    selected_segment_id: undefined,
    default_params: { engine: 'cosyvoice' } as SegmentEngineParams,
    split_config: { delimiters: ['，', '。', '！', '？'], mode: 'rule' },
    layout: 'vertical',
    created_at: now,
    updated_at: now,
  };
}

function cloneSegments(segs: Segment[]): Segment[] {
  return segs.map(s => ({ ...s }));
}

export type Action =
  | { type: 'LOAD_PROJECT'; project: SegmentedProject }
  | { type: 'RENAME_PROJECT'; name: string }
  | { type: 'SET_DEFAULT_PARAMS'; params: SegmentEngineParams }
  | { type: 'SET_SPLIT_CONFIG'; config: SegmentedProject['split_config'] }
  | { type: 'SET_LAYOUT'; layout: 'vertical' | 'horizontal' }
  | { type: 'APPLY_SPLIT'; items: { text: string; emotion?: string }[] }
  | { type: 'APPEND_SEGMENT'; text?: string }
  | { type: 'INSERT_SEGMENT'; afterId: string; text?: string }
  | { type: 'DELETE_SEGMENT'; id: string }
  | { type: 'UPDATE_TEXT'; id: string; text: string }
  | { type: 'UPDATE_SSML'; id: string; ssml: string; by_llm?: boolean }
  | { type: 'BATCH_SET_SSML'; updates: { id: string; ssml: string }[]; by_llm?: boolean }
  | { type: 'UPDATE_PARAMS'; id: string; params: Partial<SegmentEngineParams> }
  | { type: 'UPDATE_EMOTION'; id: string; emotion: string }
  | { type: 'REORDER'; fromIndex: number; toIndex: number }
  | { type: 'MARK_QUEUED'; ids: string[] }
  | { type: 'GENERATE_START'; id: string }
  | { type: 'GENERATE_SUCCESS'; id: string; audio_id: string; duration_sec: number; generated_voice_id?: string }
  | { type: 'GENERATE_FAIL'; id: string; error: string }
  | { type: 'UNDO_REGENERATE'; id: string }
  | { type: 'SELECT_SEGMENT'; id: string | undefined };

export interface State { project: SegmentedProject }

function makeSegment(text: string, params: SegmentEngineParams): Segment {
  const now = new Date().toISOString();
  return { id: uid(), text, params: { ...params }, status: 'idle', created_at: now, updated_at: now };
}

export function segmentedReducer(state: State, action: Action): State {
  const p = state.project;
  const segs = () => cloneSegments(p.segments);

  switch (action.type) {
    case 'LOAD_PROJECT':
      return { project: { ...action.project } };
    case 'RENAME_PROJECT':
      return { project: { ...p, name: action.name, updated_at: new Date().toISOString() } };
    case 'SET_DEFAULT_PARAMS':
      return { project: { ...p, default_params: action.params, updated_at: new Date().toISOString() } };
    case 'SET_SPLIT_CONFIG':
      return { project: { ...p, split_config: action.config, updated_at: new Date().toISOString() } };
    case 'SET_LAYOUT':
      return { project: { ...p, layout: action.layout, updated_at: new Date().toISOString() } };
    case 'APPLY_SPLIT': {
      const newSegs = action.items.map(item => {
        const seg = makeSegment(item.text, p.default_params);
        if (item.emotion) seg.emotion = item.emotion as any;
        return seg;
      });
      return { project: { ...p, segments: newSegs, selected_segment_id: undefined, updated_at: new Date().toISOString() } };
    }
    case 'APPEND_SEGMENT': {
      const s = segs();
      s.push(makeSegment(action.text ?? '', p.default_params));
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }
    case 'INSERT_SEGMENT': {
      const s = segs();
      const idx = s.findIndex(x => x.id === action.afterId);
      if (idx >= 0) s.splice(idx + 1, 0, makeSegment(action.text ?? '', p.default_params));
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }
    case 'DELETE_SEGMENT': {
      const s = segs().filter(x => x.id !== action.id);
      return { project: { ...p, segments: s, selected_segment_id: p.selected_segment_id === action.id ? undefined : p.selected_segment_id, updated_at: new Date().toISOString() } };
    }
    case 'UPDATE_TEXT': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) { seg.text = action.text; seg.updated_at = new Date().toISOString(); }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }
    case 'UPDATE_SSML': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) { seg.ssml = action.ssml; if (action.by_llm) seg.ssml_annotated_by_llm = true; seg.updated_at = new Date().toISOString(); }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }
    case 'BATCH_SET_SSML': {
      const s = segs();
      for (const u of action.updates) {
        const seg = s.find(x => x.id === u.id);
        if (seg) { seg.ssml = u.ssml; if (action.by_llm) seg.ssml_annotated_by_llm = true; seg.updated_at = new Date().toISOString(); }
      }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }
    case 'UPDATE_PARAMS': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) { seg.params = { ...seg.params, ...action.params }; seg.updated_at = new Date().toISOString(); }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }
    case 'UPDATE_EMOTION': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) { seg.emotion = action.emotion as any; seg.updated_at = new Date().toISOString(); }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }
    case 'REORDER': {
      const s = segs();
      const [removed] = s.splice(action.fromIndex, 1);
      s.splice(action.toIndex, 0, removed);
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }
    case 'MARK_QUEUED': {
      const s = segs();
      for (const id of action.ids) { const seg = s.find(x => x.id === id); if (seg && seg.status === 'idle') seg.status = 'queued'; }
      return { project: { ...p, segments: s } };
    }
    case 'GENERATE_START': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) { seg.status = 'pending'; seg.error = undefined; }
      return { project: { ...p, segments: s } };
    }
    case 'GENERATE_SUCCESS': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) { seg.previous_audio_id = seg.current_audio_id; seg.current_audio_id = action.audio_id; seg.duration_sec = action.duration_sec; seg.status = 'ready'; seg.error = undefined; seg.generated_voice_id = action.generated_voice_id; seg.updated_at = new Date().toISOString(); }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }
    case 'GENERATE_FAIL': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg) { seg.status = 'failed'; seg.error = action.error; }
      return { project: { ...p, segments: s } };
    }
    case 'UNDO_REGENERATE': {
      const s = segs();
      const seg = s.find(x => x.id === action.id);
      if (seg && seg.previous_audio_id) { const tmp = seg.current_audio_id; seg.current_audio_id = seg.previous_audio_id; seg.previous_audio_id = tmp; seg.updated_at = new Date().toISOString(); }
      return { project: { ...p, segments: s, updated_at: new Date().toISOString() } };
    }
    case 'SELECT_SEGMENT':
      return { project: { ...p, selected_segment_id: action.id } };
    default:
      return state;
  }
}

// -----------------------------------------------------------------------
// Hook wrapper
// -----------------------------------------------------------------------
import { useReducer, useEffect } from 'react';
import { getProject } from '../services/segmentedProjectDB';

export function useSegmentedProject(projectId: string | null = null) {
  const [state, dispatch] = useReducer(
    segmentedReducer,
    { project: createInitialProject() },
  );

  useEffect(() => {
    if (projectId) {
      getProject(projectId).then((p) => {
        if (p) dispatch({ type: 'LOAD_PROJECT', project: p });
      }).catch(e => console.warn('Load project failed:', e));
    }
  }, [projectId]);

  return [state, dispatch] as const;
}
