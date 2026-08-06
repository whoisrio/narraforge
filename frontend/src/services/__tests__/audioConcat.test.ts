import { describe, it, expect } from 'vitest';
import { fmtSrtTime, buildSRTContent, buildExportTimeline } from '../audioConcat';
import type { Segment } from '../../types';

describe('fmtSrtTime', () => {
  it('formats 0ms', () => {
    expect(fmtSrtTime(0)).toBe('00:00:00,000');
  });
  it('formats 1000ms', () => {
    expect(fmtSrtTime(1000)).toBe('00:00:01,000');
  });
  it('formats 3661000ms (1h 1m 1s)', () => {
    expect(fmtSrtTime(3661000)).toBe('01:01:01,000');
  });
  it('formats 123456ms correctly', () => {
    expect(fmtSrtTime(123456)).toBe('00:02:03,456');
  });
});

describe('buildSRTContent', () => {
  const segments = [
    { text: '你好。', startMs: 0, endMs: 2000 },
    { text: '世界！', startMs: 2000, endMs: 4500 },
  ];

  it('builds correct SRT content', () => {
    const srt = buildSRTContent(segments);
    expect(srt).toContain('1');
    expect(srt).toContain('00:00:00,000 --> 00:00:02,000');
    expect(srt).toContain('你好。');
    expect(srt).toContain('2');
    expect(srt).toContain('00:00:02,000 --> 00:00:04,500');
    expect(srt).toContain('世界！');
  });
});

describe('buildExportTimeline', () => {
  function makeSeg(overrides: Partial<Segment> & { id: string }): Segment {
    const now = new Date().toISOString();
    return {
      text: overrides.id,
      voice: { source: 'chapter' },
      status: 'ready',
      audio: { format: 'mp3' },
      segment_kind: 'narration',
      created_at: now,
      updated_at: now,
      ...overrides,
    };
  }

  it('skips non-ready segments and keeps the timeline continuous (frontend mode)', () => {
    const segments = [
      makeSeg({ id: 'a', audio: { format: 'mp3', current: { id: 'au-a' }, duration_sec: 2 } }),
      makeSeg({ id: 'b', status: 'idle', audio: { format: 'mp3' } }),
      makeSeg({ id: 'c', audio: { format: 'mp3', current: { id: 'au-c' }, duration_sec: 3 } }),
    ];
    const timeline = buildExportTimeline(segments, 'frontend');
    expect(timeline.map(t => t.id)).toEqual(['a', 'c']);
    expect(timeline[0]).toMatchObject({ _startMs: 0, _endMs: 2000 });
    // cue 'c' must start right where 'a' ended — no gap from the skipped segment
    expect(timeline[1]).toMatchObject({ _startMs: 2000, _endMs: 5000 });
  });

  it('skips ready segments without stored audio in backend mode', () => {
    const segments = [
      makeSeg({ id: 'a', audio: { format: 'mp3', current: { path: 'data/a.mp3' }, duration_sec: 1.5 } }),
      makeSeg({ id: 'b', audio: { format: 'mp3', duration_sec: 9 } }), // ready but no file
    ];
    const timeline = buildExportTimeline(segments, 'backend');
    expect(timeline.map(t => t.id)).toEqual(['a']);
    expect(timeline[0]).toMatchObject({ _startMs: 0, _endMs: 1500 });
  });

  it('treats missing duration as zero-length cue', () => {
    const segments = [
      makeSeg({ id: 'a', audio: { format: 'mp3', current: { id: 'au-a' } } }),
      makeSeg({ id: 'b', audio: { format: 'mp3', current: { id: 'au-b' }, duration_sec: 1 } }),
    ];
    const timeline = buildExportTimeline(segments, 'frontend');
    expect(timeline[0]).toMatchObject({ _startMs: 0, _endMs: 0 });
    expect(timeline[1]).toMatchObject({ _startMs: 0, _endMs: 1000 });
  });

  it('applies the global start offset', () => {
    const segments = [
      makeSeg({ id: 'a', audio: { format: 'mp3', current: { id: 'au-a' }, duration_sec: 2 } }),
    ];
    const timeline = buildExportTimeline(segments, 'frontend', 120);
    expect(timeline[0]).toMatchObject({ _startMs: 120000, _endMs: 122000 });
  });
});
