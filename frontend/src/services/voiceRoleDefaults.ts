import type { RoleSnapshot, EngineParams, EdgeTTSParams, MiMoParams, VoxCPMParams } from '../types';
import { t } from '../i18n';

export type VoiceRoleKind = 'Narrator' | 'Cast';

export const DEFAULT_EDGE_NARRATOR_VOICE = 'zh-CN-YunxiNeural';
export const DEFAULT_EDGE_CAST_VOICE = 'zh-CN-YunyangNeural';

function hasUsableVoice(params: EngineParams): boolean {
  if (params.engine === 'edge_tts') return Boolean((params as EdgeTTSParams).voice?.trim());
  if (params.engine === 'cosyvoice') return Boolean(params.voice_id?.trim());
  if (params.engine === 'mimo_tts') {
    const mode = (params as MiMoParams).mode ?? 'preset';
    if (mode === 'voiceclone') return Boolean(params.voice_id?.trim());
    if (mode === 'voicedesign') return Boolean((params as MiMoParams).voice_description?.trim());
    return Boolean(params.voice_id?.trim());
  }
  if (params.engine === 'voxcpm') {
    const mode = (params as VoxCPMParams).mode ?? 'clone';
    if (mode === 'clone' || mode === 'ultimate') return Boolean(params.voice_id?.trim());
    return Boolean((params as VoxCPMParams).voice_description?.trim());
  }
  return false;
}

function fallbackEdgeParams(roleKind: VoiceRoleKind): EdgeTTSParams {
  return {
    engine: 'edge_tts',
    voice: roleKind === 'Narrator' ? DEFAULT_EDGE_NARRATOR_VOICE : DEFAULT_EDGE_CAST_VOICE,
    rate: '+0%',
    volume: '+0%',
  };
}

function normalizeParams(params: EngineParams, roleKind: VoiceRoleKind): EngineParams {
  if (!hasUsableVoice(params)) return fallbackEdgeParams(roleKind);

  if (params.engine === 'edge_tts') {
    const ep = params as EdgeTTSParams;
    return {
      ...ep,
      voice: ep.voice || (roleKind === 'Narrator' ? DEFAULT_EDGE_NARRATOR_VOICE : DEFAULT_EDGE_CAST_VOICE),
      rate: ep.rate || '+0%',
      volume: ep.volume || '+0%',
    } as EdgeTTSParams;
  }

  return params;
}

function defaultVoiceFromParams(params: EngineParams): string {
  if (params.engine === 'edge_tts') return (params as EdgeTTSParams).voice || '';
  if (params.engine === 'mimo_tts') return (params as MiMoParams).voice_description || params.voice_id || '';
  if (params.engine === 'voxcpm') return (params as VoxCPMParams).voice_description || params.voice_id || '';
  return params.voice_id || '';
}

export function createVoiceRoleDraft({
  name,
  roleKind,
  currentParams,
}: {
  name: string;
  roleKind: VoiceRoleKind;
  currentParams: EngineParams;
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

export function roleVoiceLabelFromParams(params: EngineParams, fallback?: string | null): string {
  return defaultVoiceFromParams(params) || fallback || t('voiceRoleDefaults.noVoiceSet');
}
