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

export function buildSegmentGenerationInputs(
  segment: Segment,
  defaultParams: SegmentEngineParams,
): SegmentGenerationInputs {
  const roleParams = segment.role_snapshot?.default_engine_params ?? {};
  const merged = {
    ...defaultParams,
    ...roleParams,
    ...segment.params,
  } as SegmentEngineParams;
  return {
    ...merged,
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
  return stableStringify(current) !== stableStringify(generated);
}
