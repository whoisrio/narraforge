import { describe, expect, it } from 'vitest';
import type { Segment, SegmentEngineParams, RoleSnapshot } from '../types';
import { buildSegmentGenerationInputs, isSegmentAudioStale } from './segmentGenerationInputs';

const defaultParams: SegmentEngineParams = { engine: 'edge_tts', edge_voice: 'zh-CN-XiaoxiaoNeural' };

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: 's1',
    text: '你好',
    params: { engine: 'edge_tts' },
    status: 'ready',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const roleSnapshot: RoleSnapshot = {
  id: 'role-linxia',
  name: '林夏',
  default_engine: 'edge_tts',
  default_voice: 'zh-CN-XiaoxiaoNeural',
  default_engine_params: { engine: 'edge_tts', edge_voice: 'zh-CN-XiaoxiaoNeural' },
  favorite_styles: [],
};

describe('segmentGenerationInputs', () => {
  it('builds effective inputs from role snapshot before segment params', () => {
    const inputs = buildSegmentGenerationInputs(makeSegment({ role_id: 'role-linxia', role_snapshot: roleSnapshot }), defaultParams);
    expect(inputs.engine).toBe('edge_tts');
    expect(inputs.edge_voice).toBe('zh-CN-XiaoxiaoNeural');
    expect(inputs.role_id).toBe('role-linxia');
    expect(inputs.role_snapshot?.name).toBe('林夏');
  });

  it('marks audio stale when prosody marks changed', () => {
    const segment = makeSegment({
      prosody_marks: [{ id: 'm1', start: 0, end: 1, style_tags: ['slow'] }],
      generated_params: {
        engine: 'edge_tts',
        edge_voice: 'zh-CN-XiaoxiaoNeural',
        prosody_marks: [],
      },
    });
    expect(isSegmentAudioStale(segment, defaultParams)).toBe(true);
  });

  it('keeps audio fresh when effective inputs match generated params', () => {
    const marks = [{ id: 'm1', start: 0, end: 1, style_tags: ['slow'] }];
    const segment = makeSegment({
      role_id: 'role-linxia',
      role_snapshot: roleSnapshot,
      prosody_marks: marks,
      generated_params: {
        engine: 'edge_tts',
        edge_voice: 'zh-CN-XiaoxiaoNeural',
        role_id: 'role-linxia',
        role_snapshot: roleSnapshot,
        prosody_marks: marks,
        segment_kind: 'narration',
      },
    });
    expect(isSegmentAudioStale(segment, defaultParams)).toBe(false);
  });

  it('keeps legacy audio fresh when generated params predate role/prosody fields', () => {
    const segment = makeSegment({
      generated_params: {
        engine: 'edge_tts',
        edge_voice: 'zh-CN-XiaoxiaoNeural',
      },
    });
    expect(isSegmentAudioStale(segment, defaultParams)).toBe(false);
  });

  it('is NOT stale for an unchanged ready Edge-TTS segment with mixed undefined engine fields', () => {
    // Mirrors SegmentRow's defaultParamsForStale: follow-global edge segment
    // carries undefined voice_id / mimo_* keys that generated_params omits.
    const segment = makeSegment({
      params: { engine: 'edge_tts', edge_voice: 'zh-CN-XiaoxiaoNeural' },
      generated_params: {
        engine: 'edge_tts',
        edge_voice: 'zh-CN-XiaoxiaoNeural',
      },
    });
    const followGlobalParams = {
      engine: 'edge_tts',
      edge_voice: 'zh-CN-XiaoxiaoNeural',
      voice_id: undefined,
      mimo_mode: undefined,
      mimo_preset_voice: undefined,
      mimo_clone_voice_id: undefined,
    } as unknown as SegmentEngineParams;
    expect(isSegmentAudioStale(segment, followGlobalParams)).toBe(false);
  });

  it('IS stale when the global edge voice changes for a follow-global segment', () => {
    // The segment generated with Xiaoxiao but the live global edge voice is now
    // Yunjian. defaultParams (effective/follow-global) must win over the voice
    // stored in segment.params at generation time.
    const segment = makeSegment({
      params: { engine: 'edge_tts', edge_voice: 'zh-CN-XiaoxiaoNeural' },
      generated_params: {
        engine: 'edge_tts',
        edge_voice: 'zh-CN-XiaoxiaoNeural',
      },
    });
    const liveGlobalParams: SegmentEngineParams = {
      engine: 'edge_tts',
      edge_voice: 'zh-CN-YunjianNeural',
    };
    expect(isSegmentAudioStale(segment, liveGlobalParams)).toBe(true);
  });
});
