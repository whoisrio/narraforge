import { describe, expect, it } from 'vitest';
import type { Segment, EngineParams, Role } from '../types';
import { buildSegmentGenerationInputs, isSegmentAudioStale, isSegmentVoiceStale } from './segmentGenerationInputs';

const chapterDefaults: EngineParams = { engine: 'edge_tts', voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%', volume: '+0%' };

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 's1',
    text: '你好',
    voice: { source: 'chapter' },
    status: 'ready',
    audio: { format: 'mp3' },
    segment_kind: 'narration',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const sampleRole: Role = {
  id: 'role-linxia',
  name: '林夏',
  role_kind: 'cast',
  voice: { engine: 'edge_tts', voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%', volume: '+0%' },
  favorite_styles: [],
  created_at: '',
  updated_at: '',
};

describe('segmentGenerationInputs', () => {
  it('builds effective inputs from chapter defaults when no role', () => {
    const inputs = buildSegmentGenerationInputs(makeSegment(), undefined, chapterDefaults);
    expect(inputs.engine).toBe('edge_tts');
    expect((inputs as Record<string, unknown>).voice).toBe('zh-CN-XiaoxiaoNeural');
    expect(inputs.role_id).toBeNull();
  });

  it('builds effective inputs from role when segment has role', () => {
    const seg = makeSegment({ role_id: 'role-linxia', voice: { source: 'role', role_id: 'role-linxia' } });
    const inputs = buildSegmentGenerationInputs(seg, sampleRole, chapterDefaults);
    expect(inputs.engine).toBe('edge_tts');
  });

  it('keeps audio fresh when effective inputs match generated params', () => {
    const seg = makeSegment({
      voice: { source: 'chapter' },
      status: 'ready',
      generated_params: { engine: 'edge_tts', voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%', volume: '+0%' },
    });
    expect(isSegmentAudioStale(seg, undefined, chapterDefaults)).toBe(false);
  });

  it('is stale when engine changes for follow-global segment', () => {
    const seg = makeSegment({
      voice: { source: 'chapter' },
      status: 'ready',
      generated_params: { engine: 'cosyvoice', voice_id: 'vc1' },
    });
    expect(isSegmentAudioStale(seg, undefined, { engine: 'edge_tts', voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%', volume: '+0%' })).toBe(true);
  });

  it('is not stale when not ready', () => {
    const seg = makeSegment({ status: 'idle' });
    expect(isSegmentAudioStale(seg, undefined, chapterDefaults)).toBe(false);
  });
});

describe('isSegmentVoiceStale (legacy / frontend-mode fallback)', () => {
  it('is fresh when not ready', () => {
    expect(isSegmentVoiceStale({
      status: 'idle',
      hasVoiceOverride: false,
      generatedEngine: 'edge_tts',
      effectiveEngine: 'mimo_tts',
      generatedVoiceId: 'a',
      currentGlobalVoice: 'b',
    })).toBe(false);
  });

  it('is fresh when the segment has an independent voice override', () => {
    expect(isSegmentVoiceStale({
      status: 'ready',
      hasVoiceOverride: true,
      generatedEngine: 'edge_tts',
      effectiveEngine: 'mimo_tts',
      generatedVoiceId: 'a',
      currentGlobalVoice: 'b',
    })).toBe(false);
  });

  it('is stale when the engine changed for a follow-global segment', () => {
    expect(isSegmentVoiceStale({
      status: 'ready',
      hasVoiceOverride: false,
      generatedEngine: 'edge_tts',
      effectiveEngine: 'mimo_tts',
      generatedVoiceId: 'zh-CN-XiaoxiaoNeural',
      currentGlobalVoice: 'zh-CN-XiaoxiaoNeural',
    })).toBe(true);
  });

  it('is stale when the global voice changed for a follow-global segment', () => {
    expect(isSegmentVoiceStale({
      status: 'ready',
      hasVoiceOverride: false,
      generatedEngine: 'edge_tts',
      effectiveEngine: 'edge_tts',
      generatedVoiceId: 'zh-CN-XiaoxiaoNeural',
      currentGlobalVoice: 'zh-CN-YunjianNeural',
    })).toBe(true);
  });

  it('is fresh when engine and voice are unchanged', () => {
    expect(isSegmentVoiceStale({
      status: 'ready',
      hasVoiceOverride: false,
      generatedEngine: 'edge_tts',
      effectiveEngine: 'edge_tts',
      generatedVoiceId: 'zh-CN-XiaoxiaoNeural',
      currentGlobalVoice: 'zh-CN-XiaoxiaoNeural',
    })).toBe(false);
  });
});
