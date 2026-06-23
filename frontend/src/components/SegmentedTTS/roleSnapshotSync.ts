import type { Role, RoleSnapshot } from '../../types';

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function isRoleSnapshotOutdated(role: Role | undefined, snapshot: RoleSnapshot | null | undefined): boolean {
  if (!role || !snapshot) return false;
  const current = {
    name: role.name,
    avatar: role.avatar,
    description: role.description,
    default_engine: role.default_engine,
    default_voice: role.default_voice,
    default_engine_params: role.default_engine_params,
    favorite_styles: role.favorite_styles,
  };
  const saved = {
    name: snapshot.name,
    avatar: snapshot.avatar,
    description: snapshot.description,
    default_engine: snapshot.default_engine,
    default_voice: snapshot.default_voice,
    default_engine_params: snapshot.default_engine_params,
    favorite_styles: snapshot.favorite_styles,
  };
  return stableStringify(current) !== stableStringify(saved);
}
