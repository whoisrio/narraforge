import type { Role } from '../types';

export type VoiceRoleKind = 'narrator' | 'cast';

export function getVoiceRoleKind(role: Pick<Role, 'id' | 'name' | 'description' | 'role_kind'>, defaultNarratorRoleId?: string | null): VoiceRoleKind {
  if (role.role_kind === 'narrator') return 'narrator';
  if (role.role_kind === 'cast') return 'cast';
  if (role.id === defaultNarratorRoleId) return 'narrator';
  return 'cast';
}

export function isNarratorRole(role: Pick<Role, 'id' | 'name' | 'description' | 'role_kind'>, defaultNarratorRoleId?: string | null): boolean {
  return getVoiceRoleKind(role, defaultNarratorRoleId) === 'narrator';
}
