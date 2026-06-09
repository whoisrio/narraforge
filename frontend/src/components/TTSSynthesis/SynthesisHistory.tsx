import { useRef, useState, useEffect } from 'react';
import type { TTSResultRecord } from '../../types';
import styles from './SynthesisHistory.module.css';

type ConfirmDialogState = {
  open: boolean;
  title: string;
  message: string;
  variant?: 'warning' | 'danger';
  confirmLabel?: string;
  onConfirm: () => void;
};

interface SynthesisHistoryProps {
  results: TTSResultRecord[];
  onDelete: (id: string) => void;
  onPlay: (result: TTSResultRecord) => void;
  onConfirm?: (state: ConfirmDialogState | ((prev: ConfirmDialogState) => ConfirmDialogState)) => void;
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatRelative(ts: string | number | Date): string {
  const date = new Date(ts);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} 天前`;
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

interface RowProps {
  record: TTSResultRecord;
  onDelete: (id: string) => void;
  onPlay: (record: TTSResultRecord) => void;
  onConfirm?: SynthesisHistoryProps['onConfirm'];
}

function HistoryRow({ record, onDelete, onPlay, onConfirm }: RowProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const isLong = record.text.length > 80;
  const displayText = expanded || !isLong ? record.text : record.text.slice(0, 80) + '…';

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoaded = () => setDuration(audio.duration || 0);
    const onTime = () => setCurrentTime(audio.currentTime);
    const onEnd = () => { setIsPlaying(false); setCurrentTime(0); };
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * duration;
  };

  const handleDeleteClick = () => {
    if (onConfirm) {
      const preview = record.text.length > 40 ? record.text.slice(0, 40) + '…' : record.text;
      onConfirm({
        open: true,
        title: '删除合成记录',
        message: `确定删除这条记录吗？\n「${preview}」`,
        variant: 'danger',
        confirmLabel: '删除',
        onConfirm: () => {
          onConfirm(prev => ({ ...prev, open: false }));
          onDelete(record.id);
        },
      });
    } else {
      onDelete(record.id);
    }
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`${styles.row} ${isPlaying ? styles.rowPlaying : ''}`}>
      <audio ref={audioRef} src={record.audio_url} preload="metadata" />

      <button
        className={styles.playBtn}
        onClick={togglePlay}
        aria-label={isPlaying ? '暂停' : '播放'}
        title={isPlaying ? '暂停' : '播放'}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
        )}
      </button>

      <div className={styles.main}>
        <div className={styles.textLine}>
          <span
            className={`${styles.text} ${expanded ? styles.textExpanded : ''}`}
            onClick={() => onPlay(record)}
            title="加载到上方播放器"
          >
            {displayText}
          </span>
          {isLong && (
            <button
              className={styles.expandBtn}
              onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
            >
              {expanded ? '收起' : '展开'}
            </button>
          )}
        </div>

        <div className={styles.controlLine}>
          <span className={styles.time}>{formatTime(currentTime)}</span>
          <div className={styles.progressTrack} onClick={seek}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
          <span className={styles.time}>{formatTime(duration)}</span>
        </div>

        <div className={styles.metaLine}>
          <span className={styles.voiceBadge} title="音色">{record.voice_name || '未知音色'}</span>
          <span className={styles.dot}>·</span>
          <span className={styles.timestamp} title={new Date(record.created_at).toLocaleString()}>
            {formatRelative(record.created_at)}
          </span>
        </div>
      </div>

      <div className={styles.actions}>
        <a
          className={styles.iconBtn}
          href={record.audio_url}
          download={`tts_${record.id}.${record.audio_format}`}
          title="下载"
          aria-label="下载"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </a>
        <button
          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          onClick={handleDeleteClick}
          title="删除"
          aria-label="删除"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

export function SynthesisHistory({ results, onDelete, onPlay, onConfirm }: SynthesisHistoryProps) {
  if (results.length === 0) {
    return (
      <div className={styles.empty}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        <span>暂无合成历史</span>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>合成历史</span>
        <span className={styles.count}>{results.length}</span>
      </div>
      <div className={styles.list}>
        {results.map(record => (
          <HistoryRow
            key={record.id}
            record={record}
            onDelete={onDelete}
            onPlay={onPlay}
            onConfirm={onConfirm}
          />
        ))}
      </div>
    </div>
  );
}
