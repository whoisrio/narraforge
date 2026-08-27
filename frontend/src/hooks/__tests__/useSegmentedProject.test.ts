import { describe, it, expect } from 'vitest';
import type { SegmentedProject, Chapter, Segment } from '../../types';
import type { RawSegmentedProject } from '../useSegmentedProject';
import { segmentedReducer, createInitialProject, migrateV1 } from '../useSegmentedProject';

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  const now = new Date().toISOString();
  return {
    id: 'ch1', name: '第一章',
    voice: { engine: 'cosyvoice', voice_id: '', speed: 1, volume: 80, pitch: 1, language: 'Chinese' },
    segments: [],
    split_config: { delimiters: ['，', '。'], mode: 'rule' },
    created_at: now, updated_at: now,
    ...overrides,
  };
}

function makeProject(overrides: Partial<SegmentedProject> = {}, chapterOverrides?: Partial<Chapter>): SegmentedProject {
  const now = new Date().toISOString();
  const ch = makeChapter(chapterOverrides);
  return {
    schema_version: 2, id: 'p1', name: 'Test',
    chapters: [ch], active_chapter_id: ch.id,
    layout: 'vertical',
    created_at: now, updated_at: now,
    ...overrides,
  };
}

// Helper to get active chapter from project
function ac(p: SegmentedProject): Chapter {
  return p.chapters.find(c => c.id === p.active_chapter_id) || p.chapters[0];
}

