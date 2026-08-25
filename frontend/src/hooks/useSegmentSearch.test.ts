import { describe, expect, it } from 'vitest';
import type { SegmentedProject } from '../types';
import { findUppercaseSegments, searchSegments, splitSnippet } from './useSegmentSearch';

function makeProject(): SegmentedProject {
  const voice = { engine: 'edge_tts' as const, voice: '', rate: '+0%', volume: '+0%' };
  const seg = (id: string, text: string, position: number) => ({
    id, text, position, voice: { source: 'chapter' as const }, status: 'idle' as const,
    audio: { format: 'mp3' }, segment_kind: 'narration' as const, created_at: 'x', updated_at: 'x',
  });
  return {
    schema_version: 2, id: 'p', name: 'P', layout: 'vertical',
    active_chapter_id: 'c1', created_at: 'x', updated_at: 'x',
    chapters: [
      { id: 'c1', name: '夜路', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [seg('s1', '夜色渐浓，小路两旁的树影摇曳。', 0), seg('s2', '他加快了脚步。', 1)] },
      { id: 'c2', name: '破庙', design_title: '破庙（设计题）', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [seg('s3', '破庙的门半掩着，夜色里透出微光。', 0)] },
    ],
  };
}

describe('searchSegments', () => {
  it('finds matches across chapters with chapter name and position', () => {
    const hits = searchSegments(makeProject(), '夜色');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ chapterId: 'c1', chapterName: '夜路', segmentId: 's1', position: 0, matchCount: 1 });
    expect(hits[1]).toMatchObject({ chapterId: 'c2', chapterName: '破庙（设计题）', segmentId: 's3', matchCount: 1 });
    expect(hits[1].snippet).toContain('夜色');
  });

  it('is case-insensitive for latin text', () => {
    const p = makeProject();
    p.chapters[0].segments[0].text = '使用 REST API 接口';
    const hits = searchSegments(p, 'api');
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toContain('REST API');
  });

  it('empty/whitespace query returns no hits', () => {
    expect(searchSegments(makeProject(), '')).toEqual([]);
    expect(searchSegments(makeProject(), '   ')).toEqual([]);
  });

  it('counts multiple matches in one segment', () => {
    const p = makeProject();
    p.chapters[0].segments[0].text = '好啊，真好啊';
    const hits = searchSegments(p, '好啊');
    expect(hits[0].matchCount).toBe(2);
  });

  it('long text snippet is ellipsized around the match', () => {
    const p = makeProject();
    p.chapters[0].segments[0].text = '一'.repeat(40) + '目标' + '二'.repeat(40);
    const hits = searchSegments(p, '目标');
    expect(hits[0].snippet.startsWith('…')).toBe(true);
    expect(hits[0].snippet.endsWith('…')).toBe(true);
    expect(hits[0].snippet).toContain('目标');
    expect(hits[0].snippet.length).toBeLessThan(60);
  });
});

describe('splitSnippet', () => {
  it('splits around case-insensitive matches for highlighting', () => {
    expect(splitSnippet('使用 REST API 接口', 'api')).toEqual([
      { text: '使用 REST ', match: false },
      { text: 'API', match: true },
      { text: ' 接口', match: false },
    ]);
  });
  it('empty query returns single non-match part', () => {
    expect(splitSnippet('abc', '')).toEqual([{ text: 'abc', match: false }]);
  });
});

describe('findUppercaseSegments', () => {
  it('finds segments containing ALL-CAPS latin words', () => {
    const p = makeProject();
    p.chapters[1].segments[0].text = '调用 REST API 接口';
    const hits = findUppercaseSegments(p);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ chapterId: 'c2', segmentId: 's3', matchCount: 2 });
    expect(hits[0].snippet).toContain('REST');
  });

  it('ignores single-letter and TitleCase words', () => {
    const p = makeProject();
    p.chapters[0].segments[0].text = 'I think Http works';
    expect(findUppercaseSegments(p)).toEqual([]);
  });
});
