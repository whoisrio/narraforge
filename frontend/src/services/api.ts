import axios from 'axios';
import type { VoiceProfile, TTSConfig, TTSRequest, TTSResult, TTSResultRecord, EdgeVoice, MiMoPresetVoice, ModelConfigs, LLMSplitSegmentItem, SSMLAnnotationItem, VoxCPMStatus } from '../types';

const api = axios.create({
  baseURL: '/api',
});

// Voice Clone API
export const voiceApi = {
  upload: async (file: File, promptText?: string): Promise<VoiceProfile> => {
    const formData = new FormData();
    formData.append('file', file);
    if (promptText) formData.append('prompt_text', promptText);
    const { data } = await api.post<VoiceProfile>('/clone/upload', formData);
    return data;
  },

  /** 从公网 URL 下载音频并创建声音记录，后端会校验 URL 可访问性并下载到 uploads 目录 */
  uploadFromUrl: async (audioUrl: string, name?: string, promptText?: string): Promise<VoiceProfile> => {
    const { data } = await api.post<VoiceProfile>('/clone/upload-from-url', {
      audio_url: audioUrl,
      name,
      prompt_text: promptText,
    });
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

  createClone: async (voiceId: string, name?: string): Promise<VoiceProfile> => {
    const { data } = await api.post<VoiceProfile>('/clone/create-clone', {
      voice_id: voiceId,
      name,
    });
    return data;
  },

  /** MiMo 声音复刻 - 仅标记为 MiMo 复刻，无需云端注册 */
  createCloneMiMo: async (voiceId: string, name?: string): Promise<VoiceProfile> => {
    const { data } = await api.post<VoiceProfile>('/clone/create-clone-mimo', {
      voice_id: voiceId,
      name,
    });
    return data;
  },

  /** VoxCPM 声音复刻 - 仅标记为 VoxCPM 复刻，本地 GPU 推理无需云端注册 */
  createCloneVoxCPM: async (voiceId: string, name?: string): Promise<VoiceProfile> => {
    const { data } = await api.post<VoiceProfile>('/clone/create-clone-voxcpm', {
      voice_id: voiceId,
      name,
    });
    return data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/clone/${id}`);
  },

  // 从 Qwen 同步已克隆的声音
  syncFromQwen: async () => {
    const { data } = await api.post('/clone/sync-from-qwen');
    return data;
  },

  // 更新声音描述
  updateDescription: async (id: string, description: string, promptText?: string): Promise<void> => {
    await api.patch(`/clone/${id}/description`, { description, prompt_text: promptText });
  },

  // 更新声音的 prompt_text
  updatePromptText: async (id: string, promptText: string): Promise<void> => {
    await api.patch(`/clone/${id}/description`, { description: '', prompt_text: promptText });
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

// MiMo TTS API
export const mimoTtsApi = {
  /** 获取 MiMo 预置音色列表 */
  getPresetVoices: async (): Promise<MiMoPresetVoice[]> => {
    const { data } = await api.get<{ voices: MiMoPresetVoice[] }>('/mimo-tts/voices');
    return data.voices;
  },

  /** 使用预置音色合成语音 */
  synthesizePreset: async (params: {
    text: string;
    voice: string;
    instruction?: string;
    format?: string;
  }): Promise<TTSResult> => {
    const { data } = await api.post<TTSResult>('/mimo-tts/preset', params);
    return data;
  },

  /** 使用文本描述设计音色合成语音 */
  synthesizeVoiceDesign: async (params: {
    voice_description: string;
    text?: string;
    optimize_text_preview?: boolean;
    format?: string;
  }): Promise<TTSResult> => {
    const { data } = await api.post<TTSResult>('/mimo-tts/voicedesign', params);
    return data;
  },

  /** 使用本地声音进行音色复刻合成 */
  synthesizeVoiceClone: async (params: {
    text: string;
    voice_id: string;
    instruction?: string;
    format?: string;
  }): Promise<TTSResult> => {
    const { data } = await api.post<TTSResult>('/mimo-tts/voiceclone', params);
    return data;
  },

  /** 直接使用 Base64 音频进行音色复刻合成 */
  synthesizeVoiceCloneDirect: async (params: {
    text: string;
    audio_base64: string;
    mime_type?: string;
    instruction?: string;
    format?: string;
  }): Promise<TTSResult> => {
    const { data } = await api.post<TTSResult>('/mimo-tts/voiceclone-direct', params);
    return data;
  },
};

// Config API
export const configApi = {
  listModels: async (): Promise<TTSConfig[]> => {
    const { data } = await api.get<TTSConfig[]>('/config/models');
    return data;
  },

  createModel: async (config: Omit<TTSConfig, 'id' | 'is_default' | 'created_at'>): Promise<TTSConfig> => {
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

  getStorageMode: async (): Promise<{ storage_mode: string }> => {
    const { data } = await api.get<{ storage_mode: string }>('/config/storage-mode');
    return data;
  },

  setStorageMode: async (mode: string): Promise<{ storage_mode: string }> => {
    const { data } = await api.put<{ storage_mode: string }>('/config/storage-mode', { storage_mode: mode });
    return data;
  },
};

export interface TranscribeResult {
  file_id: string;
  filename: string;
  content: string;
  language: string;
  language_probability: number;
  device?: string;
  compute_type?: string;
  engine?: string;
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
    engine: string = 'whisper',
    enableVad: boolean = true,
  ): Promise<TranscribeResult> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model_size', modelSize);
    formData.append('beam_size', String(beamSize));
    formData.append('engine', engine);
    formData.append('enable_vad', String(enableVad));
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

  /** 多音频合并转写：按顺序上传多个音频文件，后端用 ffmpeg 合并后统一识别 */
  multiTranscribe: async (
    files: File[],
    modelSize: string = 'large-v3',
    beamSize: number = 5,
    engine: string = 'whisper',
    enableVad: boolean = true,
  ): Promise<TranscribeResult> => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    formData.append('model_size', modelSize);
    formData.append('beam_size', String(beamSize));
    formData.append('engine', engine);
    formData.append('enable_vad', String(enableVad));
    const { data } = await api.post<TranscribeResult>('/speech-to-text/multi-transcribe', formData);
    return data;
  },
};

export default api;

// Subtitle LLM API (校准 + 翻译)
export interface CorrectionSuggestion {
  index: number;
  original: string;
  suggested: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface BilingualSegment {
  index: number;
  time_line: string;
  original: string;
  translated: string;
}

export const subtitleLlmApi = {
  /** LLM 字幕校准 — 对比原始文稿，找出错别字 */
  correct: async (srtContent: string, originalDocument: string, language = 'zh', mode = 'smart'): Promise<{ suggestions: CorrectionSuggestion[]; model: string | null }> => {
    const { data } = await api.post<{ suggestions: CorrectionSuggestion[]; model: string | null }>(
      '/subtitle-llm/correct',
      { srt_content: srtContent, original_document: originalDocument, language, mode },
    );
    return data;
  },

  /** 双语字幕翻译 */
  translate: async (
    srtContent: string,
    targetLanguage = 'English',
    sourceLanguage = 'Chinese',
  ): Promise<{ segments: BilingualSegment[]; bilingual_srt: string; target_language: string }> => {
    const { data } = await api.post('/subtitle-llm/translate', {
      srt_content: srtContent,
      target_language: targetLanguage,
      source_language: sourceLanguage,
    });
    return data;
  },
};

// Model Config API (模型提供商配置)
export const modelConfigApi = {
  /** 获取所有模型提供商配置 */
  getAll: async (): Promise<ModelConfigs> => {
    const { data } = await api.get<ModelConfigs>('/model-config');
    return data;
  },

  /** 获取 RSA 公钥 (前端加密传输敏感字段用) */
  getPublicKey: async (): Promise<string> => {
    const { data } = await api.get<{ public_key: string }>('/model-config/public-key');
    return data.public_key;
  },

  /**
   * 更新指定提供商的配置。
   * 敏感字段（sensitive=true）会自动用 RSA 公钥加密后再传输。
   */
  update: async (
    provider: string,
    fields: Record<string, string>,
    sensitiveFieldKeys: Set<string>,
  ): Promise<{ message: string; provider: string; updated_fields: string[] }> => {
    const encrypted: Record<string, string> = {};

    // 找出需要加密的敏感字段
    const needEncrypt = Object.keys(fields).filter(
      k => sensitiveFieldKeys.has(k) && fields[k] && fields[k] !== '********',
    );

    if (needEncrypt.length > 0) {
      // 获取 RSA 公钥并加密
      const JSEncrypt = (await import('jsencrypt')).default;
      const publicKey = await modelConfigApi.getPublicKey();
      const encryptor = new JSEncrypt();
      encryptor.setPublicKey(publicKey);

      for (const key of Object.keys(fields)) {
        const val = fields[key];
        if (needEncrypt.includes(key)) {
          const encryptedVal = encryptor.encrypt(val);
          if (!encryptedVal) {
            throw new Error(`RSA encryption failed for field: ${key}`);
          }
          encrypted[key] = `RSA:${encryptedVal}`;
        } else {
          encrypted[key] = val;
        }
      }
    } else {
      Object.assign(encrypted, fields);
    }

    const { data } = await api.put(`/model-config/${provider}`, { fields: encrypted });
    return data;
  },
};

// ---------------------------------------------------------------------------
// Text Split API (for segmented TTS editor)
// ---------------------------------------------------------------------------

export const textSplitApi = {
  ruleSplit: async (text: string, delimiters: string[]): Promise<string[]> => {
    const { data } = await api.post<{ segments: string[] }>('/text-split/rule', { text, delimiters });
    return data.segments;
  },

  llmSplit: async (text: string, delimiters?: string[]): Promise<{ segments: LLMSplitSegmentItem[]; model: string | null }> => {
    const { data } = await api.post<{ segments: LLMSplitSegmentItem[]; model: string | null }>(
      '/text-split/llm',
      { text, delimiters },
    );
    return data;
  },

  ssmlAnnotate: async (texts: string[], styleHint?: string): Promise<{ annotations: SSMLAnnotationItem[]; model: string | null }> => {
    const { data } = await api.post<{ annotations: SSMLAnnotationItem[]; model: string | null }>(
      '/text-split/ssml-annotate',
      { texts, style_hint: styleHint || '' },
    );
    return data;
  },
};
export const segmentedProjectApi = {
  synthesizeSegment: async (
    projectId: string,
    chapterId: string,
    segmentId: string,
    body: {
      params?: Record<string, unknown>;
      text?: string;
      ssml?: string;
      keep_previous?: boolean;
    },
  ): Promise<import('../types').SegmentedProject> => {
    const { data } = await api.post<import('../types').SegmentedProject>(
      `/segmented-projects/${projectId}/chapters/${chapterId}/segments/${segmentId}/synthesize`,
      body,
    );
    return data;
  },
  getProject: async (id: string): Promise<import('../types').SegmentedProject> => {
    const { data } = await api.get<import('../types').SegmentedProject>(`/segmented-projects/${id}`);
    return data;
  },
};

// ============ VoxCPM 本地 GPU TTS ============

export const voxcpmApi = {
  /** 获取模型状态 */
  getStatus: async (): Promise<VoxCPMStatus> => {
    const { data } = await api.get<VoxCPMStatus>('/voxcpm/status');
    return data;
  },

  /** 加载模型到 GPU */
  loadModel: async (params?: { model_path?: string; device?: string }): Promise<VoxCPMStatus> => {
    const { data } = await api.post<VoxCPMStatus>('/voxcpm/load', params || {});
    return data;
  },

  /** 释放 GPU 显存 */
  unloadModel: async (): Promise<{ success: boolean; freed_mb: number }> => {
    const { data } = await api.post('/voxcpm/unload');
    return data;
  },

  /** 纯文本 TTS */
  tts: async (params: {
    text: string;
    cfg_value?: number;
    inference_timesteps?: number;
    format?: string;
  }): Promise<TTSResult> => {
    const { data } = await api.post<TTSResult>('/voxcpm/tts', params);
    return data;
  },

  /** Voice Design — 文本描述生成音色 */
  design: async (params: {
    voice_description: string;
    text?: string;
    cfg_value?: number;
    inference_timesteps?: number;
    format?: string;
  }): Promise<TTSResult> => {
    const { data } = await api.post<TTSResult>('/voxcpm/design', params);
    return data;
  },

  /** Controllable Clone — 参考音频克隆 */
  clone: async (params: {
    text: string;
    voice_id: string;
    style_control?: string;
    cfg_value?: number;
    inference_timesteps?: number;
    format?: string;
  }): Promise<TTSResult> => {
    const { data } = await api.post<TTSResult>('/voxcpm/clone', params);
    return data;
  },

  /** Ultimate Clone — 最高保真克隆 */
  ultimateClone: async (params: {
    text: string;
    voice_id: string;
    prompt_text?: string;
    cfg_value?: number;
    inference_timesteps?: number;
    format?: string;
  }): Promise<TTSResult> => {
    const { data } = await api.post<TTSResult>('/voxcpm/ultimate-clone', params);
    return data;
  },
};