describe('segmentedReducer', () => {
  it('APPLY_SPLIT replaces segments with idle status', () => {
    const p = makeProject({}, {
      segments: [
        { id: 'old', text: 'old', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration', status: 'ready', created_at: '', updated_at: '' },
      ],
    });
    const next = segmentedReducer({ project: p }, { type: 'APPLY_SPLIT', items: [{ text: 'a' }, { text: 'b' }] });
    expect(ac(next.project).segments).toHaveLength(2);
    expect(ac(next.project).segments[0].text).toBe('a');
    expect(ac(next.project).segments[0].status).toBe('idle');
    expect(ac(next.project).selected_segment_id).toBeUndefined();
  });

  it('APPLY_SPLIT preserves inferred segment kind and role', () => {
    const next = segmentedReducer({ project: makeProject() }, {
      type: 'APPLY_SPLIT',
      items: [{
        text: '嘉宾A：你好',
        segment_kind: 'dialogue',
        role_id: 'role-guest-a',
        role_snapshot: { id: 'role-guest-a', name: '嘉宾A', default_engine: 'edge_tts', default_voice: 'Yunyang', default_engine_params: { engine: 'edge_tts', edge_voice: 'zh-CN-YunyangNeural' }, favorite_styles: [] },
      }],
    });

    const seg = ac(next.project).segments[0];
    expect(seg.text).toBe('嘉宾A：你好');
    expect(seg.segment_kind).toBe('dialogue');
    expect(seg.role_id).toBe('role-guest-a');
    // voice reflects role assignment
    expect(seg.voice.source).toBe('role');
  });

  it('APPEND_SEGMENT appends with default_params', () => {
    const next = segmentedReducer({ project: makeProject() }, { type: 'APPEND_SEGMENT', text: 'hello' });
    expect(ac(next.project).segments).toHaveLength(1);
    expect(ac(next.project).segments[0].text).toBe('hello');
    expect(ac(next.project).segments[0].voice.source).toBe('chapter');
  });

  it('INSERT_SEGMENT inserts after given id', () => {
    const p = makeProject({}, {
      segments: [
        { id: 'a', text: 'a', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' },
        { id: 'c', text: 'c', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' },
      ],
    });
    const next = segmentedReducer({ project: p }, { type: 'INSERT_SEGMENT', afterId: 'a', text: 'b' });
    expect(ac(next.project).segments.map(s => s.text)).toEqual(['a', 'b', 'c']);
  });

  it('DELETE_SEGMENT removes the segment and deselects if it was selected', () => {
    const s1: Segment = { id: 'a', text: 'a', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' };
    const s2: Segment = { id: 'b', text: 'b', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' };
    const p = makeProject({}, { segments: [s1, s2], selected_segment_id: 'a' });
    const next = segmentedReducer({ project: p }, { type: 'DELETE_SEGMENT', id: 'a' });
    expect(ac(next.project).segments).toHaveLength(1);
    expect(ac(next.project).selected_segment_id).toBeUndefined();
  });

  it('DELETE_SEGMENTS removes multiple segments and deselects if it was selected', () => {
    const mk = (id: string): Segment => ({ id, text: id, voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' });
    const p = makeProject({}, { segments: [mk('a'), mk('b'), mk('c'), mk('d')], selected_segment_id: 'c' });
    const next = segmentedReducer({ project: p }, { type: 'DELETE_SEGMENTS', ids: ['b', 'c'] });
    expect(ac(next.project).segments.map(s => s.id)).toEqual(['a', 'd']);
    expect(ac(next.project).selected_segment_id).toBeUndefined();
  });

  it('DELETE_SEGMENTS keeps selection when the selected segment is not deleted', () => {
    const mk = (id: string): Segment => ({ id, text: id, voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' });
    const p = makeProject({}, { segments: [mk('a'), mk('b')], selected_segment_id: 'a' });
    const next = segmentedReducer({ project: p }, { type: 'DELETE_SEGMENTS', ids: ['b'] });
    expect(ac(next.project).segments.map(s => s.id)).toEqual(['a']);
    expect(ac(next.project).selected_segment_id).toBe('a');
  });

  it('REORDER moves segment from fromIndex to toIndex', () => {
    const segments: Segment[] = [
      { id: 'a', text: 'a', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' },
      { id: 'b', text: 'b', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' },
      { id: 'c', text: 'c', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' },
    ];
    const p = makeProject({}, { segments });
    const next = segmentedReducer({ project: p }, { type: 'REORDER', fromIndex: 2, toIndex: 0 });
    expect(ac(next.project).segments.map(s => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('REORDER renumbers segment positions to match the new array order', () => {
    // Backend trusts `position` on save (falls back to array index only when null).
    // Stale positions would silently revert a reorder, so the reducer must renumber.
    const segments: Segment[] = [
      { id: 'a', text: 'a', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '', position: 0 },
      { id: 'b', text: 'b', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '', position: 1 },
      { id: 'c', text: 'c', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '', position: 2 },
    ];
    const p = makeProject({}, { segments });
    const next = segmentedReducer({ project: p }, { type: 'REORDER', fromIndex: 2, toIndex: 0 });
    expect(ac(next.project).segments.map(s => s.position)).toEqual([0, 1, 2]);
  });

  it('MOVE_CHAPTER moves a chapter up and renumbers positions', () => {
    const now = new Date().toISOString();
    const chapters: Chapter[] = [
      { id: 'ch-a', name: 'A', voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, segments: [], split_config: { delimiters: ['。'], mode: 'rule' }, created_at: now, updated_at: now, position: 0 },
      { id: 'ch-b', name: 'B', voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, segments: [], split_config: { delimiters: ['。'], mode: 'rule' }, created_at: now, updated_at: now, position: 1 },
      { id: 'ch-c', name: 'C', voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, segments: [], split_config: { delimiters: ['。'], mode: 'rule' }, created_at: now, updated_at: now, position: 2 },
    ];
    const p: SegmentedProject = { schema_version: 2, id: 'p1', name: 'Test', chapters, active_chapter_id: 'ch-c', layout: 'vertical', created_at: now, updated_at: now };
    const next = segmentedReducer({ project: p }, { type: 'MOVE_CHAPTER', id: 'ch-c', direction: 'up' });
    expect(next.project.chapters.map(c => c.id)).toEqual(['ch-a', 'ch-c', 'ch-b']);
    expect(next.project.chapters.map(c => c.position)).toEqual([0, 1, 2]);
  });

  it('MOVE_CHAPTER moves a chapter down and renumbers positions', () => {
    const now = new Date().toISOString();
    const chapters: Chapter[] = [
      { id: 'ch-a', name: 'A', voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, segments: [], split_config: { delimiters: ['。'], mode: 'rule' }, created_at: now, updated_at: now, position: 0 },
      { id: 'ch-b', name: 'B', voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, segments: [], split_config: { delimiters: ['。'], mode: 'rule' }, created_at: now, updated_at: now, position: 1 },
    ];
    const p: SegmentedProject = { schema_version: 2, id: 'p1', name: 'Test', chapters, active_chapter_id: 'ch-a', layout: 'vertical', created_at: now, updated_at: now };
    const next = segmentedReducer({ project: p }, { type: 'MOVE_CHAPTER', id: 'ch-a', direction: 'down' });
    expect(next.project.chapters.map(c => c.id)).toEqual(['ch-b', 'ch-a']);
    expect(next.project.chapters.map(c => c.position)).toEqual([0, 1]);
  });

  it('MOVE_CHAPTER is a no-op at the top/bottom boundary', () => {
    const now = new Date().toISOString();
    const chapters: Chapter[] = [
      { id: 'ch-a', name: 'A', voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, segments: [], split_config: { delimiters: ['。'], mode: 'rule' }, created_at: now, updated_at: now, position: 0 },
      { id: 'ch-b', name: 'B', voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, segments: [], split_config: { delimiters: ['。'], mode: 'rule' }, created_at: now, updated_at: now, position: 1 },
    ];
    const p: SegmentedProject = { schema_version: 2, id: 'p1', name: 'Test', chapters, active_chapter_id: 'ch-a', layout: 'vertical', created_at: now, updated_at: now };
    const up = segmentedReducer({ project: p }, { type: 'MOVE_CHAPTER', id: 'ch-a', direction: 'up' });
    expect(up.project.chapters.map(c => c.id)).toEqual(['ch-a', 'ch-b']);
    const down = segmentedReducer({ project: p }, { type: 'MOVE_CHAPTER', id: 'ch-b', direction: 'down' });
    expect(down.project.chapters.map(c => c.id)).toEqual(['ch-a', 'ch-b']);
  });

  it('GENERATE_SUCCESS sets audio on segment', () => {
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'mp3', current: { id: 'old_current' }, previous: { id: 'old_prev' } }, segment_kind: 'narration', status: 'pending',
      created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s] }) }, {
      type: 'GENERATE_SUCCESS', id: 's1', audio_id: 'new_audio', duration_sec: 3.2,
    });
    const seg = ac(next.project).segments[0];
    expect(seg.status).toBe('ready');
    expect(seg.audio.current?.id).toBe('new_audio');
    expect(seg.audio.previous?.id).toBe('old_current');
    expect(seg.audio.duration_sec).toBe(3.2);
  });

  it('GENERATE_SUCCESS updates a segment in a NON-active chapter (backend mode)', () => {
    // 回归：合成可以发生在任意章节（全项目查找），此前 GENERATE_SUCCESS 只更新
    // active chapter，非活动章节的合成结果不进 state → 自动保存 PUT 用旧值覆盖
    // 后端并删除磁盘文件（"合成成功但播放 404"）。
    const mk = (id: string): Segment => ({ id, text: id, voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'pending', created_at: '', updated_at: '' });
    const ch1 = makeChapter({ id: 'ch-a', segments: [mk('active-seg')] });
    const ch2 = makeChapter({ id: 'ch-b', segments: [mk('other-seg')] });
    const p = makeProject({ chapters: [ch1, ch2], active_chapter_id: 'ch-a' });
    const next = segmentedReducer({ project: p }, {
      type: 'GENERATE_SUCCESS', id: 'other-seg',
      current_audio_path: 'projects/p1/ch-b/segments/other-seg.mp3', duration_sec: 2.5, origin: 'tts',
    });
    // 非活动章节的 segment 被正确更新（修复前静默丢失）
    const seg = next.project.chapters.find(c => c.id === 'ch-b')!.segments[0];
    expect(seg.status).toBe('ready');
    expect(seg.audio.current).toEqual({ path: 'projects/p1/ch-b/segments/other-seg.mp3', origin: 'tts', duration_sec: 2.5 });
    // 活动章节不受影响
    const activeSeg = next.project.chapters.find(c => c.id === 'ch-a')!.segments[0];
    expect(activeSeg.status).toBe('pending');
    // project 被重建（updated_at 由 updateChapter 重新生成，触发自动保存的前提）
    expect(next.project).not.toBe(p);
  });

  it('GENERATE_SUCCESS with unknown id returns project unchanged (no empty save)', () => {
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'pending', created_at: '', updated_at: '' };
    const p = makeProject({}, { segments: [s] });
    const next = segmentedReducer({ project: p }, { type: 'GENERATE_SUCCESS', id: 'no-such-seg', current_audio_path: 'x.mp3' });
    expect(next.project).toBe(p);
  });

  it('GENERATE_START 不 bump 项目 updated_at（纯 UI 状态，不触发自动保存）', () => {
    // 回归：pending 是纯 UI 状态（后端不存 status），若 bump updated_at 会触发
    // 整包自动保存 PUT，该 PUT 被后端写锁序列化到合成提交之后落库，用合成前
    // 旧值覆盖新音频元数据（"合成成功但播放 404"）。
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' };
    const p = makeProject({ updated_at: '2026-01-01T00:00:00.000Z' }, { segments: [s] });
    const next = segmentedReducer({ project: p }, { type: 'GENERATE_START', id: 's1' });
    expect(ac(next.project).segments[0].status).toBe('pending');
    expect(next.project.updated_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('GENERATE_SUCCESS bump 项目 updated_at（新音频需要自动保存）', () => {
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'pending', created_at: '', updated_at: '' };
    const p = makeProject({ updated_at: '2026-01-01T00:00:00.000Z' }, { segments: [s] });
    const next = segmentedReducer({ project: p }, {
      type: 'GENERATE_SUCCESS', id: 's1', current_audio_path: 'x/s1.mp3', duration_sec: 1.5,
    });
    expect(next.project.updated_at).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('UNDO_REGENERATE swaps current and previous audio', () => {
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'mp3', current: { id: 'c' }, previous: { id: 'p' } }, segment_kind: 'narration', status: 'ready',
      created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s] }) }, { type: 'UNDO_REGENERATE', id: 's1' });
    expect(ac(next.project).segments[0].audio.current?.id).toBe('p');
    expect(ac(next.project).segments[0].audio.previous?.id).toBe('c');
  });

  it('UNDO_REGENERATE swaps origin along with current/previous audio', () => {
    // force 重合成后：current 是新 TTS（origin 'tts'），previous 是被降级的录音（origin 'recorded'）
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'mp3',
      current: { id: 'tts_new', origin: 'tts' }, previous: { id: 'rec_old', origin: 'recorded' } },
      segment_kind: 'narration', status: 'ready', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s] }) }, { type: 'UNDO_REGENERATE', id: 's1' });
    const seg = ac(next.project).segments[0];
    expect(seg.audio.current).toEqual({ id: 'rec_old', origin: 'recorded' });
    expect(seg.audio.previous).toEqual({ id: 'tts_new', origin: 'tts' });
  });

  it('RECORD_SUCCESS sets recorded origin and demotes existing audio to previous', () => {
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'mp3',
      current: { id: 'tts_1', origin: 'tts', duration_sec: 2 } },
      segment_kind: 'narration', status: 'ready', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s] }) }, {
      type: 'RECORD_SUCCESS', id: 's1', audio_id: 'rec_1', duration_sec: 1.5, audio_format: 'webm',
    });
    const seg = ac(next.project).segments[0];
    expect(seg.status).toBe('ready');
    expect(seg.audio.current).toEqual({ id: 'rec_1', origin: 'recorded', duration_sec: 1.5 });
    expect(seg.audio.previous).toEqual({ id: 'tts_1', origin: 'tts', duration_sec: 2 });
    expect(seg.audio.format).toBe('webm');
    expect(seg.audio.duration_sec).toBe(1.5);
  });

  it('RECORD_SUCCESS supports backend-mode audio path ref', () => {
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'mp3' },
      segment_kind: 'narration', status: 'idle', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s] }) }, {
      type: 'RECORD_SUCCESS', id: 's1', audio_path: 'projects/p1/ch1/s1.webm', duration_sec: 3,
    });
    const seg = ac(next.project).segments[0];
    expect(seg.audio.current).toEqual({ path: 'projects/p1/ch1/s1.webm', origin: 'recorded', duration_sec: 3 });
    expect(seg.audio.previous).toBeUndefined();
    expect(seg.status).toBe('ready');
  });

  it('UNLOCK_SEGMENT_AUDIO clears origin marker but keeps the audio ref', () => {
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'webm',
      current: { id: 'rec_1', origin: 'recorded', duration_sec: 1.5 } },
      segment_kind: 'narration', status: 'ready', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s] }) }, { type: 'UNLOCK_SEGMENT_AUDIO', id: 's1' });
    const seg = ac(next.project).segments[0];
    expect(seg.audio.current?.origin).toBeUndefined();
    expect(seg.audio.current?.id).toBe('rec_1');
    expect(seg.audio.current?.duration_sec).toBe(1.5);
  });

  it('GENERATE_SUCCESS applies origin payload and keeps demoted recording origin on previous', () => {
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'webm',
      current: { path: 'old.webm', origin: 'recorded' } },
      segment_kind: 'narration', status: 'pending', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s] }) }, {
      type: 'GENERATE_SUCCESS', id: 's1',
      current_audio_path: 'new.mp3', previous_audio_path: 'old.webm', duration_sec: 2, origin: 'tts',
    });
    const seg = ac(next.project).segments[0];
    expect(seg.audio.current).toEqual({ path: 'new.mp3', origin: 'tts', duration_sec: 2 });
    // previous_audio_path 覆盖分支必须保留被降级录音的 origin
    expect(seg.audio.previous).toEqual({ path: 'old.webm', origin: 'recorded' });
  });

  it('UPDATE_TEXT changes text', () => {
    const s: Segment = { id: 's1', text: 'old', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s] }) }, { type: 'UPDATE_TEXT', id: 's1', text: 'new' });
    expect(ac(next.project).segments[0].text).toBe('new');
  });

  it('APPLY_SERVER_SEGMENT 用服务端段数据覆盖本地字段且不 bump 项目 updated_at', () => {
    const s: Segment = { id: 's1', text: 'local', voice: { source: 'chapter' }, audio: { format: 'mp3', current: { path: 'x.mp3' } }, segment_kind: 'narration' as const, status: 'ready', created_at: '', updated_at: '' };
    const before = makeProject({ updated_at: '2026-08-27T00:00:00.000Z' }, { segments: [s] });
    const serverSeg = {
      id: 's1', text: 'server', emotion: 'happy', role_id: 'r1', segment_kind: 'dialogue',
      voice: { source: 'role', role_id: 'r1' },
      audio: { format: 'mp3', current: null, previous: { path: 'x.mp3' } },
    };
    const next = segmentedReducer({ project: before }, { type: 'APPLY_SERVER_SEGMENT', id: 's1', segment: serverSeg });
    const seg = ac(next.project).segments[0];
    expect(seg.text).toBe('server');
    expect(seg.emotion).toBe('happy');
    expect(seg.role_id).toBe('r1');
    expect(seg.segment_kind).toBe('dialogue');
    expect(seg.voice.source).toBe('role');
    expect(seg.audio.current).toBeUndefined();
    expect(seg.audio.previous).toEqual({ path: 'x.mp3' });
    // 服务端清了音频 → 本地状态回 idle
    expect(seg.status).toBe('idle');
    expect(next.project.updated_at).toBe('2026-08-27T00:00:00.000Z');
  });

  it('UPDATE_TEXT with touch=false 不 bump 项目 updated_at（远端 PATCH 已持久化）', () => {
    const s: Segment = { id: 's1', text: 'old', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' };
    const before = makeProject({ updated_at: '2026-08-27T00:00:00.000Z' }, { segments: [s] });
    const next = segmentedReducer({ project: before }, { type: 'UPDATE_TEXT', id: 's1', text: 'new', touch: false });
    expect(ac(next.project).segments[0].text).toBe('new');
    expect(next.project.updated_at).toBe('2026-08-27T00:00:00.000Z');
  });

  it('SET_SEGMENT_ROLE with touch=false 不 bump 项目 updated_at', () => {
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' };
    const before = makeProject({ updated_at: '2026-08-27T00:00:00.000Z' }, { segments: [s] });
    const roleSnapshot = { id: 'r1', name: '角色A', default_engine: 'edge_tts', default_voice: 'Yunyang', default_engine_params: { engine: 'edge_tts' }, favorite_styles: [] };
    const next = segmentedReducer({ project: before }, { type: 'SET_SEGMENT_ROLE', id: 's1', roleId: 'r1', roleSnapshot, touch: false });
    expect(ac(next.project).segments[0].role_id).toBe('r1');
    expect(next.project.updated_at).toBe('2026-08-27T00:00:00.000Z');
  });

  it('UPDATE_PARAMS sets voice to custom', () => {
    const s: Segment = {
      id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration',
      status: 'idle', created_at: '', updated_at: '',
    };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s] }) }, {
      type: 'UPDATE_PARAMS', id: 's1', params: { voice_id: 'segment-voice' },
    });
    const seg = ac(next.project).segments[0];
    expect(seg.voice.source).toBe('custom');
  });

  it('BATCH_SET_SSML is a no-op in V3 (SSML not stored on segment)', () => {
    const s1: Segment = { id: 'a', text: 'a', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration', status: 'idle', created_at: '', updated_at: '' };
    const s2: Segment = { id: 'b', text: 'b', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration', status: 'idle', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s1, s2] }) }, {
      type: 'BATCH_SET_SSML', updates: [
        { id: 'a', ssml: '<speak>a</speak>' },
        { id: 'b', ssml: '<speak>b</speak>' },
      ], by_llm: true,
    });
    // BATCH_SET_SSML is a no-op in V3 - segments should remain unchanged
    expect(ac(next.project).segments[0].text).toBe('a');
    expect(ac(next.project).segments[1].text).toBe('b');
  });

  it('GENERATE_FAIL sets failed status and error', () => {
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'pending', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s] }) }, { type: 'GENERATE_FAIL', id: 's1', error: 'timeout' });
    expect(ac(next.project).segments[0].status).toBe('failed');
    expect(ac(next.project).segments[0].error).toBe('timeout');
  });

  it('GENERATE_FAIL marks a NON-active chapter segment as failed', () => {
    const mk = (id: string): Segment => ({ id, text: id, voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'pending', created_at: '', updated_at: '' });
    const ch1 = makeChapter({ id: 'ch-a', segments: [mk('active-seg')] });
    const ch2 = makeChapter({ id: 'ch-b', segments: [mk('other-seg')] });
    const p = makeProject({ chapters: [ch1, ch2], active_chapter_id: 'ch-a' });
    const next = segmentedReducer({ project: p }, { type: 'GENERATE_FAIL', id: 'other-seg', error: 'boom' });
    const seg = next.project.chapters.find(c => c.id === 'ch-b')!.segments[0];
    expect(seg.status).toBe('failed');
    expect(seg.error).toBe('boom');
  });

  it('MARK_QUEUED marks idle segments across chapters (not just active)', () => {
    const mk = (id: string, status: Segment['status']): Segment => ({ id, text: id, voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status, created_at: '', updated_at: '' });
    const ch1 = makeChapter({ id: 'ch-a', segments: [mk('a1', 'idle')] });
    const ch2 = makeChapter({ id: 'ch-b', segments: [mk('b1', 'idle'), mk('b2', 'ready')] });
    const p = makeProject({ chapters: [ch1, ch2], active_chapter_id: 'ch-a' });
    const next = segmentedReducer({ project: p }, { type: 'MARK_QUEUED', ids: ['a1', 'b1', 'b2'] });
    expect(next.project.chapters.find(c => c.id === 'ch-a')!.segments[0].status).toBe('queued');
    expect(next.project.chapters.find(c => c.id === 'ch-b')!.segments[0].status).toBe('queued');
    // 非 idle 的 segment 不受影响
    expect(next.project.chapters.find(c => c.id === 'ch-b')!.segments[1].status).toBe('ready');
  });

  it('SELECT_SEGMENT sets selected_segment_id', () => {
    const next = segmentedReducer({ project: makeProject() }, { type: 'SELECT_SEGMENT', id: 'abc' });
    expect(ac(next.project).selected_segment_id).toBe('abc');
    const next2 = segmentedReducer({ project: makeProject() }, { type: 'SELECT_SEGMENT', id: undefined });
    expect(ac(next2.project).selected_segment_id).toBeUndefined();
  });

  it('RENAME_PROJECT sets name', () => {
    const next = segmentedReducer({ project: makeProject({ name: 'Old' }) }, { type: 'RENAME_PROJECT', name: 'New' });
    expect(next.project.name).toBe('New');
  });

  it('SET_PROJECT_META routes description & export_directory into configs (not top-level)', () => {
    const base = makeProject();
    // remotion_project_path stays top-level; description/export_directory go into configs.
    const step1 = segmentedReducer({ project: base }, {
      type: 'SET_PROJECT_META',
      meta: { remotion_project_path: '/tmp/remotion', description: 'hello', export_directory: 'public/audio', underscore_to_space: true, skip_parenthesized: true },
    });
    expect(step1.project.remotion_project_path).toBe('/tmp/remotion');
    expect(step1.project.configs?.description).toBe('hello');
    expect(step1.project.configs?.export_directory).toBe('public/audio');
    expect(step1.project.configs?.underscore_to_space).toBe(true);
    expect(step1.project.configs?.skip_parenthesized).toBe(true);
    // No legacy top-level fields leak through.
    expect((step1.project as unknown as Record<string, unknown>).description).toBeUndefined();
    expect((step1.project as unknown as Record<string, unknown>).export_directory).toBeUndefined();

    // Existing configs keys (like split_voice_mode) must be preserved on partial update.
    const step2 = segmentedReducer(step1, {
      type: 'SET_PROJECT_META',
      meta: { description: null },
    });
    expect(step2.project.configs?.description).toBeNull();
    expect(step2.project.configs?.export_directory).toBe('public/audio');
    expect(step2.project.configs?.underscore_to_space).toBe(true);
    expect(step2.project.configs?.skip_parenthesized).toBe(true);
    expect(step2.project.remotion_project_path).toBe('/tmp/remotion');
  });

  it('SET_LAYOUT changes layout', () => {
    const next = segmentedReducer({ project: makeProject() }, { type: 'SET_LAYOUT', layout: 'horizontal' });
    expect(next.project.layout).toBe('horizontal');
  });

  it('createInitialProject generates a valid v2 SegmentedProject', () => {
    const p = createInitialProject();
    expect(p.id).toBeTruthy();
    expect(p.schema_version).toBe(2);
    expect(p.chapters).toHaveLength(1);
    expect(p.chapters[0].segments).toEqual([]);
    expect(p.active_chapter_id).toBe(p.chapters[0].id);
    // 默认拆分选项：除“、”外全选
    expect(p.chapters[0].split_config.delimiters).toEqual(['，', '。', '！', '？', '；']);
  });

  it('ADD_CHAPTER creates a new chapter, sets it active, and inherits split_config', () => {
    const p = makeProject();
    const next = segmentedReducer({ project: p }, { type: 'ADD_CHAPTER', name: '第二章' });
    expect(next.project.chapters).toHaveLength(2);
    expect(next.project.chapters[1].name).toBe('第二章');
    expect(next.project.active_chapter_id).toBe(next.project.chapters[1].id);
    // 新章继承活动章节的 split_config（默认源头在 createInitialProject / 后端建章）
    expect(next.project.chapters[1].split_config).toEqual(p.chapters[0].split_config);
  });

  it('SET_ALL_CHAPTERS_PARAMS applies voice params to every chapter, not just the active one', () => {
    const ch2 = makeChapter({ id: 'ch2', name: '第二章', voice: { engine: 'edge_tts', voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%', volume: '+0%' } });
    const p = makeProject({ chapters: [makeChapter(), ch2] });
    const params = { engine: 'mimo_tts', mode: 'preset', voice_id: '冰糖' } as Chapter['voice'];
    const next = segmentedReducer({ project: p }, { type: 'SET_ALL_CHAPTERS_PARAMS', params });
    expect(next.project.chapters).toHaveLength(2);
    for (const ch of next.project.chapters) {
      expect(ch.voice).toEqual(params);
    }
    // active chapter 不变
    expect(next.project.active_chapter_id).toBe(p.active_chapter_id);
  });

  it('DELETE_CHAPTER removes chapter and switches active', () => {
    const ch1 = makeChapter({ id: 'ch1', name: '第一章' });
    const ch2 = makeChapter({ id: 'ch2', name: '第二章' });
    const p: SegmentedProject = { schema_version: 2, id: 'p1', name: 'Test', chapters: [ch1, ch2], active_chapter_id: 'ch1', layout: 'vertical', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: p }, { type: 'DELETE_CHAPTER', id: 'ch1' });
    expect(next.project.chapters).toHaveLength(1);
    expect(next.project.chapters[0].id).toBe('ch2');
    expect(next.project.active_chapter_id).toBe('ch2');
  });

  it('DELETE_CHAPTER refuses to delete last chapter', () => {
    const p = makeProject();
    const next = segmentedReducer({ project: p }, { type: 'DELETE_CHAPTER', id: p.chapters[0].id });
    expect(next.project.chapters).toHaveLength(1);
  });

  it('SELECT_CHAPTER switches active chapter', () => {
    const ch1 = makeChapter({ id: 'ch1' });
    const ch2 = makeChapter({ id: 'ch2' });
    const p: SegmentedProject = { schema_version: 2, id: 'p1', name: 'Test', chapters: [ch1, ch2], active_chapter_id: 'ch1', layout: 'vertical', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: p }, { type: 'SELECT_CHAPTER', id: 'ch2' });
    expect(next.project.active_chapter_id).toBe('ch2');
  });

  it('SET_CHAPTER_META_BY_ID updates the requested chapter without relying on active chapter', () => {
    const ch1 = makeChapter({ id: 'ch1', original_text: '第一章旧文本' });
    const ch2 = makeChapter({ id: 'ch2', original_text: '第二章旧文本' });
    const p: SegmentedProject = { schema_version: 2, id: 'p1', name: 'Test', chapters: [ch1, ch2], active_chapter_id: 'ch1', layout: 'vertical', created_at: '', updated_at: '' };

    const next = segmentedReducer({ project: p }, {
      type: 'SET_CHAPTER_META_BY_ID',
      id: 'ch2',
      meta: { original_text: '第二章来自文本库的新文本', design_title: '第二章视觉标题' },
    });

    expect(next.project.active_chapter_id).toBe('ch1');
    expect(next.project.chapters.find(chapter => chapter.id === 'ch1')?.original_text).toBe('第一章旧文本');
    expect(next.project.chapters.find(chapter => chapter.id === 'ch2')?.original_text).toBe('第二章来自文本库的新文本');
    expect(next.project.chapters.find(chapter => chapter.id === 'ch2')?.design_title).toBe('第二章视觉标题');
  });

  it('migrateV1 converts old project to v2 with chapters', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v1: any = {
      voice: { engine: 'edge_tts', voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%', volume: '+0%' },
      schema_version: 1, id: 'old', name: 'Old Project',
      segments: [{ id: 's1', text: 'hello', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' }],
      split_config: { delimiters: ['，'], mode: 'rule' },
      created_at: '', updated_at: '',
    };
    const migrated = migrateV1(v1);
    expect(migrated.schema_version).toBe(2);
    expect(migrated.chapters).toHaveLength(1);
    expect(migrated.chapters[0].segments).toHaveLength(1);
    expect(migrated.chapters[0].segments[0].text).toBe('hello');
    expect(migrated.chapters[0].voice.engine).toBe('edge_tts');
    expect(migrated.chapters[0].voice.voice).toBe('zh-CN-XiaoxiaoNeural');
    expect(migrated.active_chapter_id).toBe(migrated.chapters[0].id);
  });

  it('LOAD_PROJECT migrates v1 data automatically', () => {
    const v1: RawSegmentedProject = {
      schema_version: 1, id: 'old', name: 'Old',
      split_config: { delimiters: ['，'], mode: 'rule' },
      layout: 'vertical', created_at: '', updated_at: '',
    };
    const next = segmentedReducer({ project: createInitialProject() }, { type: 'LOAD_PROJECT', project: v1 });
    expect(next.project.schema_version).toBe(2);
    expect(next.project.chapters).toHaveLength(1);
  });

  it('SET_SEGMENT_ROLE stores role id and snapshot immutably', () => {
    const segment: Segment = {
      id: 's1', text: 'hello', params: { engine: 'edge_tts' }, status: 'idle', created_at: '', updated_at: '',
    };
    const project = makeProject({}, { segments: [segment] });
    const roleSnapshot = {
      id: 'role-linxia',
      name: '林夏',
      default_engine: 'edge_tts' as const,
      default_voice: 'zh-CN-XiaoxiaoNeural',
      default_engine_params: { engine: 'edge_tts' as const, edge_voice: 'zh-CN-XiaoxiaoNeural' },
      favorite_styles: [],
    };

    const next = segmentedReducer({ project }, {
      type: 'SET_SEGMENT_ROLE',
      id: 's1',
      roleId: 'role-linxia',
      roleSnapshot,
    });

    expect(ac(next.project).segments[0].role_id).toBe('role-linxia');
    expect(ac(next.project).segments[0].voice.source).toBe('role');
    expect(project.chapters[0].segments[0].role_id).toBeUndefined();
  });

  it('UPDATE_PROSODY_MARKS is a no-op in V3 and does not error', () => {
    const s1: Segment = { id: 's1', text: '你好世界', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration', status: 'idle', created_at: '', updated_at: '' };
    const s2: Segment = { id: 's2', text: '第二句', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration', status: 'idle', created_at: '', updated_at: '' };
    const project = makeProject({}, { segments: [s1, s2] });

    const next = segmentedReducer({ project }, {
      type: 'UPDATE_PROSODY_MARKS',
      id: 's1',
      prosodyMarks: [{ id: 'm1', start: 0, end: 2, style_tags: ['low_voice'] }],
    });

    // UPDATE_PROSODY_MARKS is a no-op in V3 — segments should remain unchanged
    expect(ac(next.project).segments[0].text).toBe('你好世界');
    expect(ac(next.project).segments[1].text).toBe('第二句');
  });

  it('SET_SEGMENT_KIND sets dialogue or narration without changing text', () => {
    const s1: Segment = { id: 's1', text: '旁白', params: { engine: 'edge_tts' }, status: 'idle', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s1] }) }, {
      type: 'SET_SEGMENT_KIND', id: 's1', segmentKind: 'narration',
    });
    expect(ac(next.project).segments[0].segment_kind).toBe('narration');
    expect(ac(next.project).segments[0].text).toBe('旁白');
  });

  it('SET_PROJECT_NARRATOR stores narrator role', () => {
    const next = segmentedReducer({ project: makeProject() }, {
      type: 'SET_PROJECT_NARRATOR',
      roleId: 'role-narrator',
    });
    expect(next.project.default_narrator_role_id).toBe('role-narrator');
  });

  it('SET_NARRATION_SCRIPT sets project-level narration_script', () => {
    const next = segmentedReducer(
      { project: makeProject() },
      { type: 'SET_NARRATION_SCRIPT', text: '# 标题\n\n正文' },
    );
    expect(next.project.narration_script).toBe('# 标题\n\n正文');
  });

  it('SET_NARRATION_SCRIPT overwrites existing narration_script', () => {
    const step1 = segmentedReducer(
      { project: makeProject() },
      { type: 'SET_NARRATION_SCRIPT', text: '旧稿' },
    );
    const step2 = segmentedReducer(step1, { type: 'SET_NARRATION_SCRIPT', text: '新稿' });
    expect(step2.project.narration_script).toBe('新稿');
  });
});

