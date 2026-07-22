/**
 * segmentAdapter — 兼容性桥接层
 *
 * V3 将 Segment.params / Segment.overrides 等字段替换为 Segment.voice + Segment.audio，
 * 但许多组件仍需读取旧字段用于显示/比较。本文件提供向后兼容的访问器。
 *
 * 使用 resolveEffectiveVoice() 和 isAudioStale() 作为核心引擎。
 */

import type { EngineParams, Segment, Role, CosyVoiceParams, EdgeTTSParams, MiMoParams, VoxCPMParams } from '../types';
import { resolveEffectiveVoice, isAudioStale } from './voiceResolution';

/** 从 Segment 的 voice 字段提取旧式 params 对象 */
export function getSegmentLegacyParams(seg: Segment): Record<string, unknown> {
  if (seg.voice.source === 'custom') {
    // Partial<> 断言仅为规避 TS2783（params 必含 engine），运行时行为不变
    return { engine: seg.voice.engine, ...(seg.voice.params as Partial<EngineParams>) };
  }
  return { engine: seg.voice.source === 'role' ? ('edge_tts' as const) : ('edge_tts' as const) };
}

/** 检查 segment 是否有独立的音色覆盖 */
export function hasIndependentVoice(seg: Segment): boolean {
  return seg.voice.source === 'custom';
}

/** 获取 segment 实际使用的 engine */
export function getSegmentEngine(seg: Segment): string {
  return seg.voice.source === 'custom' ? (seg.voice.engine || 'edge_tts') : 'edge_tts';
}

/** 获取 segment 实际使用的 voice_id */
export function getSegmentVoiceId(seg: Segment): string {
  if (seg.voice.source === 'custom') {
    const params = seg.voice.params;
    if (seg.voice.engine === 'cosyvoice') {
      return (params as Partial<CosyVoiceParams>).voice_id || '';
    }
    if (seg.voice.engine === 'mimo_tts') {
      return (params as Partial<MiMoParams>).voice_id || '';
    }
    if (seg.voice.engine === 'voxcpm') {
      return (params as Partial<VoxCPMParams>).voice_id || '';
    }
    if (seg.voice.engine === 'edge_tts') {
      return (params as Partial<EdgeTTSParams>).voice || '';
    }
  }
  return '';
}

/** 获取 segment 的 generated_params 中记录的 engine */
export function getGeneratedEngine(seg: Segment): string | undefined {
  return seg.generated_params?.engine;
}

/** 获取 segment 的 generated_params 中记录的 voice_id */
export function getGeneratedVoiceId(seg: Segment): string | undefined {
  const gp = seg.generated_params as Record<string, unknown> | undefined;
  if (!gp) return undefined;
  return gp.voice_id as string | undefined;
}

/** 获取 duration_sec（兼容旧代码） */
export function getSegmentDuration(seg: Segment): number | undefined {
  return seg.audio.duration_sec;
}

/** 检查 audio.current?.id（兼容旧代码） */
export function getCurrentAudioId(seg: Segment): string | undefined {
  return seg.audio.current?.id;
}

/** 检查 audio.current?.path（兼容旧代码） */
export function getCurrentAudioPath(seg: Segment): string | undefined {
  return seg.audio.current?.path;
}

/** 检查 audio.previous?.id（兼容旧代码） */
export function getPreviousAudioId(seg: Segment): string | undefined {
  return seg.audio.previous?.id;
}

/** 检查 audio.previous?.path（兼容旧代码） */
export function getPreviousAudioPath(seg: Segment): string | undefined {
  return seg.audio.previous?.path;
}

/** 检查 audio.format（兼容旧代码） */
export function getSegmentAudioFormat(seg: Segment): string {
  return seg.audio.format;
}

/**
 * Build effective params for display/comparison purposes.
 * Uses resolveEffectiveVoice to compute the full effective EngineParams
 * from segment.voice + role + chapterDefaults.
 */
export function getEffectiveParams(
  seg: Segment,
  role: Role | undefined,
  chapterDefaults: EngineParams,
): EngineParams {
  return resolveEffectiveVoice(seg.voice, role, chapterDefaults);
}

/**
 * Check if segment audio is stale using the new voice resolution.
 */
export function checkSegmentStale(
  seg: Segment,
  role: Role | undefined,
  chapterDefaults: EngineParams,
): boolean {
  if (seg.status !== 'ready') return false;
  const current = resolveEffectiveVoice(seg.voice, role, chapterDefaults);
  return isAudioStale(current, seg.generated_params);
}

// Re-export for convenience
export { resolveEffectiveVoice, isAudioStale };
