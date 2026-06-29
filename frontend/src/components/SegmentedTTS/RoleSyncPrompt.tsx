import type { Role, RoleSnapshot } from '../../types';
import { isRoleSnapshotOutdated } from './roleSnapshotSync';
import { useTranslation } from '../../i18n';
import styles from './RoleSyncPrompt.module.css';

interface RoleSyncPromptProps {
  role: Role | undefined;
  snapshot: RoleSnapshot | null | undefined;
  onSyncSegment: () => void;
  onSyncChapter: () => void;
  onSyncProject: () => void;
}

export function RoleSyncPrompt({ role, snapshot, onSyncSegment, onSyncChapter, onSyncProject }: RoleSyncPromptProps) {
  const { t } = useTranslation();
  if (!role && snapshot) {
    return <div className={styles.deleted}>{t('roleSync.roleDeleted')}</div>;
  }
  if (!isRoleSnapshotOutdated(role, snapshot)) return null;
  return (
    <div className={styles.root}>
      <span>{t('roleSync.roleUpdated', { name: role?.name ?? '' })}</span>
      <button type="button" onClick={onSyncSegment}>{t('roleSync.syncCurrent')}</button>
      <button type="button" onClick={onSyncChapter}>{t('roleSync.syncChapter')}</button>
      <button type="button" onClick={onSyncProject}>{t('roleSync.syncProject')}</button>
    </div>
  );
}
