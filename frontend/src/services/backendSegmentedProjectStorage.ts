import axios from 'axios';
import type { SegmentedProject } from '../types';
import type { SegmentedProjectStorage, SaveOptions } from './segmentedProjectStorage';

const api = axios.create({ baseURL: '/api' });

interface ListResponse {
  id: string;
  name: string;
  schema_version: number;
  layout: string;
  active_chapter_id: string | null;
  created_at: string;
  updated_at: string;
}

export const backendStorage: SegmentedProjectStorage = {
  async listProjects() {
    const { data } = await api.get<ListResponse[]>('/segmented-projects');
    return data.map((p) => ({
      schema_version: 2,
      id: p.id, name: p.name,
      layout: (p.layout === 'horizontal' ? 'horizontal' : 'vertical') as 'vertical' | 'horizontal',
      chapters: [],
      active_chapter_id: p.active_chapter_id ?? undefined,
      created_at: p.created_at, updated_at: p.updated_at,
    } as SegmentedProject));
  },
  async getProject(id: string) {
    const { data } = await api.get<SegmentedProject>(`/segmented-projects/${id}`);
    return data;
  },
  async saveProject(project: SegmentedProject, _opts?: SaveOptions) {
    await api.put(`/segmented-projects/${project.id}`, project);
  },
  async deleteProject(id: string) {
    await api.delete(`/segmented-projects/${id}`);
  },
};
