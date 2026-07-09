import type { TranscribeResult } from '../../services/api';
import { useTranslation } from '../../i18n';
import styles from './QualityReport.module.css';

interface QualityReportProps {
  result: TranscribeResult | null;
}

export function QualityReport({ result }: QualityReportProps) {
  const { t } = useTranslation();

  if (!result) return null;

  const confidence = result.language_probability * 100;

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>
        <span className="material-symbols-outlined">analytics</span>
        {t('qualityReport.title')}
      </h3>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>{t('qualityReport.avgConfidence')}</span>
          <span className={styles.statValue}>{confidence.toFixed(1)}%</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>{t('qualityReport.language')}</span>
          <span className={styles.statValue}>{result.language}</span>
        </div>
      </div>
      {result.engine && (
        <div className={styles.tip}>
          <span className="material-symbols-outlined">lightbulb</span>
          <span>{t('qualityReport.engineInfo', { engine: result.engine, device: result.device === 'cuda' ? t('qualityReport.gpu') : t('qualityReport.cpu') })}</span>
        </div>
      )}
    </div>
  );
}
