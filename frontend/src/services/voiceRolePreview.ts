import type { RoleSnapshot, TTSResult } from '../types';
import { mimoTtsApi, ttsApi, voxcpmApi } from './api';

function previewFormat(role: RoleSnapshot): 'mp3' | 'wav' {
  return role.default_engine === 'voxcpm' ? 'wav' : 'mp3';
}

export async function synthesizeVoiceRolePreview(role: RoleSnapshot, sampleText: string): Promise<TTSResult> {
  const params = role.default_engine_params;
  const format = previewFormat(role);

  if (role.default_engine === 'edge_tts') {
    return ttsApi.synthesize({
      text: sampleText,
      engine: 'edge_tts',
      voice_id: '',
      edge_voice: params.edge_voice || role.default_voice || '',
      edge_rate: params.edge_rate || '+0%',
      edge_volume: params.edge_volume || '+0%',
      format,
    });
  }

  if (role.default_engine === 'cosyvoice') {
    return ttsApi.synthesize({
      text: sampleText,
      engine: 'cosyvoice',
      voice_id: params.voice_id || role.default_voice || '',
      language: (params.language ?? 'Chinese') as 'Chinese' | 'English' | 'Japanese' | 'Korean',
      speed: params.speed ?? 1,
      volume: params.volume ?? 80,
      pitch: params.pitch ?? 1,
      instruction: params.instruction ?? '',
      enable_ssml: params.enable_ssml ?? false,
      enable_markdown_filter: params.enable_markdown_filter ?? false,
      format,
    });
  }

  if (role.default_engine === 'mimo_tts') {
    if ((params.mimo_mode ?? 'preset') === 'voiceclone') {
      return mimoTtsApi.synthesizeVoiceClone({
        text: sampleText,
        voice_id: params.mimo_clone_voice_id || role.default_voice || '',
        instruction: params.mimo_instruction,
        format,
      });
    }
    return mimoTtsApi.synthesizePreset({
      text: sampleText,
      voice: params.mimo_preset_voice || role.default_voice || '冰糖',
      instruction: params.mimo_instruction,
      format,
    });
  }

  const common = {
    cfg_value: params.voxcpm_cfg_value,
    inference_timesteps: params.voxcpm_inference_timesteps,
    format,
  };

  if ((params.voxcpm_mode ?? 'tts') === 'design') {
    return voxcpmApi.design({
      text: sampleText,
      voice_description: params.voxcpm_voice_description || role.default_voice || '',
      ...common,
    });
  }
  if (params.voxcpm_mode === 'clone') {
    return voxcpmApi.clone({
      text: sampleText,
      voice_id: params.voice_id || role.default_voice || '',
      style_control: params.voxcpm_style_control,
      ...common,
    });
  }
  if (params.voxcpm_mode === 'ultimate') {
    return voxcpmApi.ultimateClone({
      text: sampleText,
      voice_id: params.voice_id || role.default_voice || '',
      prompt_text: params.voxcpm_prompt_text,
      style_control: params.voxcpm_style_control,
      ...common,
    });
  }
  return voxcpmApi.tts({
    text: sampleText,
    ...common,
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
