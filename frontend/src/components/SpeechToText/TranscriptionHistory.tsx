import type { TranscriptionRecord } from '../../services/api';
import styles from './TranscriptionHistory.module.css';

interface TranscriptionHistoryProps {
  records: TranscriptionRecord[];
  onDelete: (id: string) => void;
}

export function TranscriptionHistory({ records, onDelete }: TranscriptionHistoryProps) {
  if (records.length === 0) {
    return <div className={styles.empty}>暂无识别历史</div>;
  }

  return (
    <div className={styles.container}>
      <h3>识别历史 <span className={styles.count}>{records.length}</span></h3>
      <div className={styles.list}>
        {records.map(record => (
          <div key={record.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.fileName}>
                {record.original_filename.length > 40
                  ? record.original_filename.slice(0, 40) + '...'
                  : record.original_filename}
              </span>
              <span className={styles.languageBadge}>
                {record.language} ({(record.language_probability * 100).toFixed(1)}%)
              </span>
            </div>
            <div className={styles.cardMeta}>
              <span className={styles.timestamp}>
                {new Date(record.created_at).toLocaleString()}
              </span>
              <span className={styles.modelBadge}>{record.model_size}</span>
            </div>
            <div className={styles.cardActions}>
              <audio controls className={styles.audio} src={record.audio_url} />
              <a
                className={styles.downloadButton}
                href={record.srt_download_url}
                download={`${record.original_filename.replace(/\.[^.]+$/, '')}.srt`}
              >
                SRT
              </a>
              <button
                className={styles.deleteButton}
                onClick={() => {
                  if (confirm('确定删除这条识别记录？')) onDelete(record.id);
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
