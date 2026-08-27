import { useCallback, useEffect, useRef } from 'react';
import type { SegmentedProject } from '../types';
import type { SegmentedProjectStorage } from '../services/segmentedProjectStorage';
import {
  getDraft,
  putDraft,
  type ProjectDraftRecord,
} from '../services/segmentedDraftStore';

const DEBOUNCE_MS = 1000;

export interface DraftSyncOptions {
  storage: SegmentedProjectStorage;
  /** Debounce delay; default 1000ms. Set to 0 or low value in tests. */
  debounceMs?: number;
  /** 草稿成功写入后端后回调（用于同步"已落库章节集合"等派生状态）。 */
  onSaved?: (project: SegmentedProject) => void;
  /** 草稿写入后端失败时回调（用于 422/409 等结构化错误码的兜底提示）。 */
  onSaveError?: (error: unknown) => void;
}

export function useSegmentedDraftSync(projectId: string | null, options: DraftSyncOptions) {
  const { storage, debounceMs = DEBOUNCE_MS, onSaved, onSaveError } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  // Stash projectId/storage in refs so the timer callback always reads current values
  const projectIdRef = useRef(projectId);
  const storageRef = useRef(storage);
  const onSavedRef = useRef(onSaved);
  const onSaveErrorRef = useRef(onSaveError);

  useEffect(() => {
    projectIdRef.current = projectId;
    storageRef.current = storage;
    onSavedRef.current = onSaved;
    onSaveErrorRef.current = onSaveError;
  }, [projectId, storage, onSaved, onSaveError]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Flush reads the latest draft from the draft store and pushes it to the backend.
  const flush = useCallback(async (): Promise<void> => {
    const pid = projectIdRef.current;
    if (!pid) return;
    const rec = await getDraft(pid);
    if (!rec || !rec.dirty) return;
    try {
      // 乐观锁：携带草稿基于的服务端版本；陈旧则被后端 409 拒绝（onSaveError 恢复）
      const saved = await storageRef.current.saveProject(rec.draft, {
        base_updated_at: rec.base_updated_at,
      });
      // 保存耗时期间若有更新的 markDirty 写入（记录 updated_at 已变），本份草稿
      // 已过期：直接返回，保留新草稿与 dirty 标记（新草稿的 flush 已由该次
      // markDirty 排程）。否则收尾 putDraft 会把新草稿整份覆盖成旧草稿，
      // 导致新状态的保存永远丢失（曾表现为"合成成功但音频 404"）。
      const latest = await getDraft(pid);
      if (!latest || latest.updated_at !== rec.updated_at) return;
      const next: ProjectDraftRecord = {
        ...rec,
        // 新 base 取服务端权威 updated_at（响应）；存储不支持返回值时回退草稿时间戳
        base_updated_at: saved?.updated_at ?? rec.draft.updated_at,
        dirty: false,
        last_save_error: undefined,
        last_save_attempt_at: new Date().toISOString(),
      };
      await putDraft(next);
      dirtyRef.current = false;
      onSavedRef.current?.(rec.draft);
    } catch (error: unknown) {
      // 与成功路径同理：仅当草稿记录仍是本份时才回写错误状态，
      // 避免覆盖保存期间写入的更新草稿（其 dirty 与排程 flush 保留）。
      const latest = await getDraft(pid);
      if (latest && latest.updated_at === rec.updated_at) {
        const next: ProjectDraftRecord = {
          ...rec,
          dirty: true,
          last_save_error: error instanceof Error ? error.message : String(error),
          last_save_attempt_at: new Date().toISOString(),
        };
        await putDraft(next);
      }
      onSaveErrorRef.current?.(error);
    }
  }, []);

  const schedule = useCallback(() => {
    clearTimer();
    if (!projectId) return;
    timerRef.current = setTimeout(() => {
      void flush();
    }, debounceMs);
  }, [clearTimer, projectId, debounceMs, flush]);

  const markDirty = useCallback(async (project: SegmentedProject) => {
    if (!projectId) return;
    const now = new Date().toISOString();
    const existing = (await getDraft(projectId)) ?? null;
    const rec: ProjectDraftRecord = {
      project_id: projectId,
      draft: project,
      base_updated_at: existing?.base_updated_at ?? null,
      updated_at: now,
      dirty: true,
    };
    await putDraft(rec);
    dirtyRef.current = true;
    schedule();
  }, [projectId, schedule]);

  const adoptBackendVersion = useCallback(async (project: SegmentedProject) => {
    if (!projectId) return;
    const rec: ProjectDraftRecord = {
      project_id: projectId,
      draft: project,
      base_updated_at: project.updated_at,
      updated_at: project.updated_at,
      dirty: false,
    };
    await putDraft(rec);
    dirtyRef.current = false;
    clearTimer();
  }, [projectId, clearTimer]);

  const loadDraft = useCallback(async (): Promise<ProjectDraftRecord | undefined> => {
    if (!projectId) return undefined;
    return getDraft(projectId);
  }, [projectId]);

  const noteServerVersion = useCallback(async (serverUpdatedAt: string) => {
    // 服务端被细粒度端点（合成/PATCH/adjust 等）推进后，把乐观锁 base 前移，
    // 避免下一次整包 PUT 因 base 过期被 409。不动 draft 内容（本地编辑仍在）。
    if (!projectId) return;
    const rec = await getDraft(projectId);
    if (!rec || rec.base_updated_at === serverUpdatedAt) return;
    await putDraft({ ...rec, base_updated_at: serverUpdatedAt });
  }, [projectId]);

  const refreshDraft = useCallback(async (project: SegmentedProject) => {
    // touch=false 的变更（PATCH/结构端点已远端持久化）不触发 markDirty，
    // 但已有草稿（尤其 dirty 待冲刷的）内容必须随本地态刷新——否则冲刷时
    // 会把陈旧快照整包 PUT 回去，覆盖 PATCH 刚写入的字段（2026-08-27
    // dialogue-prosody e2e：kind 切换的 PATCH 被进入工作室时标记的
    // 陈旧草稿 PUT 覆盖回 narration）。
    // 只更新已有记录：无记录时不创建（初始加载等场景不制造草稿）。
    if (!projectId) return;
    const rec = await getDraft(projectId);
    if (!rec) return;
    await putDraft({ ...rec, draft: project });
  }, [projectId]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { markDirty, flush, adoptBackendVersion, loadDraft, noteServerVersion, refreshDraft };
}
