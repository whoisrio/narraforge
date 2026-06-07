import type { SegmentedProject } from '../types';
import { _openDB, _SEGMENTED_PROJECTS_STORE, deleteTTSResult } from './indexedDB';

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

export async function saveProject(project: SegmentedProject): Promise<void> {
  await tx(_SEGMENTED_PROJECTS_STORE, 'readwrite', (s) => s.put(project));
}

export async function getProject(id: string): Promise<SegmentedProject | undefined> {
  return tx<SegmentedProject | undefined>(_SEGMENTED_PROJECTS_STORE, 'readonly', (s) => s.get(id));
}

export async function listProjects(): Promise<SegmentedProject[]> {
  const all = await tx<SegmentedProject[]>(_SEGMENTED_PROJECTS_STORE, 'readonly', (s) => s.getAll());
  return all.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export async function deleteProject(id: string): Promise<void> {
  const project = await getProject(id);
  if (project) {
    const audioIds = new Set<string>();
    for (const seg of project.segments) {
      if (seg.current_audio_id) audioIds.add(seg.current_audio_id);
      if (seg.previous_audio_id) audioIds.add(seg.previous_audio_id);
    }
    for (const aid of audioIds) {
      try {
        await deleteTTSResult(aid);
      } catch (e) {
        console.warn(`Failed to clean orphan audio ${aid}:`, e);
      }
    }
  }
  await tx(_SEGMENTED_PROJECTS_STORE, 'readwrite', (s) => s.delete(id));
}
