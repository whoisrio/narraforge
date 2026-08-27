import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Mock } from 'vitest';

const { patchSegment } = vi.hoisted(() => ({ patchSegment: vi.fn() }));

vi.mock('../../services/api', () => ({
  segmentedProjectApi: { patchSegment },
}));

import { useSegmentPatchSync } from '../useSegmentPatchSync';

beforeEach(() => {
  patchSegment.mockReset();
});

describe('useSegmentPatchSync', () => {
  it('同段多次 patch 合并并按防抖只发一次请求', async () => {
    patchSegment.mockResolvedValue({ segment: { id: 's1' }, project_updated_at: 'T2' });
    const onPatched = vi.fn();
    const { result } = renderHook(() =>
      useSegmentPatchSync({ projectId: 'p1', enabled: true, onPatched, debounceMs: 30 }),
    );
    act(() => {
      result.current.queue('s1', 'c1', { text: '你' });
      result.current.queue('s1', 'c1', { text: '你好' });
      result.current.queue('s1', 'c1', { emotion: 'happy' });
    });
    await new Promise(r => setTimeout(r, 80));
    expect(patchSegment).toHaveBeenCalledTimes(1);
    expect(patchSegment).toHaveBeenCalledWith('p1', 'c1', 's1', { text: '你好', emotion: 'happy' });
    expect(onPatched).toHaveBeenCalledWith('s1', { id: 's1' }, 'T2');
  });

  it('enabled=false 时不发请求', async () => {
    const { result } = renderHook(() =>
      useSegmentPatchSync({ projectId: 'p1', enabled: false, debounceMs: 10 }),
    );
    act(() => { result.current.queue('s1', 'c1', { text: 'x' }); });
    await new Promise(r => setTimeout(r, 40));
    expect(patchSegment).not.toHaveBeenCalled();
  });

  it('请求失败走 onError', async () => {
    patchSegment.mockRejectedValue(new Error('boom'));
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useSegmentPatchSync({ projectId: 'p1', enabled: true, onError, debounceMs: 10 }),
    );
    act(() => { result.current.queue('s1', 'c1', { text: 'x' }); });
    await new Promise(r => setTimeout(r, 40));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('卸载时立即冲刷未发的 patch（不丢尾部击键）', async () => {
    patchSegment.mockResolvedValue({ segment: { id: 's1' }, project_updated_at: 'T2' });
    const { result, unmount } = renderHook(() =>
      useSegmentPatchSync({ projectId: 'p1', enabled: true, debounceMs: 60_000 }),
    );
    act(() => { result.current.queue('s1', 'c1', { text: '尾' }); });
    unmount();
    await new Promise(r => setTimeout(r, 20));
    expect(patchSegment).toHaveBeenCalledTimes(1);
  });

  it('projectId 变化后新请求用新 projectId', async () => {
    patchSegment.mockResolvedValue({ segment: { id: 's1' }, project_updated_at: 'T' });
    const { result, rerender } = renderHook(
      ({ pid }) => useSegmentPatchSync({ projectId: pid, enabled: true, debounceMs: 10 }),
      { initialProps: { pid: 'p1' } },
    );
    rerender({ pid: 'p2' });
    act(() => { result.current.queue('s1', 'c1', { text: 'x' }); });
    await new Promise(r => setTimeout(r, 40));
    expect((patchSegment as Mock).mock.calls[0][0]).toBe('p2');
  });
});
