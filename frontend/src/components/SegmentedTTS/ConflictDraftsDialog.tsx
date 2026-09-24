import type { ConflictedDraftEntry } from '../../services/conflictedDraftStore';
import { useTranslation } from '../../i18n';
import styles from './ConflictPrompt.module.css';

interface Props {
  open: boolean;
  entries: ConflictedDraftEntry[];
  onClose: () => void;
  /** 恢复归档草稿：拉当前后端态进入冲突裁决弹窗（复用同一流程）。 */
  onRestore: (entry: ConflictedDraftEntry) => void;
  onDelete: (entry: ConflictedDraftEntry) => void;
}

function countStats(entry: ConflictedDraftEntry): { chapters: number; segments: number } {
  const chapters = entry.record.draft.chapters?.length ?? 0;
  const segments = chapters === 0
    ? 0
    : entry.record.draft.chapters.reduce((acc, c) => acc + (c.segments?.length ?? 0), 0);
  return { chapters, segments };
}

/**
 * 冲突草稿归档列表（最小找回 UI）：
 * 列出当前项目被归档的 409 冲突草稿，支持恢复（进入裁决弹窗）与删除。
 */
export function ConflictDraftsDialog({ open, entries, onClose, onRestore, onDelete }: Props) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} role="alertdialog" aria-label={t('segment.conflictArchive.title')} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.icon}>🗂</span>
          <h3 className={styles.title}>{t('segment.conflictArchive.title')}</h3>
        </div>
        <div className={styles.body}>
          {entries.length === 0 && (
            <p className={styles.message}>{t('segment.conflictArchive.empty')}</p>
          )}
          <ul className={styles.archiveList}>
            {entries.map((entry) => {
              const { chapters, segments } = countStats(entry);
              return (
                <li key={entry.id} className={styles.archiveItem}>
                  <div className={styles.archiveMeta}>
                    <span className={styles.archiveTime}>
                      {t('segment.conflictArchive.archivedAt')}: {entry.archived_at}
                    </span>
                    <span className={styles.archiveTime}>
                      {t('segment.conflictArchive.draftUpdatedAt')}: {entry.record.updated_at}
                    </span>
                    <span className={styles.archiveTime}>
                      {t('segment.conflictArchive.stats', { chapters, segments })}
                    </span>
                  </div>
                  <div className={styles.archiveActions}>
                    <button type="button" className={styles.useBackendBtn} onClick={() => onRestore(entry)}>
                      {t('segment.conflictArchive.restore')}
                    </button>
                    <button type="button" className={styles.useBackendBtn} onClick={() => onDelete(entry)}>
                      {t('segment.conflictArchive.delete')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.useBackendBtn} onClick={onClose}>
            {t('segment.conflictArchive.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
