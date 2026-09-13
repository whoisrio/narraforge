import { useTranslation } from '../../i18n';
import Markdown from 'react-markdown';
import styles from './CompareView.module.css';

interface CompareViewProps {
  sourceDocument: string;
  narrationText: string;
  onBack: () => void;
}

export function CompareView({ sourceDocument, narrationText, onBack }: CompareViewProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t('compareView.title')}</span>
        <button type="button" className={styles.ghostButton} onClick={onBack}>
          ← {t('compareView.back')}
        </button>
      </div>
      <div className={styles.columns}>
        <div className={styles.column}>
          <span className={styles.columnLabel}>{t('compareView.sourceDoc')}</span>
          <div className={styles.content}>
            <Markdown>{sourceDocument || t('compareView.empty')}</Markdown>
          </div>
        </div>
        <div className={styles.column}>
          <span className={styles.columnLabel}>{t('compareView.narrationDoc')}</span>
          <div className={styles.content}>
            <Markdown>{narrationText || t('compareView.empty')}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}
