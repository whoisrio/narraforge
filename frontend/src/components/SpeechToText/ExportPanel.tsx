import { useTranslation } from '../../i18n';
import styles from './ExportPanel.module.css';

interface ExportPanelProps {
  hasResult: boolean;
  onDownloadSrt: () => void;
  onExport: (format: 'json' | 'txt') => void;
}

export function ExportPanel({ hasResult, onDownloadSrt, onExport }: ExportPanelProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>
        <span className="material-symbols-outlined">download</span>
        {t('exportPanel.title')}
      </h3>
      <div className={styles.buttonRow}>
        <button
          className={styles.primaryBtn}
          disabled={!hasResult}
          onClick={onDownloadSrt}
        >
          <span className="material-symbols-outlined">subtitles</span>
          SRT
        </button>
        <button
          className={styles.secondaryBtn}
          disabled={!hasResult}
          onClick={() => onExport('txt')}
        >
          TXT
        </button>
        <button
          className={styles.secondaryBtn}
          disabled={!hasResult}
          onClick={() => onExport('json')}
        >
          JSON
        </button>
      </div>
    </div>
  );
}
