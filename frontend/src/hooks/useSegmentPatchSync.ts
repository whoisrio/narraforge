import { useCallback, useEffect, useRef } from 'react';
import { segmentedProjectApi } from '../services/api';
import type { SegmentPatchBody } from '../services/api';

export interface UseSegmentPatchSyncOptions {
  projectId: string;
  /** backend 存储模式且非草稿项目时为 true；false 时 queue 静默丢弃（走 IndexedDB autosave） */
  enabled: boolean;
  /** PATCH 成功：携带服务端段数据与项目最新 updated_at（用于推进乐观锁 base） */
  onPatched?: (segmentId: string, segment: unknown, projectUpdatedAt: string) => void;
  onError?: (error: unknown) => void;
  debounceMs?: number;
}

interface PendingPatch {
  chapterId: string;
  body: SegmentPatchBody;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 段级编辑的远端同步：同段多次编辑合并为一次 PATCH（防抖），替代
 * 整包 PUT autosave。卸载时冲刷未发请求，避免丢尾部击键。
 */
export function useSegmentPatchSync(options: UseSegmentPatchSyncOptions) {
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = options; });
  const pendingRef = useRef(new Map<string, PendingPatch>());

  const flushOne = useCallback(async (segmentId: string) => {
    const pending = pendingRef.current.get(segmentId);
    if (!pending) return;
    pendingRef.current.delete(segmentId);
    const { projectId, onPatched, onError } = optionsRef.current;
    try {
      const resp = await segmentedProjectApi.patchSegment(
        projectId, pending.chapterId, segmentId, pending.body,
      );
      onPatched?.(segmentId, resp.segment, resp.project_updated_at);
    } catch (error) {
      onError?.(error);
    }
  }, []);

  const queue = useCallback((segmentId: string, chapterId: string, body: SegmentPatchBody) => {
    const { enabled, debounceMs = 800 } = optionsRef.current;
    if (!enabled) return;
    const existing = pendingRef.current.get(segmentId);
    if (existing) clearTimeout(existing.timer);
    const merged: SegmentPatchBody = { ...(existing?.body ?? {}), ...body };
    const timer = setTimeout(() => { void flushOne(segmentId); }, debounceMs);
    pendingRef.current.set(segmentId, { chapterId, body: merged, timer });
  }, [flushOne]);

  // 卸载/项目切换时立即冲刷待发 PATCH（尾部击键不丢）
  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const [segmentId, p] of pending) {
        clearTimeout(p.timer);
        void flushOne(segmentId);
      }
    };
  }, [flushOne]);

  return { queue };
}
