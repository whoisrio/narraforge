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
      await storageRef.current.saveProject(rec.draft);
      const next: ProjectDraftRecord = {
        ...rec,
        base_updated_at: rec.draft.updated_at,
        dirty: false,
        last_save_error: undefined,
        last_save_attempt_at: new Date().toISOString(),
      };
      await putDraft(next);
      dirtyRef.current = false;
      onSavedRef.current?.(rec.draft);
    } catch (error: unknown) {
      const next: ProjectDraftRecord = {
        ...rec,
        dirty: true,
        last_save_error: error instanceof Error ? error.message : String(error),
        last_save_attempt_at: new Date().toISOString(),
      };
      await putDraft(next);
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

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { markDirty, flush, adoptBackendVersion, loadDraft };
}
