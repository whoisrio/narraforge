import Markdown from 'react-markdown';
import styles from './CompareView.module.css';

interface CompareViewProps {
  sourceDocument: string;
  narrationText: string;
  onBack: () => void;
}

export function CompareView({ sourceDocument, narrationText, onBack }: CompareViewProps) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>对比查看</span>
        <button type="button" className={styles.ghostButton} onClick={onBack}>
          ← 返回
        </button>
      </div>
      <div className={styles.columns}>
        <div className={styles.column}>
          <span className={styles.columnLabel}>源文档</span>
          <div className={styles.content}>
            <Markdown>{sourceDocument || '*（空）*'}</Markdown>
          </div>
        </div>
        <div className={styles.column}>
          <span className={styles.columnLabel}>旁白文档</span>
          <div className={styles.content}>
            <Markdown>{narrationText || '*（空）*'}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}
