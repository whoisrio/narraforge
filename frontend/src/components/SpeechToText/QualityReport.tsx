import type { TranscribeResult } from '../../services/api';
import styles from './QualityReport.module.css';

interface QualityReportProps {
  result: TranscribeResult | null;
}

export function QualityReport({ result }: QualityReportProps) {
  if (!result) return null;

  const confidence = result.language_probability * 100;

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>
        <span className="material-symbols-outlined">analytics</span>
        AI Quality Report
      </h3>
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Avg. Confidence</span>
          <span className={styles.statValue}>{confidence.toFixed(1)}%</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Language</span>
          <span className={styles.statValue}>{result.language}</span>
        </div>
      </div>
      {result.engine && (
        <div className={styles.tip}>
          <span className="material-symbols-outlined">lightbulb</span>
          <span>Engine: {result.engine} · {result.device === 'cuda' ? 'GPU' : 'CPU'}</span>
        </div>
      )}
    </div>
  );
}
