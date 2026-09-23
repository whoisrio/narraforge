import type { SegmentedProject } from '../../types';
import type { ProjectDraftRecord } from '../../services/segmentedDraftStore';
import { useTranslation } from '../../i18n';
import styles from './ConflictPrompt.module.css';

interface Props {
  backend: SegmentedProject;
  draft: ProjectDraftRecord;
  onUseBackend: () => void;
  onUseDraft: () => void;
}

/**
 * 409 真冲突的模态裁决窗（加载期与保存期共用）。
 * 二选一强制裁决：无关闭/取消途径——被放弃的一侧已归档（conflicted_drafts），
 * 可从工具栏「冲突草稿」入口找回。
 */
export function ConflictPrompt({ backend, draft, onUseBackend, onUseDraft }: Props) {
  const { t } = useTranslation();
  return (
    // 遮罩点击不裁决（无 onCancel）：冲突必须显式二选一
    <div className={styles.overlay}>
      <div className={styles.dialog} role="alertdialog" aria-label={t('segment.conflict.title')}>
        <div className={styles.header}>
          <span className={styles.icon}>⚠</span>
          <h3 className={styles.title}>{t('segment.conflict.title')}</h3>
        </div>
        <div className={styles.body}>
          <p className={styles.versions}>
            {t('segment.conflict.backendVersion')}: {backend.updated_at}
            <br />
            {t('segment.conflict.localDraft')}: {draft.updated_at}
          </p>
          <p className={styles.message}>{t('segment.conflict.prompt')}</p>
          <p className={styles.archivedHint}>{t('segment.conflict.archivedHint')}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.useBackendBtn} onClick={onUseBackend}>
            {t('segment.conflict.useBackend')}
          </button>
          <button type="button" className={styles.useDraftBtn} onClick={onUseDraft}>
            {t('segment.conflict.useDraft')}
          </button>
        </div>
      </div>
    </div>
  );
}
