import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import type { Segment } from '../../types';

// fake-indexeddb 在 jsdom 下把 Blob 回读成空对象，音频存取用内存 Map 模拟
const { audioStore } = vi.hoisted(() => ({ audioStore: new Map<string, Blob>() }));

vi.mock('../indexedDB', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../indexedDB')>();
  return {
    ...actual,
    saveTTSResult: vi.fn(async () => {}),
    getTTSAudioBlob: vi.fn(async (id: string) => audioStore.get(id) ?? null),
  };
});

import { exportChapterToFolder } from '../exportToFolder';

const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);

function makeSegment(id: string, text: string, audioId: string | undefined, position: number): Segment {
  const now = new Date().toISOString();
  return {
    id, text,
    voice: { source: 'chapter' },
    status: audioId ? 'ready' : 'idle',
    audio: audioId ? { current: { id: audioId, duration_sec: 1.0 }, format: 'mp3' } : { format: 'mp3' },
    position,
    segment_kind: 'narration',
    role_id: null,
    created_at: now,
    updated_at: now,
  };
}

describe('exportChapterToFolder', () => {
  it('writes per-segment audio + srt into the picked directory', async () => {
    audioStore.set('a-1', new Blob([MP3], { type: 'audio/mpeg' }));

    const written = new Map<string, Blob>();
    const dirHandle = {
      getFileHandle: async (name: string) => ({
        createWritable: async () => ({
          write: async (data: Blob) => { written.set(name, data); },
          close: async () => {},
        }),
      }),
    };
    // @ts-expect-error - 测试注入 showDirectoryPicker
    window.showDirectoryPicker = vi.fn().mockResolvedValue(dirHandle);

    const segs = [
      makeSegment('s-1', '你好世界', 'a-1', 0),
      makeSegment('s-2', '缺音频', 'missing-1', 1), // ready 但 IndexedDB 无此音频 → 跳过
    ];

    const result = await exportChapterToFolder(segs, '第一章', { includeSrt: true });

    expect(result.usedDirectoryPicker).toBe(true);
    expect(result.audioFiles).toBe(1);   // 只有一段有音频
    expect(result.skipped).toBe(1);      // 缺音频段跳过
    expect(result.srtWritten).toBe(true);

    // 文件写入目录：一段 mp3 + 一个 srt
    const names = [...written.keys()];
    expect(names.some(n => n.endsWith('.mp3'))).toBe(true);
    expect(names.some(n => n.endsWith('.srt'))).toBe(true);
    const mp3File = written.get(names.find(n => n.endsWith('.mp3'))!)!;
    expect(new Uint8Array(await mp3File.arrayBuffer())).toEqual(MP3);
  });

  it('falls back to downloads when showDirectoryPicker is unavailable', async () => {
    audioStore.set('a-2', new Blob([MP3], { type: 'audio/mpeg' }));

    // @ts-expect-error - 移除 picker（模拟 Safari/Firefox）
    delete window.showDirectoryPicker;
    // jsdom 无 URL.createObjectURL / 点击真实 a 元素：注入 mock URL + 记录 download 名
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:fake'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });

    const downloads: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        const a = el as HTMLAnchorElement;
        a.click = () => { downloads.push(a.download); };
      }
      return el;
    });

    const result = await exportChapterToFolder([makeSegment('s-3', '你好', 'a-2', 0)], '第二章');

    expect(result.usedDirectoryPicker).toBe(false);
    expect(result.audioFiles).toBe(1);
    expect(downloads.some(n => n.endsWith('.mp3'))).toBe(true);
  });
});
