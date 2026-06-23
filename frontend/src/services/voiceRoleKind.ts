import type { Role } from '../types';

export type VoiceRoleKind = 'narrator' | 'cast';

export function getVoiceRoleKind(role: Pick<Role, 'id' | 'name' | 'description' | 'role_kind'>, defaultNarratorRoleId?: string | null): VoiceRoleKind {
  if (role.role_kind === 'narrator' || role.role_kind === 'cast') return role.role_kind;
  if (role.id === defaultNarratorRoleId) return 'narrator';
  const text = `${role.name} ${role.description ?? ''}`.toLowerCase();
  if (text.includes('narrator') || text.includes('旁白') || text.includes('解说')) return 'narrator';
  return 'cast';
}

export function isNarratorRole(role: Pick<Role, 'id' | 'name' | 'description' | 'role_kind'>, defaultNarratorRoleId?: string | null): boolean {
  return getVoiceRoleKind(role, defaultNarratorRoleId) === 'narrator';
}
