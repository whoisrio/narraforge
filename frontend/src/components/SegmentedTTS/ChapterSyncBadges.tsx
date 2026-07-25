import { useTranslation } from '../../i18n';
import type { ChapterSyncStatus } from '../../services/api';
import styles from './ChapterSyncBadges.module.css';

interface ChapterSyncBadgesProps {
  status: ChapterSyncStatus | null;
  onClick?: () => void;
}

/** Phase A: show a warning chip per dirty layer (L1 original / L2 script / L3 segments). */
export function ChapterSyncBadges({ status, onClick }: ChapterSyncBadgesProps) {
  const { t } = useTranslation();
  if (!status) return null;
  const layers: Array<[keyof ChapterSyncStatus, string]> = [
    ['l1_dirty', 'sync.l1'],
    ['l2_dirty', 'sync.l2'],
    ['l3_dirty', 'sync.l3'],
  ];
  const dirty = layers.filter(([key]) => status[key]);
  if (dirty.length === 0) return null;
  return (
    <span
      className={styles.badges}
      aria-label={t('sync.chaptersStale')}
      role={onClick ? 'button' : undefined}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      {dirty.map(([, labelKey]) => (
        <span key={labelKey} className={styles.badge}>{t(labelKey)}</span>
      ))}
    </span>
  );
}
