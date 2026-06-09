import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

const { fakeApi } = vi.hoisted(() => {
  const fake = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
  return { fakeApi: fake };
});

vi.mock('axios', () => ({
  default: {
    create: () => fakeApi,
  },
}));

import { backendStorage } from '../backendSegmentedProjectStorage';

beforeEach(() => { Object.values(fakeApi).forEach((f: any) => f.mockReset()); });

describe('backendStorage', () => {
  it('listProjects calls GET /segmented-projects and maps summaries', async () => {
    fakeApi.get.mockResolvedValueOnce({ data: [{ id: 'p1', name: 'n', schema_version: 2, layout: 'vertical', active_chapter_id: null, created_at: 't', updated_at: 't' }] });
    const list = await backendStorage.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('p1');
    expect(fakeApi.get).toHaveBeenCalledWith('/segmented-projects');
  });

  it('saveProject calls PUT /segmented-projects/{id}', async () => {
    fakeApi.put.mockResolvedValueOnce({ data: null });
    const project = { id: 'p1', name: 'n', schema_version: 2 as const, layout: 'vertical' as const,
      chapters: [], created_at: 't', updated_at: 't' };
    await backendStorage.saveProject(project);
    expect(fakeApi.put).toHaveBeenCalledWith('/segmented-projects/p1', project);
  });

  it('deleteProject calls DELETE /segmented-projects/{id}', async () => {
    fakeApi.delete.mockResolvedValueOnce({ data: null });
    await backendStorage.deleteProject('p1');
    expect(fakeApi.delete).toHaveBeenCalledWith('/segmented-projects/p1');
  });
});
