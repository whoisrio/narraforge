// Voice Profile (cloned voices)
export interface VoiceProfile {
  id: string;
  name: string;
  audio_url: string;
  description?: string;  // 用户自定义的声音描述
  qwen_voice_id?: string;
  role?: string;
  clone_engine?: 'qwen' | 'mimo';  // 复刻引擎来源
  is_cloned?: boolean;
  cloned_at?: string;
  created_at: string;
}

// TTS Config (model configurations)
export interface TTSConfig {
  id: string;
  name: string;
  provider: 'qwen' | 'azure' | 'openai' | 'mimo';
  model_name: string;
  speed: number;
  volume: number;
  pitch: number;
  emotion: 'happy' | 'sad' | 'neutral' | 'excited';
  is_default: boolean;
  created_at: string;
}

// MiMo TTS 预置音色
export interface MiMoPresetVoice {
  voice_id: string;
  name: string;
  language: string;
  gender: string;
  description: string;
}

// TTS Request params
export interface TTSRequest {
  text: string;
  engine?: 'cosyvoice' | 'edge_tts' | 'mimo_preset' | 'mimo_voicedesign' | 'mimo_voiceclone';
  voice_id: string;
  language?: 'Chinese' | 'English' | 'Japanese' | 'Korean';
  speed?: number; // 0.5 - 2.0
  volume?: number; // 0 - 100
  pitch?: number; // 0.5 - 2.0
  instruction?: string;
  enable_ssml?: boolean;
  enable_markdown_filter?: boolean;
  format?: 'mp3' | 'wav';
  // Edge-TTS params
  edge_voice?: string;
  edge_rate?: string;
  edge_volume?: string;
  // MiMo TTS params
  mimo_voice?: string;           // 预置音色ID
  mimo_voice_description?: string;  // 音色描述文本（voicedesign模式）
  mimo_audio_base64?: string;    // 克隆音频base64（voiceclone模式）
  mimo_mime_type?: string;       // 克隆音频MIME类型
}

// TTS Result
export interface TTSResult {
  audio_id: string;
  audio_url?: string;
  audio_base64?: string;       // 前端存储模式时后端返回 base64
  audio_format?: string;
  voice_id?: string;
  voice_name?: string;
  text: string;
  params: {
    voice_id?: string;
    speed?: number;
    volume?: number;
    pitch?: number;
    language?: string;
    instruction?: string;
    enable_ssml?: boolean;
    enable_markdown_filter?: boolean;
    engine?: string;
    edge_voice?: string;
    edge_rate?: string;
    edge_volume?: string;
  };
}

// Voice upload response
export interface UploadVoiceResponse {
  id: string;
  name: string;
  audio_url: string;
  is_cloned: boolean;
}

// TTS Synthesis History Record
export interface TTSResultRecord {
  id: string;
  text: string;
  voice_id: string;
  voice_name: string;
  audio_url: string;
  audio_format: string;
  speed: number;
  volume: number;
  pitch: number;
  instruction: string;
  language: string;
  created_at: string;
}

// Edge-TTS Voice
export interface EdgeVoice {
  name: string;
  short_name: string;
  display_name: string;
  gender: string;
  locale: string;
  language: string;
}

// 前端 IndexedDB 本地存储的 TTS 记录（含 Blob）
export interface TTSLocalRecord {
  id: string;
  text: string;
  voice_id: string;
  voice_name: string;
  audioBlob: Blob;
  audio_format: string;
  speed: number;
  volume: number;
  pitch: number;
  instruction: string;
  language: string;
  created_at: string;
  source?: string;  // 'segmented_tts' 表示来自分段编辑器
}

// 前端 IndexedDB 本地存储的 STT 记录
export interface STTLocalRecord {
  id: string;
  original_filename: string;
  audioBlob: Blob;
  srtContent: string;
  language: string;
  language_probability: number;
  model_size: string;
  created_at: string;
}

// 模型配置相关类型

/** 单个配置字段的元信息 */
export interface ModelConfigFieldSchema {
  label: string;
  type: 'text' | 'password';
  sensitive: boolean;
  description: string;
  has_fallback: boolean;
}

/** 单个提供商的 schema */
export interface ModelConfigProviderSchema {
  label: string;
  icon: string;
  fields: Record<string, ModelConfigFieldSchema>;
}

/** 单个配置字段的值信息（GET 接口返回） */
export interface ModelConfigFieldValue {
  label: string;
  type: 'text' | 'password';
  sensitive: boolean;
  description: string;
  value: string;           // 界面设置的值（敏感字段为 "********"）
  has_env_default: boolean; // .env 中是否有默认值
  has_value: boolean;       // 最终是否有可用值（界面 or .env）
}

/** 单个提供商的配置（GET 接口返回） */
export interface ModelConfigProvider {
  label: string;
  icon: string;
  fields: Record<string, ModelConfigFieldValue>;
}

/** 所有提供商的配置映射 */
export type ModelConfigs = Record<string, ModelConfigProvider>;

// ---------------------------------------------------------------------------
// Segmented TTS Editor types
// ---------------------------------------------------------------------------

export interface SegmentEngineParams {
  engine: 'cosyvoice' | 'edge_tts' | 'mimo_tts';

  // CosyVoice
  voice_id?: string;
  instruction?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  language?: string;
  enable_ssml?: boolean;
  enable_markdown_filter?: boolean;

  // Edge-TTS
  edge_voice?: string;
  edge_rate?: string;     // '+0%' style
  edge_volume?: string;

  // MiMo-TTS
  mimo_mode?: 'preset' | 'voiceclone';
  mimo_preset_voice?: string;
  mimo_clone_voice_id?: string;
  mimo_instruction?: string;
}

export type SegmentStatus = 'idle' | 'queued' | 'pending' | 'ready' | 'failed';

/** Emotion types returned by LLM analysis */
export type EmotionType = 'happy' | 'sad' | 'angry' | 'calm' | 'neutral' | 'excited';

export interface Segment {
  id: string;
  text: string;
  ssml?: string;
  params: SegmentEngineParams;
  status: SegmentStatus;
  error?: string;
  current_audio_id?: string;
  previous_audio_id?: string;
  duration_sec?: number;
  ssml_annotated_by_llm?: boolean;
  /** Emotion label from LLM analysis */
  emotion?: EmotionType;
  /** Which params have been explicitly overridden (vs inherited from global) */
  overrides?: ('voice' | 'speed' | 'volume' | 'pitch' | 'instruction' | 'language')[];
  /** The voice_id that was actually used when audio was generated (for stale detection) */
  generated_voice_id?: string;
  created_at: string;
  updated_at: string;
}

export interface SegmentedProject {
  schema_version: 1;
  id: string;
  name: string;
  segments: Segment[];
  selected_segment_id?: string;
  default_params: SegmentEngineParams;
  split_config: {
    delimiters: string[];
    mode: 'rule' | 'llm';
  };
  layout: 'vertical' | 'horizontal';
  created_at: string;
  updated_at: string;
}

// Text split API types
export interface LLMSplitSegmentItem {
  text: string;
  reason: string;
  emotion: string;
}

export interface SSMLAnnotationItem {
  text: string;
  ssml: string;
  rationale: string;
}
