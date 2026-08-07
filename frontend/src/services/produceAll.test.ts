import { describe, it, expect } from 'vitest';
import { chaptersNeedingSplit, selectProduceAllSegments } from './produceAll';
import type { Chapter, Segment, VoiceSource } from '../types';

function seg(overrides: Partial<Segment> & { id: string }): Segment {
  return {
    text: '',
    voice: { source: 'chapter' },
    status: 'idle',
    audio: { format: 'mp3' },
    segment_kind: 'narration',
    role_id: null,
    emotion: undefined,
    generated_params: undefined,
    animation_spec: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const customVoice: VoiceSource = {
  source: 'custom',
  engine: 'edge_tts',
  params: { engine: 'edge_tts' } as never,
};

function chapter(id: string, segments: Segment[], extra: Partial<Chapter> = {}): Chapter {
  return {
    id,
    name: id,
    position: 0,
    voice: { engine: 'edge_tts' },
    split_config: { delimiters: ['。'], mode: 'rule' },
    design_title: id,
    segments,
    ...extra,
  } as Chapter;
}

describe('chaptersNeedingSplit', () => {
  it('includes chapters with no segments that have narration_script', () => {
    expect(chaptersNeedingSplit([chapter('c1', [], { narration_script: '句一。句二。' })]))
      .toEqual([{ chapterId: 'c1', text: '句一。句二。' }]);
  });

  it('falls back to original_text when narration_script is empty', () => {
    expect(chaptersNeedingSplit([chapter('c1', [], { original_text: '原文。' })]))
      .toEqual([{ chapterId: 'c1', text: '原文。' }]);
  });

  it('prefers narration_script over original_text', () => {
    const cs = chaptersNeedingSplit([chapter('c1', [], { narration_script: '旁白。', original_text: '原文。' })]);
    expect(cs[0].text).toBe('旁白。');
  });

  it('excludes chapters with no splittable text', () => {
    expect(chaptersNeedingSplit([chapter('c1', [])])).toEqual([]);
  });

  it('excludes chapters that already have segments', () => {
    expect(chaptersNeedingSplit([chapter('c1', [seg({ id: 's1' })], { narration_script: '句一。' })]))
      .toEqual([]);
  });
});

describe('selectProduceAllSegments', () => {
  it('targets idle and failed segments in unsynthesized mode, skips ready', () => {
    const ch = chapter('c1', [
      seg({ id: 'idle', status: 'idle' }),
      seg({ id: 'fail', status: 'failed' }),
      seg({ id: 'ready', status: 'ready', audio: { format: 'mp3', current: { path: 'a.mp3', file_exists: true } } }),
    ]);
    expect(selectProduceAllSegments([ch], 'unsynthesized')).toEqual(['idle', 'fail']);
  });

  it('targets ready non-custom segments in all mode, skips voice-locked', () => {
    const ch = chapter('c1', [
      seg({ id: 'ready', status: 'ready', audio: { format: 'mp3', current: { path: 'a.mp3', file_exists: true } } }),
      seg({ id: 'locked', status: 'ready', voice: customVoice, audio: { format: 'mp3', current: { path: 'b.mp3', file_exists: true } } }),
    ]);
    expect(selectProduceAllSegments([ch], 'all')).toEqual(['ready']);
  });

  it('never targets recorded segments', () => {
    const ch = chapter('c1', [seg({ id: 'rec', status: 'idle', audio: { format: 'mp3', current: { origin: 'recorded' } } })]);
    expect(selectProduceAllSegments([ch], 'all')).toEqual([]);
  });

  it('skips pending and queued segments', () => {
    const ch = chapter('c1', [seg({ id: 'p', status: 'pending' }), seg({ id: 'q', status: 'queued' })]);
    expect(selectProduceAllSegments([ch], 'all')).toEqual([]);
  });

  it('spans multiple chapters preserving order', () => {
    const c1 = chapter('c1', [seg({ id: 'a', status: 'idle' })]);
    const c2 = chapter('c2', [seg({ id: 'b', status: 'failed' })]);
    expect(selectProduceAllSegments([c1, c2], 'unsynthesized')).toEqual(['a', 'b']);
  });

  it('targets desynced (file-lost -> idle) segments in unsynthesized mode', () => {
    const ch = chapter('c1', [seg({ id: 'lost', status: 'idle', audio: { format: 'mp3', current: { path: 'gone.mp3', file_exists: false } } })]);
    expect(selectProduceAllSegments([ch], 'unsynthesized')).toEqual(['lost']);
  });
});
