import axios from 'axios';
import type { SegmentedProject } from '../types';
import type { SaveOptions, SegmentedProjectStorage } from './segmentedProjectStorage';
import { API_BASE_URL } from './apiBase';
import { applyAuthInterceptors } from './auth';

export const api = axios.create({ baseURL: API_BASE_URL, withCredentials: true });
applyAuthInterceptors(api);

interface ListResponse {
  id: string;
  name: string;
  schema_version: number;
  layout: string;
  active_chapter_id: string | null;
  created_at: string;
  updated_at: string;
  remotion_project_path?: string | null;
  summary_stats?: SegmentedProject['summary_stats'];
}

export const backendStorage: SegmentedProjectStorage = {
  async listProjects() {
    const { data } = await api.get<{ items: ListResponse[] }>('/segmented-projects');
    return data.items.map((p) => ({
      schema_version: 2,
      id: p.id, name: p.name,
      layout: (p.layout === 'horizontal' ? 'horizontal' : 'vertical') as 'vertical' | 'horizontal',
      chapters: [],
      active_chapter_id: p.active_chapter_id ?? undefined,
      remotion_project_path: p.remotion_project_path ?? null,
      summary_stats: p.summary_stats ?? null,
      created_at: p.created_at, updated_at: p.updated_at,
    } as SegmentedProject));
  },
  async getProject(id: string) {
    const { data } = await api.get<SegmentedProject>(`/segmented-projects/${id}`);
    return data;
  },
  async saveProject(project: SegmentedProject, options?: SaveOptions) {
    const payload = {
      ...project,
      // 乐观锁：草稿基于的服务端版本；undefined 会被 JSON 序列化丢弃（不校验）
      base_updated_at: options?.base_updated_at ?? undefined,
      chapters: project.chapters.map((chapter) => ({
        ...chapter,
        segments: chapter.segments.map((segment) => ({
          ...segment,
          locked_params: [],
        })),
      })),
    };
    const { data } = await api.put(`/segmented-projects/${project.id}`, payload);
    return data as SegmentedProject;
  },
  async deleteProject(id: string) {
    await api.delete(`/segmented-projects/${id}`);
  },
};
