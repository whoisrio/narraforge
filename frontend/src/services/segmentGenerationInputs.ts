import type { Segment, EngineParams } from '../types';
import { resolveEffectiveVoice, isAudioStale as isVoiceStale } from './voiceResolution';
import type { Role } from '../types';

export interface SegmentGenerationInputs extends Record<string, unknown> {
  engine: EngineParams['engine'];
  role_id?: string | null;
  segment_kind: string;
}

/**
 * Build generation inputs for a segment by resolving the effective voice config
 * from chapter defaults → role → segment custom params.
 */
export function buildSegmentGenerationInputs(
  segment: Segment,
  role: Role | undefined,
  chapterDefaults: EngineParams,
): SegmentGenerationInputs {
  const effective = resolveEffectiveVoice(segment.voice, role, chapterDefaults);
  return {
    ...(effective as unknown as Record<string, unknown>),
    engine: effective.engine,
    role_id: segment.role_id ?? null,
    segment_kind: segment.segment_kind ?? 'narration',
  } as unknown as SegmentGenerationInputs;
}

/**
 * Compare the segment's live generation inputs against the params recorded when
 * the current audio was generated. Returns `true` when params have changed and
 * the audio is stale.
 */
export function isSegmentAudioStale(
  segment: Segment,
  roleOrLegacyParams: Role | undefined | Record<string, unknown>,
  chapterDefaults?: EngineParams,
): boolean {
  if (segment.status !== 'ready') {
    return false;
  }
  // Legacy 2-arg calling convention: 2nd arg is a params object
  if (chapterDefaults === undefined) {
    // For legacy callers, use generated_params comparison — handled by caller
    return false; // legacy callers handle staleness differently
  }
  const role = roleOrLegacyParams as Role | undefined;
  const current = resolveEffectiveVoice(segment.voice, role, chapterDefaults);
  return isVoiceStale(current, segment.generated_params as Partial<EngineParams> | undefined);
}

/**
 * Legacy compatibility: detect if the voice has changed.
 * Uses the new isAudioStale from voiceResolution internally.
 */
export function isSegmentVoiceStale(params: {
  status: Segment['status'];
  hasVoiceOverride: boolean;
  generatedEngine: string | undefined;
  effectiveEngine: string;
  generatedVoiceId: string | undefined;
  currentGlobalVoice: string;
}): boolean {
  const { status, hasVoiceOverride, generatedEngine, effectiveEngine, generatedVoiceId, currentGlobalVoice } = params;
  if (status !== 'ready' || hasVoiceOverride) {
    return false;
  }
  const engineChanged = !!generatedEngine && generatedEngine !== effectiveEngine;
  if (engineChanged) {
    return true;
  }
  return !!generatedVoiceId && !!currentGlobalVoice && generatedVoiceId !== currentGlobalVoice;
}
