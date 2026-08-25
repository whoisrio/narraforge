import { describe, it, expect } from 'vitest';
import { segmentedReducer, createInitialProject, migrateV1 } from './useSegmentedProject';
import type { State } from './useSegmentedProject';
import type { Segment, SegmentedProject } from '../types';

function stateWithSegment(): { state: State; segmentId: string } {
  let state: State = { project: createInitialProject() };
  state = segmentedReducer(state, { type: 'APPEND_SEGMENT', text: '第一句。' });
  const segmentId = state.project.chapters[0].segments[0].id;
  return { state, segmentId };
}

function getSegment(state: State, id: string): Segment {
  const seg = state.project.chapters[0].segments.find(s => s.id === id);
  if (!seg) throw new Error(`segment ${id} not found`);
  return seg;
}

describe('GENERATE_SUCCESS (frontend storage mode, audio_id)', () => {
  it('writes duration_sec into audio.current so it survives reload', () => {
    const { state: s0, segmentId } = stateWithSegment();
    const state = segmentedReducer(s0, {
      type: 'GENERATE_SUCCESS', id: segmentId, audio_id: 'audio-1', duration_sec: 12.5, origin: 'tts',
    });
    const seg = getSegment(state, segmentId);
    expect(seg.audio.current?.id).toBe('audio-1');
    expect(seg.audio.current?.duration_sec).toBe(12.5);
    expect(seg.audio.duration_sec).toBe(12.5);
  });

  it('keeps top-level duration_sec after a save/reload round-trip (enrichSegment)', () => {
    const { state: s0, segmentId } = stateWithSegment();
    const state = segmentedReducer(s0, {
      type: 'GENERATE_SUCCESS', id: segmentId, audio_id: 'audio-1', duration_sec: 12.5, origin: 'tts',
    });
    // Simulate autosave -> reload: JSON round-trip through migrateV1
    const reloaded = migrateV1(JSON.parse(JSON.stringify(state.project)));
    const seg = reloaded.chapters[0].segments.find(s => s.id === segmentId)!;
    expect(seg.audio.duration_sec).toBe(12.5);
  });
});

describe('UNDO_REGENERATE', () => {
  function stateWithTwoGenerations(): { state: State; segmentId: string } {
    const { state: s0, segmentId } = stateWithSegment();
    let state = segmentedReducer(s0, {
      type: 'GENERATE_SUCCESS', id: segmentId, audio_id: 'audio-old', duration_sec: 10, origin: 'tts',
    });
    state = segmentedReducer(state, {
      type: 'GENERATE_SUCCESS', id: segmentId, audio_id: 'audio-new', duration_sec: 8, origin: 'tts',
    });
    return { state, segmentId };
  }

  it('syncs top-level audio.duration_sec after swapping current/previous', () => {
    const { state: s0, segmentId } = stateWithTwoGenerations();
    const state = segmentedReducer(s0, { type: 'UNDO_REGENERATE', id: segmentId });
    const seg = getSegment(state, segmentId);
    // After undo, the old generation (10s) is current again
    expect(seg.audio.current?.id).toBe('audio-old');
    expect(seg.audio.current?.duration_sec).toBe(10);
    expect(seg.audio.duration_sec).toBe(10);
  });

  it('sets top-level duration_sec to undefined when the restored current has no duration', () => {
    const { state: s0, segmentId } = stateWithTwoGenerations();
    // Strip duration from the older entry (previous after second generation)
    const project = s0.project;
    const seg = project.chapters[0].segments.find(s => s.id === segmentId)!;
    seg.audio.previous = { id: 'audio-old' };
    const state = segmentedReducer({ project }, { type: 'UNDO_REGENERATE', id: segmentId });
    const after = getSegment(state, segmentId);
    expect(after.audio.current?.id).toBe('audio-old');
    expect(after.audio.duration_sec).toBeUndefined();
  });
});

describe('enrichSegment: file_exists gating (backend desync fix)', () => {
  function migrateWithAudio(
    current: Record<string, unknown> | undefined,
    previous?: Record<string, unknown>,
  ) {
    const raw = {
      schema_version: 2 as const,
      id: 'p1', name: 'p',
      chapters: [{
        id: 'c1', name: 'c', position: 0,
        voice: { engine: 'edge_tts' },
        segments: [{
          id: 's1', position: 0, text: 'hi',
          voice: { source: 'chapter' },
          audio: {
            format: 'mp3',
            ...(current ? { current } : {}),
            ...(previous ? { previous } : {}),
          },
        }],
      }],
    };
    return migrateV1(raw).chapters[0].segments[0];
  }

  it('is ready when backend current.file_exists is true', () => {
    expect(migrateWithAudio({ path: 'a/b.mp3', file_exists: true }).status).toBe('ready');
  });

  it('is idle when backend current.file_exists is false (file lost / desync)', () => {
    expect(migrateWithAudio({ path: 'a/b.mp3', file_exists: false }).status).toBe('idle');
  });

  it('is ready for frontend-mode current.id (no file_exists flag)', () => {
    expect(migrateWithAudio({ id: 'idx-1' }).status).toBe('ready');
  });

  it('is ready when current has path but no file_exists (fresh synth round-trip)', () => {
    expect(migrateWithAudio({ path: 'a/b.mp3' }).status).toBe('ready');
  });

  it('is idle when only previous exists (no current) - aligns with export which checks current', () => {
    expect(migrateWithAudio(undefined, { path: 'a/b.mp3' }).status).toBe('idle');
  });
});


