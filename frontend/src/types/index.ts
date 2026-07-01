// Voice Profile (cloned voices)
export interface VoiceEngine {
  type: string;           // 'CosyVoice' | 'Mimo' | 'VoxCpm' | 'EdgeTTS'
  sub_type?: string | null;  // 'mimo-clone' | 'mimo-design' | 'voxcpm-clone' | 'voxcpm-ultimate' | 'voxcpm-design'
}

export interface VoicesEngine {
  type: string;           // 'model_default' | 'clone' | 'design'
  engine: VoiceEngine;
  prompt_text?: string | null;
  parameters: Record<string, unknown>;
}

export interface VoiceProfile {
  id: string;
  name: string;
  audio_url?: string;
  source_audio_url?: string;
  source_audio_path?: string;
  cloned_preview_url?: string;
  cloned_preview_path?: string;
  description?: string;
  avatar?: string | null;
  project_id?: string | null;
  role_kind?: string;
  engine?: VoiceProfileEngine;
  engine_params?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
}

// ── V3 Engine params (discriminated union) ──

export interface EdgeTTSParams {
  engine: 'edge_tts';
  voice: string;
  rate: string;
  volume: string;
}

export interface MiMoParams {
  engine: 'mimo_tts';
  mode: 'preset' | 'voiceclone' | 'voicedesign';
  voice_id: string;
  instruction?: string;
  voice_description?: string;
}

export interface CosyVoiceParams {
  engine: 'cosyvoice';
  voice_id: string;
  instruction?: string;
  ssml?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  language?: string;
  enable_ssml?: boolean;
}

export interface VoxCPMParams {
  engine: 'voxcpm';
  mode: 'tts_design' | 'clone' | 'ultimate';
  voice_id: string;
  voice_description?: string;
  style_control?: string;
  prompt_text?: string;
  cfg_value?: number;
  inference_timesteps?: number;
}

export type EngineParams = EdgeTTSParams | MiMoParams | CosyVoiceParams | VoxCPMParams;

// ── Voice source for segments ──

export type VoiceSource =
  | { source: 'chapter' }
  | { source: 'role'; role_id: string }
  | { source: 'custom'; engine: EngineParams['engine']; params: EngineParams; role_id?: string };

// ── Voice engine for profiles ──

export type VoiceProfileEngine = {
  type: 'qwen' | 'mimo' | 'voxcpm';
  qwen_voice_id?: string;
  mimo_voice_id?: string;
  external_audio_url?: string;
  prompt_text?: string;
  is_cloned?: boolean;
  cloned_at?: string;
};

// ── Audio container ──

export interface SegmentAudio {
  current?: { id?: string; path?: string };
  previous?: { id?: string; path?: string };
  format: string;
  duration_sec?: number;
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
  engine?: 'cosyvoice' | 'edge_tts' | 'mimo_preset' | 'mimo_voicedesign' | 'mimo_voiceclone'
    | 'voxcpm_tts' | 'voxcpm_design' | 'voxcpm_clone' | 'voxcpm_ultimate';
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
  // VoxCPM params
  voxcpm_mode?: 'tts' | 'design' | 'clone' | 'ultimate';
  voxcpm_voice_description?: string;  // Voice Design 音色描述
  voxcpm_style_control?: string;      // Clone 风格控制
  voxcpm_prompt_text?: string;        // Ultimate 转录文本
  voxcpm_cfg_value?: number;
  voxcpm_inference_timesteps?: number;
}

// VoxCPM 模型状态
export interface VoxCPMStatus {
  loaded: boolean;
  loading: boolean;
  device: string;
  model_path: string;
  sample_rate: number;
  vram_used_mb: number;
  gpu_total_mb: number;
  gpu_free_mb: number;
  load_time_sec: number;
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


export type SegmentStatus = 'idle' | 'queued' | 'pending' | 'ready' | 'failed';

/** Emotion types returned by LLM analysis */
export type EmotionType = 'happy' | 'sad' | 'angry' | 'calm' | 'neutral' | 'excited';

export type SegmentKind = 'dialogue' | 'narration';

export interface FavoriteStyle {
  id: string;
  name: string;
  emotion?: EmotionType;
  style_tags: string[];
  instruction?: string;
  intensity?: number;
}

export interface RoleSnapshot {
  id: string;
  name: string;
  avatar?: string | null;
  description?: string | null;
  role_kind?: 'narrator' | 'cast' | null;
  voice?: EngineParams;
  favorite_styles: FavoriteStyle[];

  // ── V3 兼容层（后续移除）──
  /** @deprecated Use voice.engine */
  default_engine: EngineParams['engine'];
  /** @deprecated Use voice */
  default_voice: string | null;
  /** @deprecated Use voice */
  default_engine_params: EngineParams;
}

export interface Role extends RoleSnapshot {
  created_at: string;
  updated_at: string;
}

export interface RoleUpdate {
  name?: string | null;
  avatar?: string | null;
  description?: string | null;
  role_kind?: 'narrator' | 'cast' | null;
  voice?: Partial<EngineParams>;
  favorite_styles?: FavoriteStyle[];