describe('voice source transitions (V3)', () => {
  it('TOGGLE_INDEPENDENT_VOICE: custom → restores role if role_id exists', () => {
    const s: Segment = {
      id: 's1', text: 'x',
      voice: { source: 'custom', engine: 'edge_tts', params: {} },
      role_id: 'role-1',
      audio: { format: 'mp3' },
      segment_kind: 'narration' as const, status: 'ready' as const,
      created_at: '', updated_at: '',
    };
    const next = segmentedReducer(
      { project: makeProject({}, { segments: [s] }) },
      { type: 'TOGGLE_INDEPENDENT_VOICE', id: 's1' },
    );
    expect(ac(next.project).segments[0].voice.source).toBe('role');
    const vs = ac(next.project).segments[0].voice as { role_id?: string };
    expect(vs.role_id).toBe('role-1');
  });

  it('TOGGLE_INDEPENDENT_VOICE: custom without role_id → chapter', () => {
    const s: Segment = {
      id: 's1', text: 'x',
      voice: { source: 'custom', engine: 'edge_tts', params: {} },
      audio: { format: 'mp3' },
      segment_kind: 'narration' as const, status: 'ready' as const,
      role_id: null, created_at: '', updated_at: '',
    };
    const next = segmentedReducer(
      { project: makeProject({}, { segments: [s] }) },
      { type: 'TOGGLE_INDEPENDENT_VOICE', id: 's1' },
    );
    expect(ac(next.project).segments[0].voice.source).toBe('chapter');
  });

  it('GENERATE_SUCCESS: does not change role source to custom', () => {
    const s: Segment = {
      id: 's1', text: 'x',
      voice: { source: 'role', role_id: 'role-1' },
      audio: { format: 'mp3' },
      segment_kind: 'narration' as const, status: 'pending' as const,
      role_id: null, created_at: '', updated_at: '',
    };
    const next = segmentedReducer(
      { project: makeProject({}, { segments: [s] }) },
      { type: 'GENERATE_SUCCESS', id: 's1', audio_id: 'a1', updated_params: { engine: 'mimo_tts' } },
    );
    expect(ac(next.project).segments[0].voice.source).toBe('role');
    expect(ac(next.project).segments[0].status).toBe('ready');
  });

  describe('MERGE_SEGMENTS', () => {
    function seg(id: string, text: string, overrides: Partial<Segment> = {}): Segment {
      return {
        id, text, voice: { source: 'chapter' }, audio: { format: 'mp3' },
        segment_kind: 'narration', status: 'idle',
        created_at: '', updated_at: '',
        ...overrides,
      };
    }

    it('merge down keeps current row, absorbs next, resets audio state', () => {
      const p = makeProject({}, {
        segments: [
          seg('a', '甲'),
          seg('b', '乙', {
            status: 'ready',
            audio: { format: 'mp3', current: { id: 'audio-b' }, duration_sec: 2.5 },
            generated_params: { engine: 'edge_tts' },
          }),
          seg('c', '丙'),
        ],
      });
      const next = segmentedReducer({ project: p }, { type: 'MERGE_SEGMENTS', id: 'b', direction: 'down' });
      const segs = ac(next.project).segments;
      expect(segs.map(s => s.id)).toEqual(['a', 'b']);
      expect(segs[1].text).toBe('乙丙');
      expect(segs[1].status).toBe('idle');
      expect(segs[1].audio.current).toBeUndefined();
      expect(segs[1].generated_params).toBeUndefined();
      expect(segs[1].duration_sec).toBeUndefined();
      expect(segs[1].current_audio_id).toBeUndefined();
      expect(segs[1].current_audio_path).toBeUndefined();
    });

    it('merge up keeps previous row, absorbs clicked row, moves selection to kept row', () => {
      const p = makeProject({}, {
        segments: [seg('a', '甲'), seg('b', '乙'), seg('c', '丙')],
        selected_segment_id: 'b',
      });
      const next = segmentedReducer({ project: p }, { type: 'MERGE_SEGMENTS', id: 'b', direction: 'up' });
      const ch = ac(next.project);
      expect(ch.segments.map(s => s.id)).toEqual(['a', 'c']);
      expect(ch.segments[0].text).toBe('甲乙');
      expect(ch.selected_segment_id).toBe('a');
    });

    it('keeps selection when the removed row was not selected', () => {
      const p = makeProject({}, {
        segments: [seg('a', '甲'), seg('b', '乙'), seg('c', '丙')],
        selected_segment_id: 'a',
      });
      const next = segmentedReducer({ project: p }, { type: 'MERGE_SEGMENTS', id: 'b', direction: 'down' });
      expect(ac(next.project).selected_segment_id).toBe('a');
    });

    it('is a no-op when either side is pending (in-flight synthesis)', () => {
      const p = makeProject({}, {
        segments: [seg('a', '甲'), seg('b', '乙', { status: 'pending' })],
      });
      const next = segmentedReducer({ project: p }, { type: 'MERGE_SEGMENTS', id: 'a', direction: 'down' });
      expect(ac(next.project).segments.map(s => s.id)).toEqual(['a', 'b']);
      expect(ac(next.project).segments[0].text).toBe('甲');
    });

    it('is a no-op when either side is queued', () => {
      const p = makeProject({}, {
        segments: [seg('a', '甲', { status: 'queued' }), seg('b', '乙')],
      });
      const next = segmentedReducer({ project: p }, { type: 'MERGE_SEGMENTS', id: 'a', direction: 'down' });
      expect(ac(next.project).segments.map(s => s.id)).toEqual(['a', 'b']);
    });

    it('rejects out-of-range merges (first row up / last row down)', () => {
      const p = makeProject({}, { segments: [seg('a', '甲'), seg('b', '乙')] });
      const up = segmentedReducer({ project: p }, { type: 'MERGE_SEGMENTS', id: 'a', direction: 'up' });
      expect(ac(up.project).segments).toHaveLength(2);
      const down = segmentedReducer({ project: p }, { type: 'MERGE_SEGMENTS', id: 'b', direction: 'down' });
      expect(ac(down.project).segments).toHaveLength(2);
    });
  });
});

