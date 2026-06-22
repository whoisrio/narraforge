import type { Segment, SegmentEngineParams } from '../types';

export interface SegmentGenerationInputs extends Record<string, unknown> {
  engine: SegmentEngineParams['engine'];
  role_id?: string | null;
  role_snapshot?: Segment['role_snapshot'];
  prosody_marks: NonNullable<Segment['prosody_marks']>;
  segment_kind: NonNullable<Segment['segment_kind']>;
}

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
  return {
    ...(merged as unknown as SegmentEngineParams),
    role_id: segment.role_id ?? null,
    role_snapshot: segment.role_snapshot ?? null,
    prosody_marks: segment.prosody_marks ?? [],
    segment_kind: segment.segment_kind ?? 'narration',
  };
}

export function isSegmentAudioStale(segment: Segment, defaultParams: SegmentEngineParams): boolean {
  if (segment.status !== 'ready' || !segment.generated_params) {
    return false;
  }
  const current = buildSegmentGenerationInputs(segment, defaultParams);
  // Normalize defaults so legacy audio whose generated_params predates the
  // role/prosody fields is not falsely marked stale. Missing role_id /
  // role_snapshot default to null, matching buildSegmentGenerationInputs.
  const generated = {
    ...segment.generated_params,
    role_id: (segment.generated_params.role_id as string | null | undefined) ?? null,
    role_snapshot: (segment.generated_params.role_snapshot as Segment['role_snapshot']) ?? null,
    prosody_marks: (segment.generated_params.prosody_marks as unknown[] | undefined) ?? [],
    segment_kind: (segment.generated_params.segment_kind as string | undefined) ?? 'narration',
  };
  return stableStringify(omitUndefined(current)) !== stableStringify(omitUndefined(generated));
}
