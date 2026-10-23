import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { segmentedProjectApi } from '../services/api';
import { useSegmentedEntitySync } from './useSegmentedEntitySync';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSegmentedEntitySync', () => {
  it('合并同实体防抖写，只发一次请求', async () => {
    const patchProject = vi.spyOn(segmentedProjectApi, 'patchProject')
      .mockResolvedValue({ updated_at: 'v1' } as never);
    const { result } = renderHook(() => useSegmentedEntitySync({
      projectId: 'p1', enabled: true, debounceMs: 5,
    }));

    result.current.queueProject({ name: 'A' });
    result.current.queueProject({ layout: 'horizontal' });

    await waitFor(() => expect(patchProject).toHaveBeenCalledTimes(1));
    expect(patchProject).toHaveBeenCalledWith('p1', { name: 'A', layout: 'horizontal' });
  });

  it('不同章节各自合并，互不覆盖', async () => {
    const patchChapter = vi.spyOn(segmentedProjectApi, 'patchChapter')
      .mockImplementation(async (_pid, chapterId) => ({ project_updated_at: `v-${chapterId}` }) as never);
    const { result } = renderHook(() => useSegmentedEntitySync({
      projectId: 'p1', enabled: true, debounceMs: 5,
    }));

    result.current.queueChapter('c1', { name: '一' });
    result.current.queueChapter('c2', { name: '二' });
    result.current.queueChapter('c1', { design_title: '第一幕' });

    await waitFor(() => expect(patchChapter).toHaveBeenCalledTimes(2));
    expect(patchChapter).toHaveBeenCalledWith('p1', 'c1', { name: '一', design_title: '第一幕' });
    expect(patchChapter).toHaveBeenCalledWith('p1', 'c2', { name: '二' });
  });

  it('同一实体串行：前一次在途时第二次写等待完成后再发，避免乱序覆盖', async () => {
    let resolveFirst!: (value: unknown) => void;
    const patchProject = vi.spyOn(segmentedProjectApi, 'patchProject')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }) as never)
      .mockResolvedValue({ updated_at: 'v2' } as never);
    const { result } = renderHook(() => useSegmentedEntitySync({
      projectId: 'p1', enabled: true, debounceMs: 1,
    }));

    result.current.queueProject({ name: 'first' });
    await waitFor(() => expect(patchProject).toHaveBeenCalledTimes(1));

    result.current.queueProject({ name: 'second' });
    await new Promise((r) => setTimeout(r, 20));
    expect(patchProject, '第一次未完成前不得发第二次').toHaveBeenCalledTimes(1);

    resolveFirst({ updated_at: 'v1' });
    await waitFor(() => expect(patchProject).toHaveBeenCalledTimes(2));
    expect(patchProject.mock.calls[1][1]).toEqual({ name: 'second' });
  });

  it('文档写走专用端点，并回传服务端版本', async () => {
    const putSourceDocument = vi.spyOn(segmentedProjectApi, 'putSourceDocument')
      .mockResolvedValue({ path: 'source.md', project_updated_at: 'v-source' });
    const onServerVersion = vi.fn();
    const { result } = renderHook(() => useSegmentedEntitySync({
      projectId: 'p1', enabled: true, debounceMs: 1, onServerVersion,
    }));

    result.current.queueDocument('source_document', '正文');

    await waitFor(() => expect(putSourceDocument).toHaveBeenCalledWith('p1', '正文'));
    await waitFor(() => expect(onServerVersion).toHaveBeenCalledWith('v-source'));
  });

  it('enabled=false 时不发请求', async () => {
    const patchProject = vi.spyOn(segmentedProjectApi, 'patchProject');
    const { result } = renderHook(() => useSegmentedEntitySync({
      projectId: 'p1', enabled: false, debounceMs: 1,
    }));

    result.current.queueProject({ name: 'A' });
    await new Promise((r) => setTimeout(r, 20));
    expect(patchProject).not.toHaveBeenCalled();
  });
});
