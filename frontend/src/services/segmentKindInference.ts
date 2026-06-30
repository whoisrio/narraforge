import type { Role, RoleSnapshot, SegmentKind } from '../types';

export type SplitVoiceMode = 'narration' | 'dialogue';

const SPEAKER_PREFIX_RE = /^([一-龥A-Za-z0-9_·]{1,12})[：:]\s*.+/;
const QUOTED_RE = /^[“"「『].+/;
const QA_RE = /^(Q|A|问|答)[：:]\s*.+/i;

export interface AssignedSplitRole {
  segment_kind: SegmentKind;
  role_id: string | null;
  role_snapshot: RoleSnapshot | null;
  speaker_name: string | null;
}

export function inferSpeakerName(text: string): string | null {
  const match = text.trim().match(SPEAKER_PREFIX_RE);
  if (!match) return null;
  return match[1] ?? null;
}

export function inferSegmentKind(text: string, mode: SplitVoiceMode): SegmentKind {
  if (mode === 'narration') return 'narration';

  const trimmed = text.trim();
  const isDialogue = SPEAKER_PREFIX_RE.test(trimmed) || QUOTED_RE.test(trimmed) || QA_RE.test(trimmed);
  if (isDialogue) return 'dialogue';
  return 'narration';
}

export function roleToSnapshot(role: Role): RoleSnapshot {
  return {
    id: role.id,
    name: role.name,
    avatar: role.avatar,
    description: role.description,
    role_kind: role.role_kind ?? 'cast',
    voice: role.voice as EngineParams,
    favorite_styles: [...role.favorite_styles],
  };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function findCastRoleBySpeaker(roles: Role[], speakerName: string | null): Role | undefined {
  if (!speakerName) return undefined;
  const normalized = normalizeName(speakerName);
  return roles.find(role => normalizeName(role.name) === normalized);
}

export function assignRoleForSplitItem(
  text: string,
  mode: SplitVoiceMode,
  roles: Role[],
): AssignedSplitRole {
  const segmentKind = inferSegmentKind(text, mode);
  const speakerName = inferSpeakerName(text);

  // Narration segments use the global Engine panel voice — no role assigned
  if (segmentKind === 'narration') {
    return {
      segment_kind: segmentKind,
      role_id: null,
      role_snapshot: null,
      speaker_name: speakerName,
    };
  }

  // Dialogue segments get a matching CAST role by speaker name
  const role = findCastRoleBySpeaker(roles, speakerName);

  return {
    segment_kind: segmentKind,
    role_id: role?.id ?? null,
    role_snapshot: role ? roleToSnapshot(role) : null,
    speaker_name: speakerName,
  };
}
