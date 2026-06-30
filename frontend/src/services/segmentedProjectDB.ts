import type { SegmentedProject, Segment } from '../types';
import { _openDB, _SEGMENTED_PROJECTS_STORE, deleteTTSResult } from './indexedDB';

type LegacySegmentedProject = SegmentedProject & { segments?: Segment[] };

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

async function collectAudioIds(project: SegmentedProject): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const ch of project.chapters || []) {
    for (const seg of ch.segments || []) {
      if (seg.audio.current?.id) ids.add(seg.audio.current.id);
      if (seg.audio.previous?.id) ids.add(seg.audio.previous.id);
    }
  }
  // v1 fallback: top-level segments
  const legacyProject = project as LegacySegmentedProject;
  if (legacyProject.segments) {
    for (const seg of legacyProject.segments) {
      if (seg.audio.current?.id) ids.add(seg.audio.current.id);
      if (seg.audio.previous?.id) ids.add(seg.audio.previous.id);
    }
  }
  return ids;
}

export const segmentedProjectDB = {
  async saveProject(project: SegmentedProject): Promise<void> {
    await tx(_SEGMENTED_PROJECTS_STORE, 'readwrite', (s) => s.put(project));
  },
  async getProject(id: string): Promise<SegmentedProject | undefined> {
    return tx<SegmentedProject | undefined>(_SEGMENTED_PROJECTS_STORE, 'readonly', (s) => s.get(id));
  },
  async listProjects(): Promise<SegmentedProject[]> {
    const all = await tx<SegmentedProject[]>(_SEGMENTED_PROJECTS_STORE, 'readonly', (s) => s.getAll());
    return all.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  },
  async deleteProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    if (project) {
      const audioIds = await collectAudioIds(project);
      for (const aid of audioIds) {
        try { await deleteTTSResult(aid); } catch (e) { console.warn(`Failed to clean orphan audio ${aid}:`, e); }
      }
    }
    await tx(_SEGMENTED_PROJECTS_STORE, 'readwrite', (s) => s.delete(id));
  },
};
