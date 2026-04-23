import type { TTSResultRecord } from '../../types';
import styles from './SynthesisHistory.module.css';

interface SynthesisHistoryProps {
  results: TTSResultRecord[];
  onDelete: (id: string) => void;
  onPlay: (result: TTSResultRecord) => void;
}

export function SynthesisHistory({ results, onDelete, onPlay }: SynthesisHistoryProps) {
  if (results.length === 0) {
    return <div className={styles.empty}>暂无合成历史</div>;
  }

  return (
    <div className={styles.container}>
      <h3>合成历史 <span className={styles.count}>{results.length}</span></h3>
      <div className={styles.list}>
        {results.map(record => (
          <div key={record.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.textPreview} onClick={() => onPlay(record)}>
                {record.text.length > 60 ? record.text.slice(0, 60) + '...' : record.text}
              </span>
              <span className={styles.voiceBadge}>{record.voice_name}</span>
            </div>
            <div className={styles.cardMeta}>
              <span className={styles.timestamp}>
                {new Date(record.created_at).toLocaleString()}
              </span>
            </div>
            <div className={styles.cardActions}>
              <audio controls className={styles.audio} src={record.audio_url} />
              <a
                className={styles.downloadButton}
                href={record.audio_url}
                download={`tts_${record.id}.${record.audio_format}`}
              >
                下载
              </a>
              <button
                className={styles.deleteButton}
                onClick={() => {
                  if (confirm('确定删除这条合成记录？')) onDelete(record.id);
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