// ===== 合成时文本变换：text_transforms / configs =====

function projectWithTwoChapters(): SegmentedProject {
  const voice = { engine: 'edge_tts' as const, voice: '', rate: '+0%', volume: '+0%' };
  return {
    schema_version: 2, id: 'p', name: 'P', layout: 'vertical',
    active_chapter_id: 'c1', created_at: 'x', updated_at: 'x',
    chapters: [
      { id: 'c1', name: '一', voice, segments: [], split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x' },
      { id: 'c2', name: '二', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [{ id: 's2', text: 'hi', voice: { source: 'chapter' }, status: 'idle', audio: { format: 'mp3' }, segment_kind: 'narration', created_at: 'x', updated_at: 'x' }] },
    ],
  };
}

describe('SET_SEGMENT_TEXT_TRANSFORMS', () => {
  it('writes transforms on a segment in a NON-active chapter (updateSegmentById)', () => {
    const project = projectWithTwoChapters();  // active = c1，目标段在 c2
    const state = segmentedReducer({ project }, {
      type: 'SET_SEGMENT_TEXT_TRANSFORMS', id: 's2',
      transforms: { applied_map_ids: ['pm_a'], lowercase_latin: false },
    });
    const seg = state.project.chapters[1].segments[0];
    expect(seg.text_transforms).toEqual({ applied_map_ids: ['pm_a'], lowercase_latin: false });
    // bump updated_at 触发自动保存
    expect(state.project.updated_at).not.toBe('x');
  });

  it('merges with existing transforms (caller spreads; reducer stores as-is)', () => {
    const project = projectWithTwoChapters();
    project.chapters[1].segments[0].text_transforms = { applied_map_ids: ['pm_a'] };
    const prev = project.chapters[1].segments[0].text_transforms!;
    const state = segmentedReducer({ project }, {
      type: 'SET_SEGMENT_TEXT_TRANSFORMS', id: 's2',
      transforms: { ...prev, lowercase_latin: true },
    });
    expect(state.project.chapters[1].segments[0].text_transforms)
      .toEqual({ applied_map_ids: ['pm_a'], lowercase_latin: true });
  });

  it('returns same project when segment not found (no spurious autosave)', () => {
    const project = projectWithTwoChapters();
    const state = segmentedReducer({ project }, {
      type: 'SET_SEGMENT_TEXT_TRANSFORMS', id: 'nope', transforms: null,
    });
    expect(state.project).toBe(project);
  });
});

describe('SET_PROJECT_META text-transform fields', () => {
  it('stores pronunciation_map / pronunciation_apply_all / lowercase_latin in configs', () => {
    const project = projectWithTwoChapters();
    const map = [{ id: 'pm_1', source: '调动', target: '掉动' }];
    let state = segmentedReducer({ project }, { type: 'SET_PROJECT_META', meta: { pronunciation_map: map } });
    state = segmentedReducer(state, { type: 'SET_PROJECT_META', meta: { pronunciation_apply_all: true } });
    state = segmentedReducer(state, { type: 'SET_PROJECT_META', meta: { lowercase_latin: true } });
    expect(state.project.configs?.pronunciation_map).toEqual(map);
    expect(state.project.configs?.pronunciation_apply_all).toBe(true);
    expect(state.project.configs?.lowercase_latin).toBe(true);
  });

  it('does not clobber existing configs keys', () => {
    const project = projectWithTwoChapters();
    project.configs = { underscore_to_space: true };
    const state = segmentedReducer({ project }, { type: 'SET_PROJECT_META', meta: { lowercase_latin: true } });
    expect(state.project.configs?.underscore_to_space).toBe(true);
    expect(state.project.configs?.lowercase_latin).toBe(true);
  });
});

describe('enrichSegment text_transforms passthrough', () => {
  it('survives migrateV1 (IndexedDB reload round-trip)', () => {
    const project = projectWithTwoChapters();
    project.chapters[1].segments[0].text_transforms = { applied_map_ids: ['pm_a'], lowercase_latin: null };
    const reloaded = migrateV1(JSON.parse(JSON.stringify(project)));
    expect(reloaded.chapters[1].segments[0].text_transforms)
      .toEqual({ applied_map_ids: ['pm_a'], lowercase_latin: null });
  });
});
