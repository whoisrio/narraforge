import { describe, expect, it } from 'vitest';
import type { Chapter, SegmentVerification } from '../../types';
import { buildVerifyReport } from './ttsVerify';

const v = (overrides: Partial<SegmentVerification>): SegmentVerification => ({
  audio_key: 'aud-1', status: 'match', baseline_text: '基准', asr_text: '回读',
  engine: 'funasr', checked_at: '2026-01-01T00:00:00Z', ...overrides,
});

function makeChapters(): Chapter[] {
  return [
    {
      id: 'ch2', name: '第二章', position: 1, voice: {} as Chapter['voice'],
      split_config: { delimiters: ['。'], mode: 'rule' }, created_at: '', updated_at: '',
      segments: [
        { id: 's3', text: '第三章顺序文本', voice: { source: 'chapter' }, status: 'ready', audio: { format: 'mp3' }, segment_kind: 'narration' },
        { id: 's4', text: '第二段文本', voice: { source: 'chapter' }, status: 'ready', audio: { format: 'mp3' }, segment_kind: 'narration' },
      ],
    },
    {
      id: 'ch1', name: '第一章', position: 0, voice: {} as Chapter['voice'],
      split_config: { delimiters: ['。'], mode: 'rule' }, created_at: '', updated_at: '',
      segments: [
        { id: 's1', text: '第一段文本', voice: { source: 'chapter' }, status: 'ready', audio: { format: 'mp3' }, segment_kind: 'narration' },
        { id: 's2', text: '出错段文本', voice: { source: 'chapter' }, status: 'ready', audio: { format: 'mp3' }, segment_kind: 'narration' },
      ],
    },
  ];
}

describe('buildVerifyReport', () => {
  it('分类计数 + items 只含 mismatch/error，按章节/段位置排序', () => {
    const results = new Map<string, SegmentVerification>([
      ['s1', v({ status: 'mismatch', match: false, similarity: 0.4 })],
      ['s3', v({ status: 'match', similarity: 1 })],
      ['s4', v({ status: 'error', error: 'verify timeout' })],
    ]);
    const report = buildVerifyReport({ scope: 'project', total: 4, results, chapters: makeChapters() });

    expect(report.total).toBe(4);
    expect(report.verified).toBe(3);
    expect(report.matchCount).toBe(1);
    expect(report.mismatchCount).toBe(1);
    expect(report.errorCount).toBe(1);
    expect(report.items.map((i) => i.segmentId)).toEqual(['s1', 's4']); // ch1 在前
    const s1 = report.items[0];
    expect(s1.chapterName).toBe('第一章');
    expect(s1.segmentIndex).toBe(1); // 章内 1-based
    expect(s1.displayText).toBe('第一段文本');
    expect(s1.verification.status).toBe('mismatch');
    expect(report.items[1].verification.error).toBe('verify timeout');
  });

  it('run 期间被删除的段（chapters 里找不到）不进 items，只计入 verified', () => {
    const results = new Map<string, SegmentVerification>([
      ['s1', v({ status: 'mismatch', match: false })],
      ['gone', v({ status: 'error', error: 'x' })],
    ]);
    const report = buildVerifyReport({ scope: 'chapter', total: 2, results, chapters: makeChapters() });
    expect(report.verified).toBe(2);
    expect(report.items.map((i) => i.segmentId)).toEqual(['s1']);
    expect(report.errorCount).toBe(0);
  });

  it('全部一致 → items 为空（调用方不弹报告）', () => {
    const results = new Map<string, SegmentVerification>([['s1', v({ status: 'match' })]]);
    const report = buildVerifyReport({ scope: 'chapter', total: 1, results, chapters: makeChapters() });
    expect(report.items).toEqual([]);
    expect(report.mismatchCount).toBe(0);
    expect(report.errorCount).toBe(0);
  });
});