describe('APPLY_SERVER_CHAPTER_SEGMENTS', () => {
  it('以服务端段列表整章回写（含音频降级），且不 bump 项目 updated_at', () => {
    const p = makeProject({}, {
      segments: [
        { id: 's1', text: '甲乙', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration', status: 'idle', created_at: '', updated_at: '' },
      ],
    });
    const before = p.updated_at;
    const next = segmentedReducer({ project: p }, {
      type: 'APPLY_SERVER_CHAPTER_SEGMENTS',
      chapterId: 'ch1',
      segments: [{
        id: 's1', text: '甲乙', position: 0,
        voice: { source: 'chapter' },
        audio: { format: 'mp3', current: null, previous: { path: 'p1/ch1/s1.mp3', format: 'mp3' } },
        generated_params: null,
      }],
    });
    const ch = next.project.chapters[0];
    expect(ch.segments).toHaveLength(1);
    expect(ch.segments[0].audio.current).toBeFalsy();
    expect(ch.segments[0].audio.previous?.path).toBe('p1/ch1/s1.mp3');
    expect(ch.segments[0].status).toBe('idle');
    expect(next.project.updated_at).toBe(before); // touch=false：不触发整包 PUT
  });

  it('章节不存在时 no-op', () => {
    const p = makeProject();
    const next = segmentedReducer({ project: p }, {
      type: 'APPLY_SERVER_CHAPTER_SEGMENTS', chapterId: 'nope', segments: [],
    });
    expect(next.project).toBe(p);
  });
});
