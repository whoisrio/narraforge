import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import type { SegmentedProject } from '../../types';
import { useSegmentedDraftSync } from '../useSegmentedDraftSync';
import { deleteDraft, getDraft, listDrafts } from '../../services/segmentedDraftStore';
import type { SegmentedProjectStorage } from '../../services/segmentedProjectStorage';

function makeProject(id: string): SegmentedProject {
  const now = new Date().toISOString();
  return {
    schema_version: 2, id, name: 'x', layout: 'vertical',
    chapters: [{ id: 'c1', name: '第一章', engine: 'edge_tts', segments: [],
      voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' },
      split_config: { delimiters: ['。'], mode: 'rule' },
      created_at: now, updated_at: now }],
    created_at: now, updated_at: now,
  };
}

const storageCalls = { save: vi.fn() };
const storage: SegmentedProjectStorage = {
  listProjects: async () => [],
  getProject: async () => undefined,
  saveProject: storageCalls.save,
  deleteProject: async () => {},
};

beforeEach(async () => {
  for (const d of await listDrafts()) await deleteDraft(d.project_id);
  storageCalls.save.mockReset();
  storageCalls.save.mockResolvedValue(undefined);
});

describe('useSegmentedDraftSync', () => {
  it('returns a hook result with the expected methods', () => {
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage }),
    );
    expect(result.current).not.toBeNull();
    expect(typeof result.current.markDirty).toBe('function');
    expect(typeof result.current.flush).toBe('function');
    expect(typeof result.current.adoptBackendVersion).toBe('function');
  });

  it('debounces PUT until quiet period', async () => {
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, debounceMs: 50 }),
    );
    await act(async () => {
      await result.current.markDirty(makeProject('p1'));
      await result.current.markDirty(makeProject('p1'));
    });
    expect(storageCalls.save).not.toHaveBeenCalled();
    await new Promise(r => setTimeout(r, 100));
    expect(storageCalls.save).toHaveBeenCalledTimes(1);
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(false);
  });

  it('marks dirty and stores last_save_error on failure', async () => {
    storageCalls.save.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, debounceMs: 20 }),
    );
    await act(async () => { await result.current.markDirty(makeProject('p1')); });
    await new Promise(r => setTimeout(r, 80));
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(true);
    expect(draft?.last_save_error).toBe('boom');
  });

  it('adoptBackendVersion sets base_updated_at and clears dirty', async () => {
    const { result } = renderHook(() => useSegmentedDraftSync('p1', { storage }));
    const proj = makeProject('p1');
    proj.updated_at = '2026-06-09T12:00:00';
    await act(async () => { await result.current.adoptBackendVersion(proj); });
    const draft = await getDraft('p1');
    expect(draft?.base_updated_at).toBe('2026-06-09T12:00:00');
    expect(draft?.dirty).toBe(false);
  });

  it('flush calls save immediately and clears dirty', async () => {
    const { result } = renderHook(() => useSegmentedDraftSync('p1', { storage }));
    await act(async () => { await result.current.markDirty(makeProject('p1')); });
    await act(async () => { await result.current.flush(); });
    expect(storageCalls.save).toHaveBeenCalledTimes(1);
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(false);
  });
});
