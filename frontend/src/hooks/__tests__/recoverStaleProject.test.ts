import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { SegmentedProject } from '../../types';
import type { SegmentedProjectStorage } from '../../services/segmentedProjectStorage';
import { recoverStaleProject } from '../recoverStaleProject';

function makeProject(id: string, updatedAt: string): SegmentedProject {
  return {
    schema_version: 2, id, name: 'x', layout: 'vertical',
    chapters: [], created_at: updatedAt, updated_at: updatedAt,
  };
}

function makeStorage(fresh: SegmentedProject | undefined): SegmentedProjectStorage {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue(fresh),
    saveProject: vi.fn().mockResolvedValue(undefined),
    deleteProject: vi.fn().mockResolvedValue(undefined),
  };
}

describe('recoverStaleProject（409 stale_payload 恢复）', () => {
  it('拉取后端权威版本、adoptBackendVersion 丢弃冲突草稿并应用', async () => {
    const fresh = makeProject('p1', '2026-08-27T02:00:00');
    const storage = makeStorage(fresh);
    const adoptBackendVersion = vi.fn().mockResolvedValue(undefined);
    const applyProject = vi.fn();

    const recovered = await recoverStaleProject({
      projectId: 'p1', storage, adoptBackendVersion, applyProject,
    });

    expect(recovered).toEqual(fresh);
    expect(adoptBackendVersion).toHaveBeenCalledWith(fresh);
    expect(applyProject).toHaveBeenCalledWith(fresh);
  });

  it('应用前经过 migrate 转换', async () => {
    const fresh = makeProject('p1', '2026-08-27T02:00:00');
    const migrated = { ...fresh, name: 'migrated' };
    const storage = makeStorage(fresh);
    const applyProject = vi.fn();

    await recoverStaleProject({
      projectId: 'p1', storage,
      adoptBackendVersion: vi.fn().mockResolvedValue(undefined),
      applyProject,
      migrate: () => migrated,
    });

    expect(applyProject).toHaveBeenCalledWith(migrated);
  });

  it('后端项目不存在时不做任何事', async () => {
    const storage = makeStorage(undefined);
    const adoptBackendVersion = vi.fn();
    const applyProject = vi.fn();

    const recovered = await recoverStaleProject({
      projectId: 'gone', storage, adoptBackendVersion, applyProject,
    });

    expect(recovered).toBeUndefined();
    expect(adoptBackendVersion).not.toHaveBeenCalled();
    expect(applyProject).not.toHaveBeenCalled();
  });
});
