import { describe, expect, it } from 'vitest';
import { pickForkCheckpoint, type HistoryCheckpoint } from './fork';

function h(id: string, values: Record<string, unknown>): HistoryCheckpoint {
  return { checkpoint: { checkpoint_id: id }, values };
}

// getHistory 返回按时间倒序（最新在前）
const history: HistoryCheckpoint[] = [
  h('c5', { narration_script: 'x', review_feedback: {}, structured_segments: [], synthesis_results: [] }),
  h('c4', { narration_script: 'x', review_feedback: {}, structured_segments: [] }),
  h('c3', { narration_script: 'x', review_feedback: {}, structured_segments: [] }),
  h('c2', { narration_script: 'x', review_feedback: {} }),
  h('c1', { narration_script: 'x' }),
  h('c0', {}),
];

describe('pickForkCheckpoint', () => {
  it('picks the checkpoint just before the node first completes (so the node re-runs)', () => {
    // split_segment 在 c3 首次完成 → 恢复点是更旧的 c2（执行前状态）
    expect(pickForkCheckpoint(history, 'split_segment')).toBe('c2');
    expect(pickForkCheckpoint(history, 'gen_script')).toBe('c0');
    // synthesis 在 c5（最新）才首次完成 → 恢复点是 c4
    expect(pickForkCheckpoint(history, 'synthesis')).toBe('c4');
  });

  it('falls back to the oldest entry when the node was already done at the oldest checkpoint', () => {
    const h2: HistoryCheckpoint[] = [
      h('c2', { narration_script: 'x' }),
      h('c1', { narration_script: 'x' }),
    ];
    expect(pickForkCheckpoint(h2, 'gen_script')).toBe('c1');
  });

  it('returns null when the node never completed', () => {
    expect(pickForkCheckpoint([h('c1', {})], 'gen_script')).toBeNull();
    expect(pickForkCheckpoint([], 'gen_script')).toBeNull();
  });

  it('returns null for nodes without completion state keys', () => {
    expect(pickForkCheckpoint(history, 'unknown_node')).toBeNull();
  });
});
