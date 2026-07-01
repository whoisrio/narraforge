import { describe, it, expect } from 'vitest';
import type { SegmentedProject, Chapter, Segment } from '../../types';
import type { RawSegmentedProject } from '../useSegmentedProject';
import { segmentedReducer, createInitialProject, migrateV1 } from '../useSegmentedProject';

function makeChapter(overrides: Partial<Chapter> = {}): Chapter {
  const now = new Date().toISOString();
  return {
    id: 'ch1', name: '第一章', engine: 'cosyvoice',
    segments: [],
    default_params: { engine: 'cosyvoice' },
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

  it('UNDO_REGENERATE swaps current and previous audio', () => {
    const s: Segment = { id: 's1', text: 'x', voice: { source: 'chapter' }, audio: { format: 'mp3', current: { id: 'c' }, previous: { id: 'p' } }, segment_kind: 'narration', status: 'ready',
      created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s] }) }, { type: 'UNDO_REGENERATE', id: 's1' });
    expect(ac(next.project).segments[0].audio.current?.id).toBe('p');
    expect(ac(next.project).segments[0].audio.previous?.id).toBe('c');
  });

  it('UPDATE_TEXT changes text', () => {
    const s: Segment = { id: 's1', text: 'old', voice: { source: 'chapter' }, audio: { format: 'mp3' }, segment_kind: 'narration' as const, status: 'idle', created_at: '', updated_at: '' };
    const next = segmentedReducer({ project: makeProject({}, { segments: [s] }) }, { type: 'UPDATE_TEXT', id: 's1', text: 'new' });
    expect(ac(next.project).segments[0].text).toBe('new');
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
  });

  it('ADD_CHAPTER creates a new chapter and sets it active', () => {
    const p = makeProject();
    const next = segmentedReducer({ project: p }, { type: 'ADD_CHAPTER', name: '第二章' });
    expect(next.project.chapters).toHaveLength(2);
    expect(next.project.chapters[1].name).toBe('第二章');
    expect(next.project.active_chapter_id).toBe(next.project.chapters[1].id);
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
      schema_version: 1, id: 'old', name: 'Old Project',
      segments: [{ id: 's1', text: 'hello', params: { engine: 'cosyvoice' }, status: 'idle', created_at: '', updated_at: '' }],
      default_params: { engine: 'cosyvoice' },
      split_config: { delimiters: ['，'], mode: 'rule' },
      layout: 'vertical', engine: 'edge_tts', edge_voice: 'zh-CN-XiaoxiaoNeural',
      created_at: '', updated_at: '',
    };
    const migrated = migrateV1(v1);
    expect(migrated.schema_version).toBe(2);
    expect(migrated.chapters).toHaveLength(1);
    expect(migrated.chapters[0].segments).toHaveLength(1);
    expect(migrated.chapters[0].segments[0].text).toBe('hello');
    expect(migrated.chapters[0].engine).toBe('edge_tts');
    expect(migrated.chapters[0].edge_voice).toBe('zh-CN-XiaoxiaoNeural');
    expect(migrated.active_chapter_id).toBe(migrated.chapters[0].id);
  });

  it('LOAD_PROJECT migrates v1 data automatically', () => {
    const v1: RawSegmentedProject = {
      schema_version: 1, id: 'old', name: 'Old',
      segments: [], default_params: { engine: 'cosyvoice' },
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
});
