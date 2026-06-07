import { describe, it, expect } from 'vitest';
import { fmtSrtTime, buildSRTContent } from '../audioConcat';

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
