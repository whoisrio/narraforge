import type { TTSResult } from '../types';
import { mimoTtsApi, ttsApi, voxcpmApi } from './api';
import { t } from '../i18n';

export type VoiceDesignEngine = 'qwen' | 'mimo' | 'voxcpm';

export interface VoiceDesignPreviewRequest {
  engine: VoiceDesignEngine;
  voiceDescription: string;
  sampleText: string;
  intensity?: number;  // VoxCPM only (mapped to cfg_value)
  stability?: number;  // VoxCPM only (mapped to inference_timesteps)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function voxcpmCfgFromIntensity(intensity: number): number {
  return Number((1 + clamp(intensity, 0, 100) / 50).toFixed(1));
}

function voxcpmStepsFromStability(stability: number): number {
  return Math.round(8 + clamp(stability, 0, 100) / 12.5);
}

export async function synthesizeVoiceDesignPreview(request: VoiceDesignPreviewRequest): Promise<TTSResult> {
  const description = request.voiceDescription.trim();
  const sampleText = request.sampleText.trim() || t('voiceDesignPreview.defaultSampleText');

  if (request.engine === 'mimo') {
    return mimoTtsApi.synthesizeVoiceDesign({
      voice_description: description,
      text: sampleText,
      optimize_text_preview: false,
      format: 'mp3',
    });
  }

  if (request.engine === 'voxcpm') {
    return voxcpmApi.design({
      voice_description: description,
      text: sampleText,
      cfg_value: voxcpmCfgFromIntensity(request.intensity ?? 72),
      inference_timesteps: voxcpmStepsFromStability(request.stability ?? 68),
      format: 'wav',
    });
  }

  return ttsApi.synthesize({
    text: sampleText,
    engine: 'cosyvoice',
    voice_id: '',
    language: 'Chinese',
    speed: 1,
    volume: 80,
    pitch: 1,
    instruction: description,
    enable_ssml: false,
    enable_markdown_filter: false,
    format: 'mp3',
  });
}

export async function playVoiceDesignPreview(request: VoiceDesignPreviewRequest): Promise<TTSResult> {
  const result = await synthesizeVoiceDesignPreview(request);
  if (!result.audio_base64 && !result.audio_url) {
    throw new Error('No design preview audio returned');
  }

  const format = result.audio_format || (request.engine === 'voxcpm' ? 'wav' : 'mp3');
  const audioSource = result.audio_base64
    ? `data:audio/${format};base64,${result.audio_base64}`
    : result.audio_url!;
  const audio = new Audio(audioSource);
  await audio.play();
  return result;
}
