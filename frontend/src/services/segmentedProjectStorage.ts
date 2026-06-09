import type { SegmentedProject } from '../types';
import { segmentedProjectDB } from './segmentedProjectDB';

export interface SaveOptions {
  mode?: 'debounced' | 'immediate';
}

export interface SegmentedProjectStorage {
  listProjects(): Promise<SegmentedProject[]>;
  getProject(id: string): Promise<SegmentedProject | undefined>;
  saveProject(project: SegmentedProject, options?: SaveOptions): Promise<void>;
  deleteProject(id: string): Promise<void>;
  flushPendingSave?(projectId: string): Promise<void>;
}

export const indexedDBStorage: SegmentedProjectStorage = {
  async listProjects() { return segmentedProjectDB.listProjects(); },
  async getProject(id) { return segmentedProjectDB.getProject(id); },
  async saveProject(project) { await segmentedProjectDB.saveProject(project); },
  async deleteProject(id) { await segmentedProjectDB.deleteProject(id); },
};
