import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import type { SegmentedProject } from '../../types';
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

beforeEach(() => { Object.values(fakeApi).forEach((f) => (f as Mock).mockReset()); });

describe('backendStorage', () => {
  it('listProjects calls GET /segmented-projects and maps summary stats for project cards', async () => {
    fakeApi.get.mockResolvedValueOnce({ data: [{
      id: 'p1', name: 'n', schema_version: 2, layout: 'vertical', active_chapter_id: null,
      created_at: 't', updated_at: 't',
      summary_stats: { chapter_count: 2, segment_count: 5, generated_count: 3, duration_sec: 42 },
    }] });
    const list = await backendStorage.listProjects();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('p1');
    expect(list[0].summary_stats).toEqual({ chapter_count: 2, segment_count: 5, generated_count: 3, duration_sec: 42 });
    expect(fakeApi.get).toHaveBeenCalledWith('/segmented-projects');
  });

  it('saveProject calls PUT /segmented-projects/{id}', async () => {
    fakeApi.put.mockResolvedValueOnce({ data: null });
    const project = { id: 'p1', name: 'n', schema_version: 2 as const, layout: 'vertical' as const,
      chapters: [], created_at: 't', updated_at: 't' };
    await backendStorage.saveProject(project);
    expect(fakeApi.put).toHaveBeenCalledWith('/segmented-projects/p1', project);
  });

  it('saveProject sends voice config (replaces old overrides/locked_params)', async () => {
    fakeApi.put.mockResolvedValueOnce({ data: null });
    const project: SegmentedProject = {
      id: 'p1', name: 'n', schema_version: 2, layout: 'vertical',
      active_chapter_id: 'ch1', created_at: 't', updated_at: 't',
      chapters: [{
        id: 'ch1', name: '第一章', default_params: { engine: 'cosyvoice' } as Record<string, unknown>, split_config: { delimiters: [], mode: 'rule' },
        segments: [{
          id: 's1', text: '片段',
          voice: { source: 'custom' as const, engine: 'cosyvoice' as const, params: { voice_id: 'v1', speed: 1.2 } },
          status: 'idle',
          audio: { format: 'mp3' },
          segment_kind: 'narration',
          created_at: 't', updated_at: 't',
        }], created_at: 't', updated_at: 't',
      }],
    };
    await backendStorage.saveProject(project);
    const payload = fakeApi.put.mock.calls[0][1];
    expect(payload.chapters[0].segments[0].voice).toEqual({ source: 'custom', engine: 'cosyvoice', params: { voice_id: 'v1', speed: 1.2 } });
  });

  it('deleteProject calls DELETE /segmented-projects/{id}', async () => {
    fakeApi.delete.mockResolvedValueOnce({ data: null });
    await backendStorage.deleteProject('p1');
    expect(fakeApi.delete).toHaveBeenCalledWith('/segmented-projects/p1');
  });
});
