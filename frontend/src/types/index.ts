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
