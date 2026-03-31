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

export interface TTSConfig {
  id: string;
  name: string;
  provider: string;
  model_name: string;
  speed: number;
  volume: number;
  pitch: number;
  emotion: string;
  is_default: boolean;
}

export interface TimelineSegment {
  id: string;
  text: string;
  start_time: number;
  end_time: number;
  audio_url?: string;
  voice_id?: string;
  voice?: VoiceProfile;
}

export interface TimelineProject {
  id: string;
  name: string;
  video_url?: string;
  segments: TimelineSegment[];
}

export interface TTSRequest {
  text: string;
  speed: number;
  volume: number;
  pitch: number;
  emotion: string;
  voice_id?: string;
}

export interface TTSResult {
  audio_id: string;
  audio_url: string;
  text: string;
  params: {
    speed: number;
    volume: number;
    pitch: number;
    emotion: string;
  };
}