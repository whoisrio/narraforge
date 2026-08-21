import { describe, expect, it } from 'vitest';
import { adaptGlobalUsage, adaptProjectUsage } from '../usageApi';

/** 用量端点响应的 typed adapter：数值字段兜底，畸形载荷不崩 UI。 */
describe('adaptProjectUsage', () => {
  it('完整响应原样通过', () => {
    const usage = adaptProjectUsage({
      project_id: 'p1',
      tts_count: 12,
      chars: 3456,
      input_tokens: 700,
      output_tokens: 900,
    });
    expect(usage).toEqual({
      project_id: 'p1',
      tts_count: 12,
      chars: 3456,
      input_tokens: 700,
      output_tokens: 900,
    });
  });

  it('缺失/非法字段兜底为 0 与空串', () => {
    expect(adaptProjectUsage({})).toEqual({
      project_id: '',
      tts_count: 0,
      chars: 0,
      input_tokens: 0,
      output_tokens: 0,
    });
    expect(adaptProjectUsage(null).chars).toBe(0);
    expect(adaptProjectUsage({ tts_count: 'x', chars: NaN }).tts_count).toBe(0);
  });
});

describe('adaptGlobalUsage', () => {
  it('projects + totals 完整适配', () => {
    const usage = adaptGlobalUsage({
      projects: [
        { project_id: 'p1', project_name: '项目一', tts_count: 3, chars: 100, input_tokens: 20, output_tokens: 30 },
      ],
      totals: { tts_count: 3, chars: 100, input_tokens: 20, output_tokens: 30 },
    });
    expect(usage.projects).toHaveLength(1);
    expect(usage.projects[0].project_name).toBe('项目一');
    expect(usage.totals.output_tokens).toBe(30);
  });

  it('projects 非数组 / totals 缺失时兜底', () => {
    const usage = adaptGlobalUsage({ projects: 'nope' });
    expect(usage.projects).toEqual([]);
    expect(usage.totals).toEqual({ tts_count: 0, chars: 0, input_tokens: 0, output_tokens: 0 });
  });
});
