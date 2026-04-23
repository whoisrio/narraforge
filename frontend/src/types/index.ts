// Voice Profile (cloned voices)
export interface VoiceProfile {
  id: string;
  name: string;
  audio_url: string;
  qwen_voice_id?: string;
  role?: string;
  is_cloned?: boolean;
  cloned_at?: string;
  created_at: string;
}

// TTS Request params
export interface TTSRequest {
  text: string;
  voice_id: string;
  language: 'Chinese' | 'English' | 'Japanese' | 'Korean';
  speed: number; // 0.5 - 2.0
  volume: number; // 0 - 100
  pitch: number; // -12 to 12
  emotion?: 'neutral' | 'happy' | 'sad' | 'nervous' | 'excited';
  format?: 'mp3' | 'wav';
}

// TTS Result
export interface TTSResult {
  audio_id: string;
  audio_url: string;
  text: string;
  params: {
    voice_id: string;
    speed: number;
    volume: number;
    pitch: number;
    language?: string;
    emotion?: string;
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
  emotion: string;
  language: string;
  created_at: string;
}
