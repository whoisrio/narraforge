import type { SegmentedProject } from '../types';
import { segmentedProjectDB } from './segmentedProjectDB';

export interface SaveOptions {
  mode?: 'debounced' | 'immediate';
  /** 乐观锁：本 payload 基于的服务端 updated_at（backend 存储模式使用）。 */
  base_updated_at?: string | null;
}

export interface SegmentedProjectStorage {
  listProjects(): Promise<SegmentedProject[]>;
  getProject(id: string): Promise<SegmentedProject | undefined>;
  /** 返回服务端保存后的项目（含权威 updated_at）；不支持该语义的存储返回 undefined。 */
  saveProject(project: SegmentedProject, options?: SaveOptions): Promise<SegmentedProject | undefined>;
  deleteProject(id: string): Promise<void>;
  flushPendingSave?(projectId: string): Promise<void>;
}

export const indexedDBStorage: SegmentedProjectStorage = {
  async listProjects() { return segmentedProjectDB.listProjects(); },
  async getProject(id) { return segmentedProjectDB.getProject(id); },
  async saveProject(project, _options) { await segmentedProjectDB.saveProject(project); return undefined; },
  async deleteProject(id) { await segmentedProjectDB.deleteProject(id); },
};
