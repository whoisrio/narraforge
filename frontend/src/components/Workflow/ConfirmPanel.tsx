import { useTranslation } from '../../i18n';
import type { ConfirmOverwriteInterrupt } from '../../services/langgraph/types';
import styles from './ConfirmPanel.module.css';

interface Props {
  interrupt: ConfirmOverwriteInterrupt;
  onRespond: (payload: { action: string }) => void;
}

export function ConfirmPanel({ interrupt, onRespond }: Props) {
  const { t } = useTranslation();
  const { stats } = interrupt;
  return (
    <div className={styles.confirmPanel}>
      <div className={styles.titleRow}>
        <span className="material-symbols-outlined">warning</span>
        <strong>{t('workflow.confirmPanel.title')}</strong>
      </div>
      <p className={styles.message}>
        {t('workflow.confirmPanel.description', { chapters: stats.chapters, segments: stats.segments })}
        {stats.synthesized_segments > 0 && t('workflow.confirmPanel.synthesized', { count: stats.synthesized_segments })}
        {t('workflow.confirmPanel.warning')}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.confirmBtn}
          onClick={() => onRespond({ action: 'confirm' })}
        >
          {t('workflow.confirmPanel.confirmRebuild')}
        </button>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={() => onRespond({ action: 'cancel' })}
        >
          {t('workflow.common.cancel')}
        </button>
      </div>
    </div>
  );
}
