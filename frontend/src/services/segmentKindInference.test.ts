import { describe, expect, it } from 'vitest';
import type { Role } from '../types';
import { assignRoleForSplitItem, inferSegmentKind, inferSpeakerName } from './segmentKindInference';

const narrator = {
  id: 'role-narrator',
  name: '默认旁白',
  default_engine: 'edge_tts',
  default_voice: 'Yunxi',
  default_engine_params: { engine: 'edge_tts' as const, edge_voice: 'zh-CN-YunxiNeural' },
  favorite_styles: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
} satisfies Role;

const castA = {
  id: 'role-guest-a',
  name: '嘉宾A',
  default_engine: 'edge_tts',
  default_voice: 'Yunyang',
  default_engine_params: { engine: 'edge_tts' as const, edge_voice: 'zh-CN-YunyangNeural' },
  favorite_styles: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
} satisfies Role;

describe('segmentKindInference', () => {
  it('keeps all segments as narration in narration mode', () => {
    expect(inferSegmentKind('嘉宾A：你好', 'narration')).toBe('narration');
    expect(inferSegmentKind('“你好。”', 'narration')).toBe('narration');
  });

  it('detects dialogue in dialogue mode from speaker prefixes, quotes, and QA markers', () => {
    expect(inferSegmentKind('嘉宾A：你好', 'dialogue')).toBe('dialogue');
    expect(inferSegmentKind('“你好。”', 'dialogue')).toBe('dialogue');
    expect(inferSegmentKind('Q: 你怎么看？', 'dialogue')).toBe('dialogue');
    expect(inferSegmentKind('旁白继续推进故事。', 'dialogue')).toBe('narration');
  });

  it('uses mixed mode as narration by default but marks obvious dialogue', () => {
    expect(inferSegmentKind('旁白继续推进故事。', 'mixed')).toBe('narration');
    expect(inferSegmentKind('嘉宾A：你好', 'mixed')).toBe('dialogue');
  });

  it('extracts speaker names from prefixed dialogue', () => {
    expect(inferSpeakerName('嘉宾A：你好')).toBe('嘉宾A');
    expect(inferSpeakerName('Alice: hello')).toBe('Alice');
    expect(inferSpeakerName('“你好。”')).toBeNull();
  });

  it('assigns narrator role to narration and matching cast role to dialogue', () => {
    const roles = [narrator, castA];

    const narration = assignRoleForSplitItem('旁白继续。', 'narration', roles, narrator.id);
    expect(narration.segment_kind).toBe('narration');
    expect(narration.role_id).toBe('role-narrator');
    expect(narration.role_snapshot?.name).toBe('默认旁白');

    const dialogue = assignRoleForSplitItem('嘉宾A：你好。', 'dialogue', roles, narrator.id);
    expect(dialogue.segment_kind).toBe('dialogue');
    expect(dialogue.role_id).toBe('role-guest-a');
    expect(dialogue.role_snapshot?.name).toBe('嘉宾A');
  });

  it('leaves unmatched dialogue without a cast role', () => {
    const dialogue = assignRoleForSplitItem('陌生人：你好。', 'dialogue', [narrator, castA], narrator.id);
    expect(dialogue.segment_kind).toBe('dialogue');
    expect(dialogue.role_id).toBeNull();
    expect(dialogue.role_snapshot).toBeNull();
  });
});