  // ── V3 兼容层（后续移除）──
  /** @deprecated Use voice */
  default_engine?: EngineParams['engine'];
  /** @deprecated Use voice */
  default_voice?: string | null;
  /** @deprecated Use voice */
  default_engine_params?: Partial<EngineParams>;
}

export interface ProsodyMark {
  id: string;
  start: number;
  end: number;
  emotion?: EmotionType;
  style_tags: string[];
  instruction?: string;
  intensity?: number;
}

export interface ProsodyCapability {
  supportsEmotion: boolean;
  supportsStyleTags: boolean;
  supportsInstruction: boolean;
  supportsSsml: boolean;
  requiresSplitFallback: boolean;
}

/** 显式的音色引用 — 描述 segment 当前激活的音色来源 */
export interface VoiceRef {
  /** 显示名称（角色名、音色名、或全局音色名） */
  name: string;
  /** 音色来源：role=角色, global=跟随全局, custom=独立覆盖 */
  source: 'role' | 'global' | 'custom';
  /** 音色标识符（VoiceProfile.id, qwen_voice_id, edge_voice, mimo_preset_voice 等） */
  voice_id: string;
  /** 使用的引擎 */
  engine: EngineParams['engine'];
  /** 角色 ID（仅 source='role' 时有值） */
  role_id?: string;
}

export interface Segment {
  id: string;
  text: string;
  voice: VoiceSource;
  status: SegmentStatus;
  error?: string;
  audio: SegmentAudio;
  generated_params?: Partial<EngineParams>;
  emotion?: EmotionType;
  role_id?: string | null;
  segment_kind: SegmentKind;
  created_at: string;
  updated_at: string;

  // ── V3 兼容层（后续移除）──
  /** @deprecated Use voice */
  params?: EngineParams;
  /** @deprecated Use voice.source === 'custom' */
  overrides?: string[];
  /** @deprecated Use voice */
  voice_ref?: VoiceRef;
  /** @deprecated Use audio.current?.id */
  current_audio_id: string;
  /** @deprecated Use audio.previous?.id */
  previous_audio_id: string;
  /** @deprecated Use audio.current?.path */
  current_audio_path: string | undefined;
  /** @deprecated Use audio.previous?.path */
  previous_audio_path: string | undefined;
  /** @deprecated Use audio.format */
  audio_format: string;
  /** @deprecated Use audio.duration_sec */
  duration_sec: number;
  /** @deprecated Removed in V3 */
  ssml: string;
  /** @deprecated Removed in V3 */
  ssml_annotated_by_llm: boolean;
  /** @deprecated Removed in V3 */
  role_snapshot: RoleSnapshot | null;
  /** @deprecated Removed in V3 */
  prosody_marks: ProsodyMark[];
  /** @deprecated Removed in V3 */
  generated_voice_id: string;
}

/** 章节 — 每个章节有独立的模型、文本、片段 */
export interface Chapter {
  id: string;
  name: string;
  /** Chapter-level voice defaults (EngineParams discriminated union) */
  voice: EngineParams;
  original_text?: string;
  design_title?: string;
  segments: Segment[];
  selected_segment_id?: string;
  split_config: {
    delimiters: string[];
    mode: 'rule' | 'llm';
  };
  created_at: string;
  updated_at: string;
}

export interface SegmentedProject {
  schema_version: 2;
  id: string;
  name: string;
  /** Project logo as data URL or remote URL */
  logo?: string | null;
  chapters: Chapter[];
  active_chapter_id?: string;
  layout: 'vertical' | 'horizontal';
  description?: string | null;
  project_type?: string | null;
  default_language?: string | null;
  export_directory?: string | null;
  export_naming_template?: string | null;
  // P2 v2: 旁白文档当前活跃版本 (e.g. 'v2.1')
  active_narration_version?: string | null;
  /** 默认关联的 Remotion 项目路径；导出文件优先写入其 public/audio */
  remotion_project_path?: string | null;
  /** Source document file path or identifier */
  source_document?: string | null;
  /** Backend list endpoint summary for project-card stats when chapters are not hydrated. */
  summary_stats?: {
    chapter_count: number;
    segment_count: number;
    generated_count: number;
    duration_sec: number;
  } | null;
  default_narrator_role_id?: string | null;
  configs?: { split_voice_mode?: 'narration' | 'dialogue'; [key: string]: unknown } | null;
  created_at: string;
  updated_at: string;
}

// ===== P2 v2: Source & Narration =====

export interface SourceDocument {
  id: string;
  project_id: string;
  source_type: 'paste' | 'audio' | 'path';
  title: string;
  file_path?: string | null;
  pasted_text?: string | null;
  audio_path?: string | null;
  file_size?: number | null;
  duration_sec?: number | null;
  created_at: string;
}

export interface ChapterSlice {
  chapter_index: number;
  title: string;
  start_char: number;
  end_char: number;
}

export interface NarrationDocument {
  id: string;
  project_id: string;
  version: string;  // 'v1' | 'v2' | 'v2.1'
  version_kind: 'full' | 'partial';
  body_markdown: string;
  word_count: number;
  source_ids: string[];
  prompt_hint?: string | null;
  settings: Record<string, unknown>;
  chapter_slices: ChapterSlice[];
  generated_at: string;
}

export interface NarrationListItem {
  id: string;
  version: string;
  version_kind: 'full' | 'partial';
  word_count: number;
  source_ids: string[];
  generated_at: string;
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
