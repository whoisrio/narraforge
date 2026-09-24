import { describe, expect, it, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import type { SegmentedProject } from '../../types';
import type { SegmentedProjectStorage } from '../../services/segmentedProjectStorage';
import type { ProjectDraftRecord } from '../../services/segmentedDraftStore';
import { putDraft, listDrafts, deleteDraft } from '../../services/segmentedDraftStore';
import { listConflictedDrafts, clearConflictedDrafts } from '../../services/conflictedDraftStore';
import { handleStaleSave } from '../handleStaleSave';

function makeProject(id: string, updatedAt: string): SegmentedProject {
  return {
    schema_version: 2, id, name: 'x', layout: 'vertical',
    chapters: [], created_at: updatedAt, updated_at: updatedAt,
  };
}

function makeDraftRecord(projectId: string, updatedAt: string): ProjectDraftRecord {
  return {
    project_id: projectId,
    draft: makeProject(projectId, updatedAt),
    base_updated_at: '2026-09-23T00:00:00',
    updated_at: updatedAt,
    dirty: true,
  };
}

function makeStorage(fresh: SegmentedProject | undefined | Error): SegmentedProjectStorage {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockImplementation(() =>
      fresh instanceof Error ? Promise.reject(fresh) : Promise.resolve(fresh)),
    saveProject: vi.fn().mockResolvedValue(undefined),
    deleteProject: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(async () => {
  await clearConflictedDrafts();
  for (const d of await listDrafts()) await deleteDraft(d.project_id);
});

describe('handleStaleSave（409 真冲突：归档 + 拉取 + 弹窗裁决，不再静默丢草稿）', () => {
  it('pause → 归档草稿 → 拉取后端 → openPrompt(backend, draft)，保持 paused 等裁决', async () => {
    const rec = makeDraftRecord('p1', '2026-09-23T01:00:00');
    await putDraft(rec);
    const backend = makeProject('p1', '2026-09-23T02:00:00');
    const storage = makeStorage(backend);
    const pause = vi.fn();
    const resume = vi.fn();
    const openPrompt = vi.fn();

    const status = await handleStaleSave({
      projectId: 'p1', storage, pause, resume, openPrompt,
    });

    expect(status).toBe('prompted');
    expect(pause).toHaveBeenCalledTimes(1);
    // 草稿已归档（带完整记录）
    const archived = await listConflictedDrafts('p1');
    expect(archived).toHaveLength(1);
    expect(archived[0].record).toEqual(rec);
    // 弹窗收到后端权威态与本地草稿；resume 留给裁决动作
    expect(openPrompt).toHaveBeenCalledWith(backend, rec);
    expect(resume).not.toHaveBeenCalled();
  });

  it('应用前经过 migrate 转换', async () => {
    const rec = makeDraftRecord('p1', '2026-09-23T01:00:00');
    await putDraft(rec);
    const backend = makeProject('p1', '2026-09-23T02:00:00');
    const migrated = { ...backend, name: 'migrated' };
    const openPrompt = vi.fn();

    await handleStaleSave({
      projectId: 'p1',
      storage: makeStorage(backend),
      pause: vi.fn(), resume: vi.fn(), openPrompt,
      migrate: () => migrated,
    });

    expect(openPrompt).toHaveBeenCalledWith(migrated, rec);
  });

  it('拉取后端失败 → resume 恢复 autosave、不弹窗，归档已写入（等下一轮保存重试）', async () => {
    const rec = makeDraftRecord('p1', '2026-09-23T01:00:00');
    await putDraft(rec);
    const pause = vi.fn();
    const resume = vi.fn();
    const openPrompt = vi.fn();

    const status = await handleStaleSave({
      projectId: 'p1',
      storage: makeStorage(new Error('network down')),
      pause, resume, openPrompt,
    });

    expect(status).toBe('fetch-failed');
    expect(resume).toHaveBeenCalledTimes(1);
    expect(openPrompt).not.toHaveBeenCalled();
    expect(await listConflictedDrafts('p1')).toHaveLength(1);
  });

  it('后端项目不存在 → resume、不弹窗', async () => {
    const rec = makeDraftRecord('gone', '2026-09-23T01:00:00');
    await putDraft(rec);
    const resume = vi.fn();
    const openPrompt = vi.fn();

    const status = await handleStaleSave({
      projectId: 'gone',
      storage: makeStorage(undefined),
      pause: vi.fn(), resume, openPrompt,
    });

    expect(status).toBe('not-found');
    expect(resume).toHaveBeenCalledTimes(1);
    expect(openPrompt).not.toHaveBeenCalled();
  });

  it('草稿记录不存在（已被清理）→ resume，不归档不拉取', async () => {
    const storage = makeStorage(makeProject('p1', '2026-09-23T02:00:00'));
    const resume = vi.fn();
    const openPrompt = vi.fn();

    const status = await handleStaleSave({
      projectId: 'p1', storage, pause: vi.fn(), resume, openPrompt,
    });

    expect(status).toBe('no-draft');
    expect(resume).toHaveBeenCalledTimes(1);
    expect(openPrompt).not.toHaveBeenCalled();
    expect(storage.getProject).not.toHaveBeenCalled();
    expect(await listConflictedDrafts('p1')).toHaveLength(0);
  });
});
