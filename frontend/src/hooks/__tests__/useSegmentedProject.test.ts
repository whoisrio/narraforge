import { describe, it, expect } from 'vitest';
import type { SegmentedProject, Segment } from '../../types';
import { segmentedReducer, createInitialProject } from '../useSegmentedProject';

function makeProject(overrides: Partial<SegmentedProject> = {}): SegmentedProject {
  const now = new Date().toISOString();
  return {
    schema_version: 1, id: 'p1', name: 'Test', segments: [],
    default_params: { engine: 'cosyvoice' },
    split_config: { delimiters: ['，', '。'], mode: 'rule' },
    layout: 'vertical',
    created_at: now, updated_at: now,
    ...overrides,
  };
}

describe('segmentedReducer', () => {
  it('APPLY_SPLIT replaces segments with idle status', () => {
    const p = makeProject({ segments: [
      { id: 'old', text: 'old', params: { engine: 'cosyvoice' }, status: 'ready', created_at: '', updated_at: '' },
    ]});
    const next = segmentedReducer({ project: p }, { type: 'APPLY_SPLIT', texts: ['a', 'b'] });
    expect(next.project.segments).toHaveLength(2);
    expect(next.project.segments[0].text).toBe('a');
    expect(next.project.segments[0].status).toBe('idle');
    expect(next.project.selected_segment_id).toBeUndefined();
  });

  it('APPEND_SEGMENT appends with default_params', () => {
    const next = segmentedReducer({ project: makeProject() }, { type: 'APPEND_SEGMENT', text: 'hello' });
    expect(next.project.segments).toHaveLength(1);
    expect(next.project.segments[0].text).toBe('hello');
    expect(next.project.segments[0].params.engine).toBe('cosyvoice');
  });

  it('INSERT_SEGMENT inserts after given id', () => {
    const p = makeProject({ segments: [
      { id: 'a', text: 'a', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' },
      { id: 'c', text: 'c', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' },
    ]});
    const next = segmentedReducer({ project: p }, { type: 'INSERT_SEGMENT', afterId: 'a', text: 'b' });
    expect(next.project.segments.map(s => s.text)).toEqual(['a', 'b', 'c']);
  });

  it('DELETE_SEGMENT removes the segment and deselects if it was selected', () => {
    const s1: Segment = { id: 'a', text: 'a', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' };
    const s2: Segment = { id: 'b', text: 'b', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' };
    const p = makeProject({ segments: [s1, s2], selected_segment_id: 'a' });
    const next = segmentedReducer({ project: p }, { type: 'DELETE_SEGMENT', id: 'a' });
    expect(next.project.segments).toHaveLength(1);
    expect(next.project.selected_segment_id).toBeUndefined();
  });

  it('REORDER moves segment from fromIndex to toIndex', () => {
    const segments: Segment[] = [
      { id: 'a', text: 'a', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' },
      { id: 'b', text: 'b', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' },
      { id: 'c', text: 'c', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' },
    ];
    const p = makeProject({ segments });
    const next = segmentedReducer({ project: p }, { type: 'REORDER', fromIndex: 2, toIndex: 0 });
    expect(next.project.segments.map(s => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('GENERATE_SUCCESS swaps audio references and sets ready', () => {
    const s: Segment = { id: 's1', text: 'x', params: { engine: 'cosyvoice' }, status: 'pending',
      current_audio_id: 'old_current', previous_audio_id: 'old_prev', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({ segments: [s] }) }, {
      type: 'GENERATE_SUCCESS', id: 's1', audio_id: 'new_audio', duration_sec: 3.2,
    });
    const seg = next.project.segments[0];
    expect(seg.status).toBe('ready');
    expect(seg.current_audio_id).toBe('new_audio');
    expect(seg.previous_audio_id).toBe('old_current');
    expect(seg.duration_sec).toBe(3.2);
  });

  it('UNDO_REGENERATE swaps current and previous', () => {
    const s: Segment = { id: 's1', text: 'x', params: { engine: 'cosyvoice' }, status: 'ready',
      current_audio_id: 'c', previous_audio_id: 'p', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({ segments: [s] }) }, { type: 'UNDO_REGENERATE', id: 's1' });
    expect(next.project.segments[0].current_audio_id).toBe('p');
    expect(next.project.segments[0].previous_audio_id).toBe('c');
  });

  it('UPDATE_TEXT changes text', () => {
    const s: Segment = { id: 's1', text: 'old', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({ segments: [s] }) }, { type: 'UPDATE_TEXT', id: 's1', text: 'new' });
    expect(next.project.segments[0].text).toBe('new');
  });

  it('BATCH_SET_SSML sets ssml for multiple segments', () => {
    const s1: Segment = { id: 'a', text: 'a', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' };
    const s2: Segment = { id: 'b', text: 'b', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({ segments: [s1, s2] }) }, {
      type: 'BATCH_SET_SSML', updates: [
        { id: 'a', ssml: '<speak>a</speak>' },
        { id: 'b', ssml: '<speak>b</speak>' },
      ], by_llm: true,
    });
    expect(next.project.segments[0].ssml).toBe('<speak>a</speak>');
    expect(next.project.segments[0].ssml_annotated_by_llm).toBe(true);
    expect(next.project.segments[1].ssml).toBe('<speak>b</speak>');
  });

  it('GENERATE_FAIL sets failed status and error', () => {
    const s: Segment = { id: 's1', text: 'x', params: { engine: 'cosyvoice' }, status: 'pending', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({ segments: [s] }) }, { type: 'GENERATE_FAIL', id: 's1', error: 'timeout' });
    expect(next.project.segments[0].status).toBe('failed');
    expect(next.project.segments[0].error).toBe('timeout');
  });

  it('SELECT_SEGMENT sets selected_segment_id', () => {
    const next = segmentedReducer({ project: makeProject() }, { type: 'SELECT_SEGMENT', id: 'abc' });
    expect(next.project.selected_segment_id).toBe('abc');
    const next2 = segmentedReducer({ project: makeProject() }, { type: 'SELECT_SEGMENT', id: undefined });
    expect(next2.project.selected_segment_id).toBeUndefined();
  });

  it('RENAME_PROJECT sets name', () => {
    const next = segmentedReducer({ project: makeProject({ name: 'Old' }) }, { type: 'RENAME_PROJECT', name: 'New' });
    expect(next.project.name).toBe('New');
  });

  it('SET_LAYOUT changes layout', () => {
    const next = segmentedReducer({ project: makeProject() }, { type: 'SET_LAYOUT', layout: 'horizontal' });
    expect(next.project.layout).toBe('horizontal');
  });

  it('createInitialProject generates a valid SegmentedProject', () => {
    const p = createInitialProject();
    expect(p.id).toBeTruthy();
    expect(p.schema_version).toBe(1);
    expect(p.segments).toEqual([]);
  });
});
