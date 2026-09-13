import type { TextAnalysisSplitResult } from '../../services/api';
import { useTranslation } from '../../i18n';
import styles from './ApplyAnalysisDialog.module.css';

interface ConflictInfo {
  existingChapters: number;
  existingRoles: number;
  newChapters: number;
  newRoles: { name: string }[];
}

interface Props {
  conflict: ConflictInfo;
  result: TextAnalysisSplitResult;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ApplyAnalysisDialog({ conflict, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const hasChapterConflict = conflict.existingChapters > 0;
  const hasRoleConflict = conflict.existingRoles > 0;

  let title = t('applyAnalysis.titleApply');
  let icon = '✅';
  let message = t('applyAnalysis.newOnly', { chapters: conflict.newChapters, roles: conflict.newRoles.length });

  if (hasChapterConflict && hasRoleConflict) {
    title = t('applyAnalysis.titleOverwriteAll');
    icon = '⚠️';
    message = t('applyAnalysis.withExisting', { existingChapters: conflict.existingChapters, existingRoles: conflict.existingRoles, newChapters: conflict.newChapters, newRoles: conflict.newRoles.length });
  } else if (hasChapterConflict) {
    title = t('applyAnalysis.titleOverwriteChapters');
    icon = '⚠️';
    message = t('applyAnalysis.chaptersOnly', { existingChapters: conflict.existingChapters, newChapters: conflict.newChapters });
  } else if (hasRoleConflict) {
    title = t('applyAnalysis.titleOverwriteRoles');
    icon = '⚠️';
    message = t('applyAnalysis.rolesOnly', { existingRoles: conflict.existingRoles, newRoles: conflict.newRoles.length });
  }

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={styles.dialog}>
        <div className={styles.icon}>{icon}</div>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.message}>{message}</p>
        {conflict.newRoles.length > 0 && (
          <ul className={styles.roles}>
            {conflict.newRoles.map(role => (
              <li key={role.name} className={styles.roleTag}>{role.name}</li>
            ))}
          </ul>
        )}
        <div className={styles.actions}>
          <button className={`${styles.btn} ${styles.btnCancel}`} onClick={onCancel}>{t('common.cancel')}</button>
          <button className={`${styles.btn} ${styles.btnConfirm}`} onClick={onConfirm}>
            {hasChapterConflict ? t('applyAnalysis.confirmOverwrite') : t('applyAnalysis.confirmApply')}
          </button>
        </div>
      </div>
    </div>
  );
}
