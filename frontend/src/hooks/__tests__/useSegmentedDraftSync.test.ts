import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import 'fake-indexeddb/auto';
import type { SegmentedProject } from '../../types';
import { useSegmentedDraftSync } from '../useSegmentedDraftSync';
import { deleteDraft, getDraft, listDrafts } from '../../services/segmentedDraftStore';
import type { SegmentedProjectStorage } from '../../services/segmentedProjectStorage';

/** 构造后端 409 stale_payload 形状的 axios 错误（带 detail.server_updated_at）。 */
function staleError(serverUpdatedAt: string): Error {
  const err = new Error('Request failed with status code 409') as Error & {
    response?: { status: number; data: { detail: { code: string; server_updated_at: string } } };
  };
  err.response = {
    status: 409,
    data: { detail: { code: 'stale_payload', server_updated_at: serverUpdatedAt } },
  };
  return err;
}

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
    expect(storageCalls.save).toHaveBeenLastCalledWith(newProj, { base_updated_at: null });
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

  it('flush 携带 base_updated_at，保存成功后以服务端响应的 updated_at 作为新 base', async () => {
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, debounceMs: 20 }),
    );
    const serverVersion = makeProject('p1');
    serverVersion.updated_at = '2026-08-27T01:00:00';
    await act(async () => { await result.current.adoptBackendVersion(serverVersion); });

    const edited = { ...makeProject('p1'), name: 'edited' };
    storageCalls.save.mockResolvedValue({ ...edited, updated_at: '2026-08-27T02:00:00' });
    await act(async () => { await result.current.markDirty(edited); });
    await new Promise(r => setTimeout(r, 80));

    expect(storageCalls.save).toHaveBeenCalledWith(
      edited, { base_updated_at: '2026-08-27T01:00:00' },
    );
    const draft = await getDraft('p1');
    // 新 base 是服务端权威值（响应），不是客户端草稿的时间戳
    expect(draft?.base_updated_at).toBe('2026-08-27T02:00:00');
    expect(draft?.dirty).toBe(false);
  });

  it('saveProject 无返回值时 base_updated_at 回退为草稿时间戳（兼容旧 storage）', async () => {
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, debounceMs: 20 }),
    );
    const proj = makeProject('p1');
    proj.updated_at = '2026-08-27T03:00:00';
    storageCalls.save.mockResolvedValue(undefined);
    await act(async () => { await result.current.markDirty(proj); });
    await new Promise(r => setTimeout(r, 80));
    const draft = await getDraft('p1');
    expect(draft?.base_updated_at).toBe('2026-08-27T03:00:00');
  });

  it('noteServerVersion 推进 base_updated_at，下次 flush 携带新 base（合成/PATCH 后的服务端版本）', async () => {
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, debounceMs: 20 }),
    );
    const serverVersion = makeProject('p1');
    serverVersion.updated_at = '2026-08-27T01:00:00';
    await act(async () => { await result.current.adoptBackendVersion(serverVersion); });

    // 服务端被合成端点推进（不经过 draftSync），前端收到响应后 note
    await act(async () => { await result.current.noteServerVersion('2026-08-27T01:30:00'); });

    const edited = { ...makeProject('p1'), name: 'edited' };
    await act(async () => { await result.current.markDirty(edited); });
    await new Promise(r => setTimeout(r, 80));
    expect(storageCalls.save).toHaveBeenCalledWith(
      edited, { base_updated_at: '2026-08-27T01:30:00' },
    );
  });
});

