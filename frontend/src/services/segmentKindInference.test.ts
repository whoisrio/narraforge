import { describe, expect, it } from 'vitest';
import type { Role } from '../types';
import { assignRoleForSplitItem, inferSegmentKind, inferSpeakerName } from './segmentKindInference';

const narrator = {
  id: 'role-narrator',
  name: '默认旁白',
  voice: { engine: 'edge_tts' as const, voice: 'Yunxi', rate: '+0%', volume: '+0%' },
  favorite_styles: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
} satisfies Role;

const castA = {
  id: 'role-guest-a',
  name: '嘉宾A',
  voice: { engine: 'edge_tts' as const, voice: 'Yunyang', rate: '+0%', volume: '+0%' },
  favorite_styles: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
} satisfies Role;

describe('segmentKindInference', () => {
  it('keeps all segments as narration in narration mode', () => {
    expect(inferSegmentKind('嘉宾A：你好', 'narration')).toBe('narration');
    expect(inferSegmentKind('"你好。"', 'narration')).toBe('narration');
  });

  it('detects dialogue in dialogue mode from speaker prefixes, quotes, and QA markers', () => {
    expect(inferSegmentKind('嘉宾A：你好', 'dialogue')).toBe('dialogue');
    expect(inferSegmentKind('"你好。"', 'dialogue')).toBe('dialogue');
    expect(inferSegmentKind('Q: 你怎么看？', 'dialogue')).toBe('dialogue');
    expect(inferSegmentKind('旁白继续推进故事。', 'dialogue')).toBe('narration');
  });

  it('extracts speaker names from prefixed dialogue', () => {
    expect(inferSpeakerName('嘉宾A：你好')).toBe('嘉宾A');
    expect(inferSpeakerName('Alice: hello')).toBe('Alice');
    expect(inferSpeakerName('"你好。"')).toBeNull();
  });

  it('narration segments get no role (voice from global Engine panel)', () => {
    const roles = [narrator, castA];

    const narration = assignRoleForSplitItem('旁白继续。', 'narration', roles);
    expect(narration.segment_kind).toBe('narration');
    expect(narration.role_id).toBeNull();
    expect(narration.role_snapshot).toBeNull();

  });

  it('assigns matching cast role to dialogue segments', () => {
    const roles = [narrator, castA];

    const dialogue = assignRoleForSplitItem('嘉宾A：你好。', 'dialogue', roles);
    expect(dialogue.segment_kind).toBe('dialogue');
    expect(dialogue.role_id).toBe('role-guest-a');
    expect(dialogue.role_snapshot?.name).toBe('嘉宾A');
    expect(dialogue.role_snapshot?.voice?.engine).toBe('edge_tts');
  });

  it('leaves unmatched dialogue without a cast role', () => {
    const dialogue = assignRoleForSplitItem('陌生人：你好。', 'dialogue', [narrator, castA]);
    expect(dialogue.segment_kind).toBe('dialogue');
    expect(dialogue.role_id).toBeNull();
    expect(dialogue.role_snapshot).toBeNull();
  });
});
