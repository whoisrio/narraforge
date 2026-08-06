import { describe, it, expect } from 'vitest';
import { segmentedReducer, createInitialProject, migrateV1 } from './useSegmentedProject';
import type { State } from './useSegmentedProject';
import type { Segment } from '../types';

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