describe('useSegmentedDraftSync 409 自愈（第一层：假冲突零感知重试）', () => {
  it('PUT 在途时自写推进服务端（S 已登记）→ 换 base 重试成功，不触发 onSaveError', async () => {
    const onSaveError = vi.fn();
    let rejectFirst!: (e: Error) => void;
    storageCalls.save
      .mockImplementationOnce(() => new Promise((_r, rej) => { rejectFirst = rej; }))
      .mockResolvedValueOnce({ ...makeProject('p1'), updated_at: '2026-09-23T03:00:00' });
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, onSaveError, debounceMs: 60_000 }),
    );
    const base = { ...makeProject('p1'), updated_at: '2026-09-23T01:00:00' };
    await act(async () => { await result.current.adoptBackendVersion(base); });
    const edited = { ...makeProject('p1'), name: 'edited' };
    await act(async () => { await result.current.markDirty(edited); });

    let flushPromise!: Promise<void>;
    await act(async () => { flushPromise = result.current.flush(); });
    // PUT 在途：本端细粒度端点完成，noteServerVersion 登记 T2 并推进 base
    await new Promise(r => setTimeout(r, 10));
    await act(async () => { await result.current.noteServerVersion('2026-09-23T02:00:00'); });
    await act(async () => { rejectFirst(staleError('2026-09-23T02:00:00')); await flushPromise; });

    // 自愈：第二次 PUT 以 409 报告的服务端当前值为 base，成功收尾
    expect(storageCalls.save).toHaveBeenCalledTimes(2);
    expect(storageCalls.save).toHaveBeenLastCalledWith(
      edited, { base_updated_at: '2026-09-23T02:00:00' },
    );
    expect(onSaveError).not.toHaveBeenCalled();
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(false);
    expect(draft?.base_updated_at).toBe('2026-09-23T03:00:00');
    expect(draft?.last_save_error).toBeUndefined();
  });

  it('409 时 S 尚未登记、等待窗口内白写响应到达 → 重试成功，不触发 onSaveError', async () => {
    const onSaveError = vi.fn();
    storageCalls.save
      .mockRejectedValueOnce(staleError('2026-09-23T02:00:00'))
      .mockResolvedValueOnce({ ...makeProject('p1'), updated_at: '2026-09-23T03:00:00' });
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', {
        storage, onSaveError, debounceMs: 60_000,
        staleRetry: { pollIntervalMs: 10, maxWaitMs: 500 },
      }),
    );
    const edited = { ...makeProject('p1'), name: 'edited' };
    await act(async () => { await result.current.markDirty(edited); });

    // 409 先于本端在途自写响应到达（网络乱序）：100ms 后 note 登记服务端版本
    await act(async () => {
      const flushPromise = result.current.flush();
      setTimeout(() => { void result.current.noteServerVersion('2026-09-23T02:00:00'); }, 100);
      await flushPromise;
    });

    expect(storageCalls.save).toHaveBeenCalledTimes(2);
    expect(storageCalls.save).toHaveBeenLastCalledWith(
      edited, { base_updated_at: '2026-09-23T02:00:00' },
    );
    expect(onSaveError).not.toHaveBeenCalled();
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(false);
  });

  it('S 不属于本端任何写（真外部冲突）→ 等待窗口耗尽后 onSaveError 收到原错误', async () => {
    const err = staleError('2026-09-23T09:00:00');
    const onSaveError = vi.fn();
    storageCalls.save.mockRejectedValueOnce(err);
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', {
        storage, onSaveError, debounceMs: 60_000,
        staleRetry: { pollIntervalMs: 5, maxWaitMs: 30 },
      }),
    );
    const edited = { ...makeProject('p1'), name: 'edited' };
    await act(async () => { await result.current.markDirty(edited); });
    await act(async () => { await result.current.flush(); });

    expect(storageCalls.save).toHaveBeenCalledTimes(1);
    expect(onSaveError).toHaveBeenCalledTimes(1);
    expect(onSaveError).toHaveBeenCalledWith(err);
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(true);
    expect(draft?.last_save_error).toBe(err.message);
  });

  it('PUT 在途草稿被取代 + 409 → 静默退出：无错误记录、不触发 onSaveError（新草稿的 flush 接手）', async () => {
    const onSaveError = vi.fn();
    let rejectFirst!: (e: Error) => void;
    storageCalls.save
      .mockImplementationOnce(() => new Promise((_r, rej) => { rejectFirst = rej; }));
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, onSaveError, debounceMs: 60_000 }),
    );
    const oldProj = { ...makeProject('p1'), updated_at: '2026-01-01T00:00:00.000Z' };
    const newProj = { ...makeProject('p1'), updated_at: '2026-02-02T00:00:00.000Z' };
    await act(async () => { await result.current.markDirty(oldProj); });
    let flushPromise!: Promise<void>;
    await act(async () => { flushPromise = result.current.flush(); });
    await new Promise(r => setTimeout(r, 10));
    await act(async () => { await result.current.markDirty(newProj); });
    await act(async () => { rejectFirst(staleError('2026-09-23T02:00:00')); await flushPromise; });

    expect(onSaveError).not.toHaveBeenCalled();
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(true);
    expect(draft?.draft.updated_at).toBe('2026-02-02T00:00:00.000Z');
    expect(draft?.last_save_error).toBeUndefined();
  });

  it('连续自撞超过重试上限（3 次）→ 按真冲突上抛 onSaveError', async () => {
    const err = staleError('2026-09-23T02:00:00');
    const onSaveError = vi.fn();
    storageCalls.save.mockRejectedValue(err);
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, onSaveError, debounceMs: 60_000 }),
    );
    const edited = { ...makeProject('p1'), name: 'edited' };
    await act(async () => { await result.current.markDirty(edited); });
    // 预登记 T2（服务端已推进到本端已知版本，每次 409 都报 T2）
    await act(async () => { await result.current.noteServerVersion('2026-09-23T02:00:00'); });
    await act(async () => { await result.current.flush(); });

    // 首次 + 3 次重试 = 4 次 PUT，全部 409 后上抛
    expect(storageCalls.save).toHaveBeenCalledTimes(4);
    expect(onSaveError).toHaveBeenCalledTimes(1);
    expect(onSaveError).toHaveBeenCalledWith(err);
  });

  it('noteServerVersion 乱序响应不回退 base（单调保护）', async () => {
    const { result } = renderHook(() => useSegmentedDraftSync('p1', { storage }));
    await act(async () => { await result.current.adoptBackendVersion({ ...makeProject('p1'), updated_at: '2026-09-23T01:00:00' }); });
    await act(async () => { await result.current.noteServerVersion('2026-09-23T02:00:00'); });
    // 乱序到达的旧响应不得把 base 拉回
    await act(async () => { await result.current.noteServerVersion('2026-09-23T01:30:00'); });
    const draft = await getDraft('p1');
    expect(draft?.base_updated_at).toBe('2026-09-23T02:00:00');
  });

  it('自撞重试带上草稿最新内容：PUT 在途期间并入的细粒度写结果不被旧快照覆盖', async () => {
    // 场景：整包 PUT 在途时段 PATCH 完成，refreshDraft 把 PATCH 结果并入草稿记录。
    // 重试若沿用发起 flush 时捕获的旧快照，整包 PUT 会把 PATCH 写进服务端的字段
    // 覆盖回旧值（后端对已存在段照写 text）。
    const onSaveError = vi.fn();
    let rejectFirst!: (e: Error) => void;
    storageCalls.save
      .mockImplementationOnce(() => new Promise((_r, rej) => { rejectFirst = rej; }))
      .mockResolvedValueOnce({ ...makeProject('p1'), updated_at: '2026-09-23T03:00:00' });
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, onSaveError, debounceMs: 60_000 }),
    );
    const base = { ...makeProject('p1'), updated_at: '2026-09-23T01:00:00' };
    await act(async () => { await result.current.adoptBackendVersion(base); });
    const edited = { ...makeProject('p1'), name: 'edited' };
    await act(async () => { await result.current.markDirty(edited); });

    let flushPromise!: Promise<void>;
    await act(async () => { flushPromise = result.current.flush(); });
    await new Promise(r => setTimeout(r, 10));
    // PUT 在途：细粒度写完成 → 版本登记 + base 前移，结果并入草稿内容
    await act(async () => { await result.current.noteServerVersion('2026-09-23T02:00:00'); });
    const refreshed = { ...makeProject('p1'), name: 'edited-with-patch-result' };
    await act(async () => { await result.current.refreshDraft(refreshed); });
    await act(async () => { rejectFirst(staleError('2026-09-23T02:00:00')); await flushPromise; });

    expect(storageCalls.save).toHaveBeenCalledTimes(2);
    expect(storageCalls.save).toHaveBeenLastCalledWith(
      refreshed, { base_updated_at: '2026-09-23T02:00:00' },
    );
    expect(onSaveError).not.toHaveBeenCalled();
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(false);
    expect(draft?.draft.name).toBe('edited-with-patch-result');
  });

  it('pause 挂起 flush 排程，markDirty 照常写草稿；resume 后立即补发', async () => {
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, debounceMs: 30 }),
    );
    act(() => { result.current.pause(); });
    const edited = { ...makeProject('p1'), name: 'edited' };
    await act(async () => { await result.current.markDirty(edited); });
    // paused：草稿已写但排程被挂起
    const mid = await getDraft('p1');
    expect(mid?.dirty).toBe(true);
    expect(mid?.draft.name).toBe('edited');
    await new Promise(r => setTimeout(r, 100));
    expect(storageCalls.save).not.toHaveBeenCalled();

    act(() => { result.current.resume(); });
    await new Promise(r => setTimeout(r, 100));
    expect(storageCalls.save).toHaveBeenCalledTimes(1);
    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(false);
  });
});

describe('refreshDraft', () => {
  it('刷新已有 dirty 草稿的内容（不重新排程、不清 dirty），防陈旧快照被 PUT 回写', async () => {
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage, debounceMs: 10_000 }),
    );
    const stale = makeProject('p1');
    await act(async () => { await result.current.markDirty(stale); });

    // touch=false 的后续变更（如 PATCH 已远端持久化的 kind 切换）
    const fresh = { ...makeProject('p1'), name: 'dialogue-now' };
    await act(async () => { await result.current.refreshDraft(fresh); });

    const draft = await getDraft('p1');
    expect(draft?.dirty).toBe(true);            // 仍待冲刷
    expect(draft?.draft.name).toBe('dialogue-now'); // 内容已是最新
  });

  it('无草稿记录时不创建（初始加载等场景不制造草稿）', async () => {
    const { result } = renderHook(() =>
      useSegmentedDraftSync('p1', { storage }),
    );
    await act(async () => { await result.current.refreshDraft(makeProject('p1')); });
    expect(await getDraft('p1')).toBeUndefined();
  });
});
