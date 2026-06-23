import type { RoleSnapshot, SegmentEngineParams } from '../types';

export type VoiceRoleKind = 'Narrator' | 'Cast';

export const DEFAULT_EDGE_NARRATOR_VOICE = 'zh-CN-YunxiNeural';
export const DEFAULT_EDGE_CAST_VOICE = 'zh-CN-YunyangNeural';

function hasUsableVoice(params: SegmentEngineParams): boolean {
  if (params.engine === 'edge_tts') return Boolean(params.edge_voice?.trim());
  if (params.engine === 'cosyvoice') return Boolean(params.voice_id?.trim());
  if (params.engine === 'mimo_tts') {
    return params.mimo_mode === 'voiceclone'
      ? Boolean(params.mimo_clone_voice_id?.trim())
      : Boolean(params.mimo_preset_voice?.trim());
  }
  if (params.engine === 'voxcpm') {
    return params.voxcpm_mode === 'clone' || params.voxcpm_mode === 'ultimate'
      ? Boolean(params.voice_id?.trim())
      : Boolean(params.voxcpm_voice_description?.trim());
  }
  return false;
}

function fallbackEdgeParams(roleKind: VoiceRoleKind): SegmentEngineParams {
  return {
    engine: 'edge_tts',
    edge_voice: roleKind === 'Narrator' ? DEFAULT_EDGE_NARRATOR_VOICE : DEFAULT_EDGE_CAST_VOICE,
    edge_rate: '+0%',
    edge_volume: '+0%',
  };
}

function normalizeParams(params: SegmentEngineParams, roleKind: VoiceRoleKind): SegmentEngineParams {
  if (!hasUsableVoice(params)) return fallbackEdgeParams(roleKind);

  if (params.engine === 'edge_tts') {
    return {
      ...params,
      edge_voice: params.edge_voice || (roleKind === 'Narrator' ? DEFAULT_EDGE_NARRATOR_VOICE : DEFAULT_EDGE_CAST_VOICE),
      edge_rate: params.edge_rate || '+0%',
      edge_volume: params.edge_volume || '+0%',
    };
  }

  return params;
}

function defaultVoiceFromParams(params: SegmentEngineParams): string {
  return params.edge_voice
    || params.voice_id
    || params.mimo_clone_voice_id
    || params.mimo_preset_voice
    || params.voxcpm_voice_description
    || '';
}

export function createVoiceRoleDraft({
  name,
  roleKind,
  currentParams,
}: {
  name: string;
  roleKind: VoiceRoleKind;
  currentParams: SegmentEngineParams;
}): RoleSnapshot {
  const roleParams = normalizeParams(currentParams, roleKind);

  return {
    id: `role-${roleKind.toLowerCase()}-${Date.now()}`,
    name,
    description: roleKind,
    role_kind: roleKind === 'Narrator' ? 'narrator' : 'cast',
    default_engine: roleParams.engine,
    default_voice: defaultVoiceFromParams(roleParams),
    default_engine_params: roleParams,
    favorite_styles: [],
  };
}

export function roleVoiceLabelFromParams(params: SegmentEngineParams, fallback?: string | null): string {
  return defaultVoiceFromParams(params) || fallback || '未设置音色';
}
