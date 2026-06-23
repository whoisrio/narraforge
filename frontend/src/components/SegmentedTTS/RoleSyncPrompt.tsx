import type { Role, RoleSnapshot } from '../../types';
import { isRoleSnapshotOutdated } from './roleSnapshotSync';
import styles from './RoleSyncPrompt.module.css';

interface RoleSyncPromptProps {
  role: Role | undefined;
  snapshot: RoleSnapshot | null | undefined;
  onSyncSegment: () => void;
  onSyncChapter: () => void;
  onSyncProject: () => void;
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
