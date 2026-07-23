import type { RoleSnapshot, TTSResult } from '../types';
import { mimoTtsApi, ttsApi, voxcpmApi } from './api';
import { t } from '../i18n';

function previewFormat(role: RoleSnapshot): 'mp3' | 'wav' {
  return role.default_engine === 'voxcpm' ? 'wav' : 'mp3';
}

export async function synthesizeVoiceRolePreview(role: RoleSnapshot, sampleText: string): Promise<TTSResult> {
  const engine = role.default_engine ?? 'edge_tts';
  // default_engine_params 是 EngineParams 判别联合（无索引签名），浅拷贝为 Record 以便按 key 读取
  const params: Record<string, unknown> = { ...(role.default_engine_params ?? {}) };
  const format = previewFormat(role);

  if (engine === 'edge_tts') {
    return ttsApi.synthesize({
      text: sampleText,
      engine: 'edge_tts',
      voice_id: '',
      edge_voice: (params.voice as string) || role.default_voice || '',
      edge_rate: (params.rate as string) || '+0%',
      edge_volume: (params.volume as string) || '+0%',
      format,
    });
  }

  if (engine === 'cosyvoice') {
    return ttsApi.synthesize({
      text: sampleText,
      engine: 'cosyvoice',
      voice_id: (params.voice_id as string) || role.default_voice || '',
      language: ((params.language ?? 'Chinese') as 'Chinese' | 'English' | 'Japanese' | 'Korean'),
      speed: (params.speed as number) ?? 1,
      volume: (params.volume as number) ?? 80,
      pitch: (params.pitch as number) ?? 1,
      instruction: (params.instruction as string) ?? '',
      enable_ssml: (params.enable_ssml as boolean) ?? false,
      enable_markdown_filter: false,
      format,
    });
  }

  if (engine === 'mimo_tts') {
    const mode: string = (params.mode as string) ?? 'preset';
    if (mode === 'voicedesign') {
      return mimoTtsApi.synthesizeVoiceDesign({
        text: sampleText,
        voice_description: (params.voice_description as string) || '',
        format,
      });
    }
    if (mode === 'voiceclone') {
      return mimoTtsApi.synthesizeVoiceClone({
        text: sampleText,
        voice_id: (params.voice_id as string) || role.default_voice || '',
        instruction: (params.instruction as string),
        format,
      });
    }
    return mimoTtsApi.synthesizePreset({
      text: sampleText,
      voice: (params.voice_id as string) || role.default_voice || t('voiceRolePreview.defaultMiMoVoice'),
      instruction: (params.instruction as string),
      format,
    });
  }

  const voxcpmCommon = {
    cfg_value: (params.cfg_value as number),
    inference_timesteps: (params.inference_timesteps as number),
    format,
  };

  const voxcpmMode: string = (params.mode as string) ?? 'tts';
  if (voxcpmMode === 'tts_design') {
    return voxcpmApi.design({
      text: sampleText,
      voice_description: (params.voice_description as string) || role.default_voice || '',
      ...voxcpmCommon,
    });
  }
  if (voxcpmMode === 'clone' || voxcpmMode === 'ultimate') {
    return voxcpmApi.clone({
      text: sampleText,
      voice_id: (params.voice_id as string) || role.default_voice || '',
      style_control: (params.style_control as string),
      ...voxcpmCommon,
    });
  }

  // VoxCPM mode defaults to 'tts' — if no explicit mode set, do design for ones with
  // voice_description, otherwise clone
  if (params.voice_description) {
    return voxcpmApi.design({
      text: sampleText,
      voice_description: (params.voice_description as string) || role.default_voice || '',
      ...voxcpmCommon,
    });
  }

  return voxcpmApi.clone({
    text: sampleText,
    voice_id: (params.voice_id as string) || role.default_voice || '',
    style_control: (params.style_control as string),
    ...voxcpmCommon,
  });
}

export async function playVoiceRolePreview(role: RoleSnapshot, sampleText: string): Promise<TTSResult> {
  const result = await synthesizeVoiceRolePreview(role, sampleText);
  if (!result.audio_base64 && !result.audio_url) {
    throw new Error('No preview audio returned');
  }

  const audioSource = result.audio_base64
    ? `data:audio/${result.audio_format || previewFormat(role)};base64,${result.audio_base64}`
    : result.audio_url!;
  const audio = new Audio(audioSource);
  await audio.play();
  return result;
}

export async function fetchVoiceRolePreview(
  role: RoleSnapshot,
  sampleText: string,
): Promise<TTSResult> {
  return synthesizeVoiceRolePreview(role, sampleText);
}
