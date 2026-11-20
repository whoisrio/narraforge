/**
 * VoiceClone 声音卡片可见性/能力判定（纯函数，便于单测与复用）。
 */
import type { VoiceProfile } from '../types';

/**
 * 声音卡片是否可展示/管理。
 *
 * 云端同步（sync-from-qwen）来的音色本地没有 source/preview 音频文件，
 * 旧过滤（has_preview || has_source）会把它们全部隐藏，导致无法管理；
 * 只要绑定了 Cosyvoice voice_id 就纳入列表（试听走合成）。
 */
export function isManageableVoice(v: VoiceProfile): boolean {
  if (v.has_preview || v.has_source) return true;
  const voiceId = (v.voice_params?.cosyvoice?.params as Record<string, unknown> | undefined)?.voice_id;
  return Boolean(voiceId);
}

/** 云端同步音色：本地无音频，试听需实时合成。 */
export function isCloudSyncedVoice(v: VoiceProfile): boolean {
  return !v.has_preview && !v.has_source && isManageableVoice(v);
}

/** 云端音色试听的固定短句。 */
export const SYNTH_AUDITION_TEXT = '你好，这是当前音色的试听语音。';
