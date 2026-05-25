import { useState } from 'react';
import type { TTSResultRecord } from '../../types';
import styles from './SynthesisHistory.module.css';

interface SynthesisHistoryProps {
  results: TTSResultRecord[];
  onDelete: (id: string) => void;
  onPlay: (result: TTSResultRecord) => void;
}

export function SynthesisHistory({ results, onDelete, onPlay }: SynthesisHistoryProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (results.length === 0) {
    return <div className={styles.empty}>暂无合成历史</div>;
  }

  return (
    <div className={styles.container}>
      <h3>合成历史 <span className={styles.count}>{results.length}</span></h3>
      <div className={styles.list}>
        {results.map(record => {
          const isExpanded = expandedIds.has(record.id);
          const isLong = record.text.length > 60;

          return (
            <div key={record.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <span
                  className={`${styles.textPreview} ${isExpanded ? styles.textPreviewExpanded : ''}`}
                  onClick={() => onPlay(record)}
                >
                  {isExpanded || !isLong ? record.text : record.text.slice(0, 60) + '...'}
                </span>
                {isLong && (
                  <button
                    className={styles.expandButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(record.id);
                    }}
                  >
                    {isExpanded ? '收起' : '展开'}
                  </button>
                )}
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
          );
        })}
      </div>
    </div>
  );
}