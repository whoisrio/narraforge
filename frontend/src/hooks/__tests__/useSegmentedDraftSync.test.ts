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

  it('onSaved fires after a successful flush with the saved project', async () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, onSaved }),
    );
    const proj = makeProject('p1');
    await act(async () => { await result.current.markDirty(proj); });
    await act(async () => { await result.current.flush(); });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(proj);
  });

  it('onSaved does not fire when the save fails', async () => {
    const onSaved = vi.fn();
    storageCalls.save.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, onSaved }),
    );
    await act(async () => { await result.current.markDirty(makeProject('p1')); });
    await act(async () => { await result.current.flush(); });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('flush 保存期间出现更新的 markDirty 时不覆盖新草稿（回归：合成后音频 404）', async () => {
    // 场景还原：GENERATE_SUCCESS 的 markDirty 写入带音频新草稿后，慢保存
    // （被后端锁序列化）的旧 flush 收尾时不得把新草稿整份覆盖成旧草稿。
    let resolveSave!: () => void;
    storageCalls.save.mockImplementationOnce(
      () => new Promise<void>((r) => { resolveSave = r; }),
    );
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, debounceMs: 60_000 }),
    );
    const oldProj = { ...makeProject('p1'), updated_at: '2026-01-01T00:00:00.000Z' };
    const newProj = { ...makeProject('p1'), updated_at: '2026-02-02T00:00:00.000Z' };
    await act(async () => { await result.current.markDirty(oldProj); });
    let flushPromise!: Promise<void>;
    await act(async () => { flushPromise = result.current.flush(); });
    // 等 flush 读到旧草稿并卡在 saveProject（模拟慢后端）
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => { await result.current.markDirty(newProj); });
    await act(async () => { resolveSave(); await flushPromise; });
    // 旧 flush 收尾不得覆盖：新草稿原样保留且仍为 dirty
    let draft = await getDraft('p1');
    expect(draft?.dirty).toBe(true);
    expect(draft?.draft.updated_at).toBe('2026-02-02T00:00:00.000Z');
    // 新草稿的下一次 flush 正常保存并收尾
    await act(async () => { await result.current.flush(); });
    expect(storageCalls.save).toHaveBeenLastCalledWith(newProj);
    draft = await getDraft('p1');
    expect(draft?.dirty).toBe(false);
    expect(draft?.draft.updated_at).toBe('2026-02-02T00:00:00.000Z');
  });

  it('flush 失败收尾同样不覆盖保存期间写入的更新草稿', async () => {
    let rejectSave!: (e: Error) => void;
    storageCalls.save.mockImplementationOnce(
      () => new Promise<void>((_r, rej) => { rejectSave = rej; }),
    );
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, debounceMs: 60_000 }),
    );
    const oldProj = { ...makeProject('p1'), updated_at: '2026-01-01T00:00:00.000Z' };
    const newProj = { ...makeProject('p1'), updated_at: '2026-02-02T00:00:00.000Z' };
    await act(async () => { await result.current.markDirty(oldProj); });
    let flushPromise!: Promise<void>;
    await act(async () => { flushPromise = result.current.flush(); });
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => { await result.current.markDirty(newProj); });
    await act(async () => { rejectSave(new Error('boom')); await flushPromise; });
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(true);
    expect(draft?.draft.updated_at).toBe('2026-02-02T00:00:00.000Z');
    expect(draft?.last_save_error).toBeUndefined();
  });
});
