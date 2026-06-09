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
}

export function useSegmentedDraftSync(projectId: string | null, options: DraftSyncOptions) {
  const { storage, debounceMs = DEBOUNCE_MS } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  // Stash projectId/storage in refs so the timer callback always reads current values
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const storageRef = useRef(storage);
  storageRef.current = storage;

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
    } catch (e: any) {
      const next: ProjectDraftRecord = {
        ...rec,
        dirty: true,
        last_save_error: e?.message ?? String(e),
        last_save_attempt_at: new Date().toISOString(),
      };
      await putDraft(next);
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
