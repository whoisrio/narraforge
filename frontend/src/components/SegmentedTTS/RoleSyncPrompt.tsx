import type { Role, RoleSnapshot } from '../../types';
import styles from './RoleSyncPrompt.module.css';

interface RoleSyncPromptProps {
  role: Role | undefined;
  snapshot: RoleSnapshot | null | undefined;
  onSyncSegment: () => void;
  onSyncChapter: () => void;
  onSyncProject: () => void;
}

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

export function RoleSyncPrompt({ role, snapshot, onSyncSegment, onSyncChapter, onSyncProject }: RoleSyncPromptProps) {
  if (!role && snapshot) {
    return <div className={styles.deleted}>全局角色已删除，当前使用项目快照。</div>;
  }
  if (!isRoleSnapshotOutdated(role, snapshot)) return null;
  return (
    <div className={styles.root}>
      <span>全局角色“{role?.name}”有更新。</span>
      <button type="button" onClick={onSyncSegment}>同步当前段</button>
      <button type="button" onClick={onSyncChapter}>同步本章</button>
      <button type="button" onClick={onSyncProject}>同步全项目</button>
    </div>
  );
}
