import axios from 'axios';
import type { VoiceProfile, TTSConfig, TTSRequest, TTSResult, TTSResultRecord, EdgeVoice } from '../types';

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
  getVoices: async (): Promise<VoiceProfile[]> => {
    const { data } = await api.get<{ voices: VoiceProfile[] }>('/tts/voices');
    return data.voices;
  },

  synthesize: async (request: TTSRequest): Promise<TTSResult> => {
    const { data } = await api.post<TTSResult>('/tts/synthesize', request);
    return data;
  },

  batch: async (segments: { text: string; start_time: number; end_time: number }[], params: Omit<TTSRequest, 'text' | 'voice_id'> & { voice_id: string }) => {
    const { data } = await api.post('/tts/batch', {
      segments,
      ...params
    });
    return data;
  },

  getHistory: async (): Promise<TTSResultRecord[]> => {
    const { data } = await api.get<{ results: TTSResultRecord[] }>('/tts/history');
    return data.results;
  },

  deleteResult: async (id: string): Promise<void> => {
    await api.delete(`/tts/history/${id}`);
  },

  getEdgeVoices: async (language?: string, gender?: string): Promise<EdgeVoice[]> => {
    const params = new URLSearchParams();
    if (language) params.set('language', language);
    if (gender) params.set('gender', gender);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const { data } = await api.get<{ voices: EdgeVoice[] }>(`/tts/edge-voices${qs}`);
    return data.voices;
  },

  getEdgeLanguages: async (): Promise<string[]> => {
    const { data } = await api.get<{ languages: string[] }>('/tts/edge-languages');
    return data.languages;
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

export interface TranscribeResult {
  file_id: string;
  filename: string;
  content: string;
  language: string;
  language_probability: number;
  download_url: string;
}

export interface TranscriptionRecord {
  id: string;
  original_filename: string;
  audio_url: string;
  srt_download_url: string;
  language: string;
  language_probability: number;
  model_size: string;
  created_at: string;
}

export const speechToTextApi = {
  transcribe: async (
    file: File,
    modelSize: string = 'large-v3',
    beamSize: number = 5,
  ): Promise<TranscribeResult> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model_size', modelSize);
    formData.append('beam_size', String(beamSize));
    const { data } = await api.post<TranscribeResult>('/speech-to-text/transcribe', formData);
    return data;
  },

  getHistory: async (): Promise<TranscriptionRecord[]> => {
    const { data } = await api.get<{ results: TranscriptionRecord[] }>('/speech-to-text/history');
    return data.results;
  },

  deleteRecord: async (id: string): Promise<void> => {
    await api.delete(`/speech-to-text/history/${id}`);
  },
};

export default api;