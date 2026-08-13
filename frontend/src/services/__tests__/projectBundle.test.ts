import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';

// fake-indexeddb 在 jsdom 下把 Blob 结构化克隆成空对象（现有测试仅断言非 null 故未暴露）。
// 这里用内存 Map 模拟 IndexedDB 的音频存取，聚焦 bundle 格式 round-trip 逻辑本身。
const { audioStore } = vi.hoisted(() => ({ audioStore: new Map<string, Blob>() }));

vi.mock('../indexedDB', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../indexedDB')>();
  return {
    ...actual,
    saveTTSResult: vi.fn(async (rec: { id: string; audioBlob: Blob }) => {
      audioStore.set(rec.id, rec.audioBlob);
    }),
    getTTSAudioBlob: vi.fn(async (id: string) => audioStore.get(id) ?? null),
  };
});

import { exportProjectBundle, importProjectBundle } from '../projectBundle';
import type { SegmentedProject } from '../../types';

const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]);

function seedAudio(id: string): void {
  audioStore.set(id, new Blob([MP3], { type: 'audio/mpeg' }));
}

function makeProject(): SegmentedProject {
  const now = new Date().toISOString();
  return {
    schema_version: 2,
    id: 'p-1',
    name: '测试项目',
    logo: null,
    layout: 'vertical',
    remotion_project_path: null,
    narration_script: null,
    configs: {},
    default_narrator_role_id: null,
    active_chapter_id: 'c-1',
    created_at: now,
    updated_at: now,
    chapters: [{
      id: 'c-1',
      name: '第一章',
      position: 0,
      voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' },
      split_config: { delimiters: ['，', '。'], mode: 'rule' },
      original_text: '你好世界',
      narration_script: null,
      design_title: '第一章',
      audio_adjust: null,
      segments: [
        {
          id: 'seg-1',
          text: '你好',
          voice: { source: 'chapter' },
          status: 'ready',
          audio: { current: { id: 'audio-1', duration_sec: 1.2 }, format: 'mp3' },
          position: 0,
          segment_kind: 'narration',
          role_id: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'seg-2',
          text: '世界',
          voice: { source: 'chapter' },
          status: 'ready',
          audio: { current: { id: 'audio-2', duration_sec: 1.5 }, format: 'mp3' },
          position: 1,
          segment_kind: 'narration',
          role_id: null,
          created_at: now,
          updated_at: now,
        },
      ],
      created_at: now,
      updated_at: now,
    }],
  };
}

describe('projectBundle export/import (frontend mode round-trip)', () => {
  it('exports backend-compatible zip then imports back with audio restored', async () => {
    seedAudio('audio-1');
    seedAudio('audio-2');

    const zip = await exportProjectBundle(makeProject());
    expect(zip.type).toBe('application/zip');
    expect(zip.size).toBeGreaterThan(0);

    const imported = await importProjectBundle(await zip.arrayBuffer());

    // 新项目生成新 ID，不覆盖原项目
    expect(imported.id).not.toBe('p-1');
    expect(imported.name).toBe('测试项目');
    expect(imported.chapters).toHaveLength(1);
    expect(imported.chapters[0].name).toBe('第一章');
    expect(imported.chapters[0].original_text).toBe('你好世界');
    expect(imported.chapters[0].segments).toHaveLength(2);

    const segs = imported.chapters[0].segments;
    expect(segs[0].text).toBe('你好');
    expect(segs[0].status).toBe('ready');
    expect(segs[1].text).toBe('世界');

    // 音频恢复：audio.current.id 指向新写入的 IndexedDB 记录，内容与源一致
    const audioId = segs[0].audio.current?.id;
    expect(audioId).toBeTruthy();
    expect(audioId).not.toBe('audio-1'); // 导入生成新音频 id
    const blob = audioStore.get(audioId!);
    expect(blob).toBeDefined();
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(MP3);

    // 段引用关系：chapter_id 已重映射到新章节
    const newChapterIds = imported.chapters.map(c => c.id);
    expect(newChapterIds).not.toContain('c-1');
    expect(imported.active_chapter_id).toBe(imported.chapters[0].id);
  });

  it('imports a bundle exported without audio (missing blob) as idle segments', async () => {
    // audio-3 不种音频 → 导出时标记 missing，导入后段为 idle、无 audio.current
    const proj = makeProject();
    proj.chapters[0].segments[1].audio = { current: { id: 'audio-3' }, format: 'mp3' };
    const zip = await exportProjectBundle(proj);
    const imported = await importProjectBundle(await zip.arrayBuffer());

    const segs = imported.chapters[0].segments;
    expect(segs[0].status).toBe('ready'); // audio-1 存在
    expect(segs[1].status).toBe('idle');  // audio-3 缺失 → 段无音频
    expect(segs[1].audio.current?.id).toBeUndefined();
  });

  it('rejects unsupported bundle_version', async () => {
    const { strToU8, zipSync } = await import('fflate');
    const bad = zipSync({ 'manifest.json': strToU8(JSON.stringify({ bundle_version: 99, project: {}, chapters: [], segments: [] })) });
    await expect(importProjectBundle(bad.buffer as ArrayBuffer)).rejects.toThrow('unsupported bundle_version');
  });
});
