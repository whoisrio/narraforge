import type { Segment, SegmentEngineParams } from '../types';

export interface SegmentGenerationInputs extends Record<string, unknown> {
  engine: SegmentEngineParams['engine'];
  role_id?: string | null;
  role_snapshot?: Segment['role_snapshot'];
  prosody_marks: NonNullable<Segment['prosody_marks']>;
  segment_kind: NonNullable<Segment['segment_kind']>;
}

/**
 * Durable engine params that affect the generated audio and are reproducible
 * from the live segment inputs. Anything outside this set (e.g. the backend's
 * derived `prosody_split_plan`, the transient `ssml`, or `text`) is excluded
 * from the staleness comparison so backend-only derived keys never report a
 * false stale.
 */
const DURABLE_ENGINE_PARAM_KEYS: readonly (keyof SegmentEngineParams)[] = [
  'engine',
  'voice_id',
  'instruction',
  'speed',
  'volume',
  'pitch',
  'language',
  'edge_voice',
  'edge_rate',
  'edge_volume',
  'mimo_mode',
  'mimo_preset_voice',
  'mimo_clone_voice_id',
  'mimo_instruction',
  'voxcpm_mode',
  'voxcpm_voice_description',
  'voxcpm_style_control',
  'voxcpm_prompt_text',
  'voxcpm_cfg_value',
  'voxcpm_inference_timesteps',
];

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Drop keys whose value is `undefined` so comparison objects line up with
 * `generated_params`, which omits those keys entirely. Without this an
 * undefined-valued key (e.g. `voice_id` on an Edge-TTS segment) would serialize
 * as a literal and falsely report staleness.
 */
function omitUndefined<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (record[key] !== undefined) {
      result[key] = record[key];
    }
  }
  return result;
}

/**
 * Overlay only the defined keys of `overrides` onto `base`. Used so the live
 * effective (follow-global) params win over the voice stored in segment.params
 * after a prior generation, while undefined overrides leave base untouched.
 */
function applyDefinedOverrides(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrides)) {
    if (overrides[key] !== undefined) {
      result[key] = overrides[key];
    }
  }
  return result;
}

/** Pick only the durable engine params from an arbitrary param-like record. */
function pickDurableEngineParams(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of DURABLE_ENGINE_PARAM_KEYS) {
    if (record[key] !== undefined) {
      result[key] = record[key];
    }
  }
  return result;
}

export function buildSegmentGenerationInputs(
  segment: Segment,
  defaultParams: SegmentEngineParams,
): SegmentGenerationInputs {
  const roleParams = segment.role_snapshot?.default_engine_params ?? {};
  // Resolution order: role snapshot params, then the segment's own params, then
  // the live effective params (defaultParams) win for any field they define.
  // defaultParams carries the resolved global/follow-global voice from the
  // caller, so global voice/engine changes are detected as stale.
  const withSegment = {
    ...roleParams,
    ...segment.params,
  } as Record<string, unknown>;
  const merged = applyDefinedOverrides(withSegment, defaultParams as unknown as Record<string, unknown>);
  // Keep only durable engine params so derived/transient keys never participate.
  const durable = pickDurableEngineParams(merged);
  return {
    ...(durable as unknown as SegmentEngineParams),
    engine: (merged.engine as SegmentEngineParams['engine']) ?? defaultParams.engine,
    role_id: segment.role_id ?? null,
    role_snapshot: segment.role_snapshot ?? null,
    prosody_marks: segment.prosody_marks ?? [],
    segment_kind: segment.segment_kind ?? 'narration',
  };
}

/**
 * Compare the segment's live generation inputs against the params recorded when
 * the current audio was generated. Returns `false` (fresh) when no
 * `generated_params` were recorded — legacy/frontend-mode segments fall back to
 * voice/engine comparison in the caller (see `isSegmentVoiceStale`).
 */
export function isSegmentAudioStale(segment: Segment, defaultParams: SegmentEngineParams): boolean {
  if (segment.status !== 'ready' || !segment.generated_params) {
    return false;
  }
  const current = buildSegmentGenerationInputs(segment, defaultParams);
  // Normalize generated_params to the same durable subset. Derived backend keys
  // (e.g. prosody_split_plan) and transient keys (ssml/text) are dropped so they
  // never cause a false stale. Missing role/prosody/kind fields default to the
  // same values buildSegmentGenerationInputs produces.
  const generated: Record<string, unknown> = {
    ...pickDurableEngineParams(segment.generated_params),
    role_id: (segment.generated_params.role_id as string | null | undefined) ?? null,
    role_snapshot: (segment.generated_params.role_snapshot as Segment['role_snapshot']) ?? null,
    prosody_marks: (segment.generated_params.prosody_marks as unknown[] | undefined) ?? [],
    segment_kind: (segment.generated_params.segment_kind as string | undefined) ?? 'narration',
  };
  return stableStringify(omitUndefined(current)) !== stableStringify(omitUndefined(generated));
}

/**
 * Legacy fallback used when a ready segment has no `generated_params` (e.g.
 * frontend/IndexedDB-mode audio, whose GENERATE_SUCCESS does not record params).
 * Detects a global voice or engine change by comparing the engine that produced
 * the audio and the voice id actually used against the live effective ones.
 *
 * Only meaningful for segments that follow the global voice (no independent
 * voice override). Segments with an independent voice are considered fresh here
 * because their stored params already reflect their own voice.
 */
export function isSegmentVoiceStale(params: {
  status: Segment['status'];
  hasVoiceOverride: boolean;
  generatedEngine: SegmentEngineParams['engine'] | undefined;
  effectiveEngine: SegmentEngineParams['engine'];
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
