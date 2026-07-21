import { useState, type ReactNode } from 'react';
import styles from './StageCard.module.css';

const STATUS_ICON: Record<string, string> = {
  completed: 'check_circle',
  running: 'progress_activity',
  pending: 'circle',
};

interface Props {
  nodeId: string;
  title: string;
  status: 'completed' | 'running' | 'pending';
  summary?: string;
  defaultOpen?: boolean;
  onFullscreen?: () => void;
  children?: ReactNode;
}

export function StageCard({
  nodeId,
  title,
  status,
  summary,
  defaultOpen = false,
  onFullscreen,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen || status === 'running');
  return (
    <div className={styles.card} data-status={status}>
      <button className={styles.header} onClick={() => setOpen((o) => !o)}>
        <span className={`material-symbols-outlined ${styles.statusIcon}`}>
          {STATUS_ICON[status]}
        </span>
        <span className={styles.title}>{title}</span>
        {summary && <span className={styles.summary}>{summary}</span>}
        <span className={`material-symbols-outlined ${styles.caret}`}>
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>
      {open && children && (
        <div className={styles.body}>
          {children}
          {onFullscreen && (
            <button className={styles.fullscreenBtn} onClick={onFullscreen}>
              <span className="material-symbols-outlined">fullscreen</span>
              全屏查看
            </button>
          )}
        </div>
      )}
    </div>
  );
}