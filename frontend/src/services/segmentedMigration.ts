import axios from 'axios';
import type { SegmentedProject } from '../types';
import { indexedDBStorage } from './segmentedProjectStorage';
import { getTTSAudioBlob } from './indexedDB';

const api = axios.create({ baseURL: '/api' });

export interface MigrationResult {
  project_id: string;
  status: 'ok' | 'error';
  message?: string;
  audio_uploaded?: number;
  audio_failed?: number;
}

export async function migrateIndexedDBProjectsToBackend(): Promise<MigrationResult[]> {
  const localProjects = await indexedDBStorage.listProjects();
  if (localProjects.length === 0) return [];

  const audios: Array<{ project_id: string; chapter_id: string; segment_id: string; data_base64: string }> = [];
  for (const p of localProjects) {
    for (const ch of p.chapters || []) {
      for (const seg of ch.segments || []) {
        if (seg.audio.current?.id) {
          const blob = await getTTSAudioBlob(seg.audio.current.id);
          if (blob) {
            const buf = await blob.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let bin = '';
            for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
            audios.push({
              project_id: p.id, chapter_id: ch.id, segment_id: seg.id, data_base64: btoa(bin),
            });
          }
        }
      }
    }
  }

  // Strip current_audio_id since the backend will return its own current_audio_path
  const projects: SegmentedProject[] = localProjects.map((p) => JSON.parse(JSON.stringify(p)) as SegmentedProject);
  for (const proj of projects) {
    for (const ch of proj.chapters || []) {
      for (const seg of ch.segments || []) {
        seg.audio.current = undefined;
        seg.audio.previous = undefined;
      }
    }
  }

  const { data } = await api.post<{ results: MigrationResult[] }>(
    '/segmented-projects/migrate',
    { projects, audios },
  );
  return data.results;
}

export async function clearLocalProjects(projectIds: string[]): Promise<void> {
  for (const id of projectIds) {
    await indexedDBStorage.deleteProject(id);
  }
}
