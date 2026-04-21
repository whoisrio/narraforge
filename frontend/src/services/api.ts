import axios from 'axios';
import type { VoiceProfile, TTSConfig, TTSRequest, TTSResult, DefaultVoice } from '../types';

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
  getVoices: async (): Promise<{ default: DefaultVoice[]; cloned: VoiceProfile[] }> => {
    const { data } = await api.get<{ default: DefaultVoice[]; cloned: VoiceProfile[] }>('/tts/voices');
    return data;
  },

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

export default api;