import type { SegmentedProject } from '../types';
import { _openDB, _DRAFTS_STORE } from './indexedDB';

export interface ProjectDraftRecord {
  project_id: string;
  draft: SegmentedProject;
  base_updated_at: string | null;
  updated_at: string;
  dirty: boolean;
  last_save_attempt_at?: string;
  last_save_error?: string;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | T,
): Promise<T> {
  return _openDB().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const s = t.objectStore(storeName);
    const r = fn(s);
    t.oncomplete = () => {
      if (r instanceof IDBRequest) resolve(r.result as T);
      else resolve(r as T);
    };
    t.onerror = () => reject(t.error);
  }));
}

export async function getDraft(projectId: string): Promise<ProjectDraftRecord | undefined> {
  return tx<ProjectDraftRecord | undefined>(_DRAFTS_STORE, 'readonly', (s) => s.get(projectId));
}

export async function putDraft(record: ProjectDraftRecord): Promise<void> {
  await tx(_DRAFTS_STORE, 'readwrite', (s) => s.put(record));
}

export async function deleteDraft(projectId: string): Promise<void> {
  await tx(_DRAFTS_STORE, 'readwrite', (s) => s.delete(projectId));
}

export async function listDrafts(): Promise<ProjectDraftRecord[]> {
  return tx<ProjectDraftRecord[]>(_DRAFTS_STORE, 'readonly', (s) => s.getAll());
}
