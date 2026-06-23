import type { Role, RoleSnapshot, SegmentKind } from '../types';

export type SplitVoiceMode = 'narration' | 'dialogue' | 'mixed';

const SPEAKER_PREFIX_RE = /^([\u4e00-\u9fa5A-Za-z0-9_·]{1,12})[：:]\s*.+/;
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
    default_engine: role.default_engine,
    default_voice: role.default_voice,
    default_engine_params: { ...role.default_engine_params },
    favorite_styles: [...role.favorite_styles],
  };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function findRoleById(roles: Role[], roleId?: string | null): Role | undefined {
  if (!roleId) return undefined;
  return roles.find(role => role.id === roleId);
}

function findCastRoleBySpeaker(roles: Role[], speakerName: string | null, narratorRoleId?: string | null): Role | undefined {
  if (!speakerName) return undefined;
  const normalized = normalizeName(speakerName);
  return roles.find(role => role.id !== narratorRoleId && normalizeName(role.name) === normalized);
}

export function assignRoleForSplitItem(
  text: string,
  mode: SplitVoiceMode,
  roles: Role[],
  narratorRoleId?: string | null,
): AssignedSplitRole {
  const segmentKind = inferSegmentKind(text, mode);
  const speakerName = inferSpeakerName(text);

  const role = segmentKind === 'narration'
    ? findRoleById(roles, narratorRoleId)
    : findCastRoleBySpeaker(roles, speakerName, narratorRoleId);

  return {
    segment_kind: segmentKind,
    role_id: role?.id ?? null,
    role_snapshot: role ? roleToSnapshot(role) : null,
    speaker_name: speakerName,
  };
}
