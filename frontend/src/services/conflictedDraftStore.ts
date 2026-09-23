import { _openDB, _CONFLICTED_DRAFTS_STORE } from './indexedDB';
import type { ProjectDraftRecord } from './segmentedDraftStore';

/** 每项目保留的归档上限，超出淘汰最旧。 */
const KEEP_PER_PROJECT = 10;

export interface ConflictedDraftEntry {
  id: string;
  project_id: string;
  archived_at: string;
  record: ProjectDraftRecord;
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | T,
): Promise<T> {
  return _openDB().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(_CONFLICTED_DRAFTS_STORE, mode);
    const s = t.objectStore(_CONFLICTED_DRAFTS_STORE);
    const r = fn(s);
    t.oncomplete = () => {
      if (r instanceof IDBRequest) resolve(r.result as T);
      else resolve(r as T);
    };
    t.onerror = () => reject(t.error);
  }));
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getAll(): Promise<ConflictedDraftEntry[]> {
  return tx<ConflictedDraftEntry[]>('readonly', (s) => s.getAll());
}

/**
 * 归档一份冲突草稿（409 真冲突、即将被用户裁决放弃前调用）。
 * 写入后按项目 prune，只保留最近 KEEP_PER_PROJECT 份。
 */
export async function putConflictedDraft(
  projectId: string,
  record: ProjectDraftRecord,
): Promise<ConflictedDraftEntry> {
  const entry: ConflictedDraftEntry = {
    id: makeId(),
    project_id: projectId,
    archived_at: new Date().toISOString(),
    record,
  };
  await tx('readwrite', (s) => s.put(entry));
  await pruneProject(projectId);
  return entry;
}

/** 列出归档（可按项目过滤），按归档时间降序（新在前）。 */
export async function listConflictedDrafts(projectId?: string): Promise<ConflictedDraftEntry[]> {
  const all = await getAll();
  return all
    .filter((e) => !projectId || e.project_id === projectId)
    .sort((a, b) => (a.archived_at < b.archived_at ? 1 : a.archived_at > b.archived_at ? -1 : 0));
}

export async function deleteConflictedDraft(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

/** 测试辅助：清空归档 store。 */
export async function clearConflictedDrafts(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
}

async function pruneProject(projectId: string): Promise<void> {
  const all = await getAll();
  const ofProject = all
    .filter((e) => e.project_id === projectId)
    .sort((a, b) => (a.archived_at < b.archived_at ? -1 : a.archived_at > b.archived_at ? 1 : 0));
  const excess = ofProject.length - KEEP_PER_PROJECT;
  if (excess <= 0) return;
  for (let i = 0; i < excess; i++) {
    await deleteConflictedDraft(ofProject[i].id);
  }
}
