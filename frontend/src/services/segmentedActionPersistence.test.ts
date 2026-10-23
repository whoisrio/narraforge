import { describe, expect, it } from 'vitest';
import type { SegmentedProject } from '../types';
import { segmentedReducer, type Action } from '../hooks/useSegmentedProject';
import { collectPersistentWrites } from './segmentedActionPersistence';

function makeProject(): SegmentedProject {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    schema_version: 2,
    id: 'p1',
    name: '项目',
    layout: 'vertical',
    active_chapter_id: 'c1',
    configs: { description: 'old' },
    chapters: [
      {
        id: 'c1', name: '第一章', voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' },
        split_config: { delimiters: ['。'], mode: 'rule' },
        segments: [{
          id: 's1', text: '第一句。', voice: { source: 'chapter' }, status: 'idle',
          audio: { format: 'mp3' }, role_id: 'role-old', segment_kind: 'narration',
          created_at: now, updated_at: now,
        }],
        created_at: now, updated_at: now,
      },
      {
        id: 'c2', name: '第二章', voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' },
        split_config: { delimiters: ['。'], mode: 'rule' }, segments: [],
        created_at: now, updated_at: now,
      },
    ],
    created_at: now, updated_at: now,
  };
}

function writesFor(project: SegmentedProject, action: Action) {
  const next = segmentedReducer({ project }, action).project;
  return collectPersistentWrites(action, project, next);
}

describe('collectPersistentWrites', () => {
  it('项目改名/元信息/文档改走项目与文档端点', () => {
    const project = makeProject();
    expect(writesFor(project, { type: 'RENAME_PROJECT', name: '新项目' })).toEqual([
      { kind: 'project', patch: { name: '新项目' } },
    ]);

    const meta = writesFor(project, {
      type: 'SET_PROJECT_META',
      meta: { description: 'new', remotion_project_path: '/tmp/r' },
    });
    expect(meta).toHaveLength(1);
    expect(meta[0]).toMatchObject({ kind: 'project', patch: { remotion_project_path: '/tmp/r' } });
    expect((meta[0] as { patch: { configs: { description: string } } }).patch.configs.description).toBe('new');

    expect(writesFor(project, { type: 'SET_SOURCE_DOCUMENT', text: '源文档' })).toEqual([
      { kind: 'document', document: 'source_document', text: '源文档' },
    ]);
    expect(writesFor(project, { type: 'SET_NARRATION_SCRIPT', text: '旁白稿' })).toEqual([
      { kind: 'document', document: 'narration_script', text: '旁白稿' },
    ]);
  });

  it('章节字段只把可持久化字段发 chapter PATCH，面板 UI 状态不落库', () => {
    const project = makeProject();
    expect(writesFor(project, { type: 'RENAME_CHAPTER', id: 'c2', name: '改名' })).toEqual([
      { kind: 'chapter', chapterId: 'c2', patch: { name: '改名' } },
    ]);
    expect(writesFor(project, { type: 'SET_SPLIT_CONFIG', config: { delimiters: ['，'], mode: 'llm' } })).toEqual([
      { kind: 'chapter', chapterId: 'c1', patch: { split_config: { delimiters: ['，'], mode: 'llm' } } },
    ]);

    expect(writesFor(project, {
      type: 'SET_CHAPTER_META',
      meta: { engine: 'mimo_tts', panel_open: false },
    })).toEqual([]);

    expect(writesFor(project, {
      type: 'SET_CHAPTER_META',
      meta: { original_text: '改写后的章节原文。' },
    })).toEqual([
      { kind: 'chapter', chapterId: 'c1', patch: { original_text: '改写后的章节原文。' } },
    ]);

    expect(writesFor(project, {
      type: 'SET_CHAPTER_META_BY_ID',
      id: 'c2',
      meta: { design_title: '第二幕' },
    })).toEqual([
      { kind: 'chapter', chapterId: 'c2', patch: { design_title: '第二幕' } },
    ]);
  });

  it('应用全局音色会为每个章节生成一次 chapter PATCH', () => {
    const params = { engine: 'edge_tts' as const, voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' };
    const writes = writesFor(makeProject(), { type: 'SET_ALL_CHAPTERS_PARAMS', params });
    expect(writes).toEqual([
      { kind: 'chapter', chapterId: 'c1', patch: { voice: params } },
      { kind: 'chapter', chapterId: 'c2', patch: { voice: params } },
    ]);
  });

  it('段内容 action 生成 segment PATCH；touch=false（已由调用方 PATCH）不重复写', () => {
    const project = makeProject();
    expect(writesFor(project, { type: 'UPDATE_TEXT', id: 's1', text: '改后。' })).toEqual([
      { kind: 'segment', chapterId: 'c1', segmentId: 's1', patch: { text: '改后。' } },
    ]);
    expect(writesFor(project, { type: 'UPDATE_TEXT', id: 's1', text: '改后。', touch: false })).toEqual([]);

    const params = { enable_ssml: true };
    const writes = writesFor(project, { type: 'UPDATE_PARAMS', id: 's1', params });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ kind: 'segment', segmentId: 's1' });

    expect(writesFor(project, {
      type: 'SET_SEGMENT_TEXT_TRANSFORMS',
      id: 's1',
      transforms: { lowercase_latin: true },
    })).toEqual([
      {
        kind: 'segment', chapterId: 'c1', segmentId: 's1',
        patch: { text_transforms: { lowercase_latin: true } },
      },
    ]);
  });

  it('从项目移除角色会为所有引用段生成 PATCH', () => {
    const writes = writesFor(makeProject(), { type: 'CLEAR_ROLE_FROM_SEGMENTS', roleId: 'role-old' });
    expect(writes).toEqual([
      {
        kind: 'segment', chapterId: 'c1', segmentId: 's1',
        patch: { role_id: null, voice: { source: 'chapter' } },
      },
    ]);
  });

  it('结构操作与纯 UI 操作不产生实体写', () => {
    const project = makeProject();
    expect(writesFor(project, { type: 'SELECT_CHAPTER', id: 'c2' })).toEqual([]);
    expect(writesFor(project, { type: 'MARK_QUEUED', ids: ['s1'] })).toEqual([]);
    expect(writesFor(project, { type: 'DELETE_SEGMENT', id: 's1', touch: false })).toEqual([]);
  });
});
