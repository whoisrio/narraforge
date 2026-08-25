import { describe, expect, it } from 'vitest';
import {
  applyPronunciationMap,
  applyTextTransforms,
  lowercaseLatinWords,
  mergePronunciationMaps,
  resolveLowercaseLatin,
  resolveSegmentEngineText,
} from './textTransforms';

const MAP = [
  { id: 'pm_a', source: '调动', target: '掉动' },
  { id: 'pm_b', source: '队伍', target: '团队' },
];

describe('mergePronunciationMaps', () => {
  it('project entry overrides global entry with same source (including id)', () => {
    expect(mergePronunciationMaps(
      [{ id: 'gpm_1', source: '调动', target: '全球版' }],
      [{ id: 'pm_1', source: '调动', target: '项目版' }],
    )).toEqual([{ id: 'pm_1', source: '调动', target: '项目版' }]);
  });

  it('keeps distinct entries', () => {
    const merged = mergePronunciationMaps(
      [{ id: 'gpm_1', source: '调动', target: '掉动' }],
      [{ id: 'pm_1', source: '行长', target: '行长2' }],
    );
    expect(merged.map(e => e.id).sort()).toEqual(['gpm_1', 'pm_1']);
  });
});

describe('applyPronunciationMap', () => {
  it('applies longest source first', () => {
    expect(applyPronunciationMap('调动工作要调动', [
      { id: 'pm_1', source: '调动', target: '掉动' },
      { id: 'pm_2', source: '调动工作', target: '调度工作' },
    ])).toBe('调度工作要掉动');
  });

  it('is single-pass per entry, not recursive', () => {
    expect(applyPronunciationMap('a', [{ id: 'pm_1', source: 'a', target: 'aa' }])).toBe('aa');
  });

  it('chains across entries in length order (A target containing B source gets re-replaced)', () => {
    // 与后端 test_apply_chains_across_entries_in_length_order 对应的镜像钉
    expect(applyPronunciationMap('a', [
      { id: 'pm_a', source: 'a', target: 'b' },
      { id: 'pm_b', source: 'b', target: 'c' },
    ])).toBe('c');
  });
});

describe('lowercaseLatinWords', () => {
  it('lowercase ALL-CAPS latin words in mixed text', () => {
    expect(lowercaseLatinWords('REST API 接口')).toBe('rest api 接口');
  });
  it('skips single letter and TitleCase words', () => {
    expect(lowercaseLatinWords('I think Http is OK')).toBe('I think Http is ok');
  });
  it('skips identifiers with trailing digits', () => {
    expect(lowercaseLatinWords('HTTP2 协议')).toBe('HTTP2 协议');
  });
});

describe('resolveLowercaseLatin', () => {
  it('segment override wins; falls back to project then false', () => {
    expect(resolveLowercaseLatin(false, true)).toBe(false);
    expect(resolveLowercaseLatin(true, false)).toBe(true);
    expect(resolveLowercaseLatin(null, true)).toBe(true);
    expect(resolveLowercaseLatin(null, null)).toBe(false);
  });
});

describe('applyTextTransforms', () => {
  it('applyAll ignores segment selection', () => {
    expect(applyTextTransforms('他调动了队伍', { mergedMap: MAP, applyAll: true }))
      .toBe('他掉动了团队');
  });
  it('segment selection picks subset', () => {
    expect(applyTextTransforms('他调动了队伍', { mergedMap: MAP, appliedMapIds: ['pm_a'] }))
      .toBe('他掉动了队伍');
  });
  it('dangling map id ignored', () => {
    expect(applyTextTransforms('他调动了队伍', { mergedMap: MAP, appliedMapIds: ['pm_gone'] }))
      .toBe('他调动了队伍');
  });
  it('lowercase runs after mapping (target uppercase words lowercased too)', () => {
    expect(applyTextTransforms('这个接口', {
      mergedMap: [{ id: 'pm_1', source: '接口', target: 'API' }],
      applyAll: true,
      lowercaseLatin: true,
    })).toBe('这个api');
  });
});

describe('resolveSegmentEngineText', () => {
  it('combines global + project + segment rules', () => {
    expect(resolveSegmentEngineText('他调动了 REST API', {
      globalMap: [{ id: 'gpm_1', source: '调动', target: '掉动' }],
      projectMap: [],
      applyAll: true,
      segmentTransforms: { lowercase_latin: true },
    })).toBe('他掉动了 rest api');
  });
});
