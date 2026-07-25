import { useTranslation } from '../../i18n';
import type { ChapterSyncStatus } from '../../services/api';
import styles from './ChapterSyncBadges.module.css';

interface ChapterSyncModalProps {
  status: ChapterSyncStatus;
  onResplit: () => void;
  onRewrite: () => void;
  onClose: () => void;
  busy?: boolean;
}

/**
 * Phase B sync modal: offers the manual sync action(s) matching the chapter's
 * dirty state (resplit-from-script / rewrite-script-from-segments), with a
 * conflict warning when both layers are dirty.
 */
export function ChapterSyncModal({ status, onResplit, onRewrite, onClose, busy }: ChapterSyncModalProps) {
  const { t } = useTranslation();
  const showResplit = status.l2_dirty;
  const showRewrite = status.l3_dirty;
  const conflict = status.l2_dirty && status.l3_dirty;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-label={t('sync.modalTitle')}>
      <section className={styles.modalCard}>
        <header className={styles.modalHeader}>
          <h3>{t('sync.modalTitle')}</h3>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>×</button>
        </header>
        <div className={styles.modalBody}>
          {conflict && (
            <p className={styles.error}>{t('sync.conflictWarning')}</p>
          )}
          {showResplit && (
            <div className={styles.modalAction}>
              <p>{t('sync.resplitDesc')}</p>
              <button type="button" className={styles.modalBtn} onClick={onResplit} disabled={busy}>
                {t('sync.resplit')}
              </button>
            </div>
          )}
          {showRewrite && (
            <div className={styles.modalAction}>
              <p>{t('sync.rewriteDesc')}</p>
              <button type="button" className={styles.modalBtn} onClick={onRewrite} disabled={busy}>
                {t('sync.rewrite')}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
