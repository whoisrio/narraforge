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
});
