import axios from 'axios';
import type { VoiceProfile, TTSConfig, TimelineProject, TTSRequest, TTSResult } from '../types';

const api = axios.create({
  baseURL: '/api',
});

// Voice Clone API
export const voiceApi = {
  upload: async (file: File): Promise<VoiceProfile> => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post<VoiceProfile>('/clone/upload', formData);
    return data;
  },

  list: async (): Promise<VoiceProfile[]> => {
    const { data } = await api.get<VoiceProfile[]>('/clone/list');
    return data;
  },

  // 只获取已克隆的声音（从 Qwen 同步的）
  listCloned: async (): Promise<VoiceProfile[]> => {
    const all = await voiceApi.list();
    return all.filter(v => v.is_cloned && v.qwen_voice_id);
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/clone/${id}`);
  },

  // 从 Qwen 同步已克隆的声音
  syncFromQwen: async () => {
    const { data } = await api.post('/clone/sync-from-qwen');
    return data;
  },

  // 使用克隆声音合成文本
  synthesize: async (voiceId: string, text: string, speed: number = 1.0, volume: number = 80, pitch: number = 0) => {
    const { data } = await api.post('/clone/synthesize', {
      voice_id: voiceId,
      text,
      speed,
      volume,
      pitch,
    });
    return data;
  },
};

// TTS API
export const ttsApi = {
  synthesize: async (request: TTSRequest): Promise<TTSResult> => {
    const { data } = await api.post<TTSResult>('/tts/synthesize', request);
    return data;
  },

  batch: async (segments: { text: string; start_time: number; end_time: number }[], params: Omit<TTSRequest, 'text' | 'voice_id'>) => {
    const { data } = await api.post('/tts/batch', {
      segments,
      ...params
    });
    return data;
  },
};

// Config API
export const configApi = {
  listModels: async (): Promise<TTSConfig[]> => {
    const { data } = await api.get<TTSConfig[]>('/config/models');
    return data;
  },

  createModel: async (config: Omit<TTSConfig, 'id' | 'is_default'>): Promise<TTSConfig> => {
    const { data } = await api.post<TTSConfig>('/config/models', config);
    return data;
  },

  updateModel: async (id: string, config: Partial<TTSConfig>): Promise<TTSConfig> => {
    const { data } = await api.put<TTSConfig>(`/config/models/${id}`, config);
    return data;
  },

  deleteModel: async (id: string): Promise<void> => {
    await api.delete(`/config/models/${id}`);
  },

  setDefault: async (id: string): Promise<void> => {
    await api.post(`/config/models/${id}/set-default`);
  },
};

// Timeline API
export const timelineApi = {
  listProjects: async (): Promise<TimelineProject[]> => {
    const { data } = await api.get<TimelineProject[]>('/timeline/project');
    return data;
  },

  createProject: async (name: string): Promise<TimelineProject> => {
    const { data } = await api.post<TimelineProject>('/timeline/project', { name });
    return data;
  },

  getProject: async (id: string): Promise<TimelineProject> => {
    const { data } = await api.get<TimelineProject>(`/timeline/project/${id}`);
    return data;
  },

  uploadVideo: async (projectId: string, file: File): Promise<{ video_url: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post<{ video_url: string }>(`/timeline/project/${projectId}/video`, formData);
    return data;
  },

  addSegment: async (projectId: string, text: string, startTime: number, endTime: number) => {
    const { data } = await api.post(`/timeline/project/${projectId}/segment`, {
      text,
      start_time: startTime,
      end_time: endTime
    });
    return data;
  },

  deleteSegment: async (segmentId: string): Promise<void> => {
    await api.delete(`/timeline/segment/${segmentId}`);
  },

  synthesizeProject: async (projectId: string): Promise<{ segments: Array<{ segment_id: string; audio_id: string; audio_url: string; text: string; start_time: number; end_time: number }> }> => {
    const { data } = await api.post(`/timeline/project/${projectId}/synthesize`);
    return data;
  },
};

export default api;