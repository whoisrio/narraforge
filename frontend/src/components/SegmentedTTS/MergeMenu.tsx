import { useState, useRef, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import styles from './MergeMenu.module.css';

interface MergeMenuProps {
  segmentId: string;
  canUp: boolean;
  canDown: boolean;
  onMerge: (id: string, direction: 'up' | 'down') => void;
  /** Compact button size when used in compact rows */
  compact?: boolean;
}

export function MergeMenu({ segmentId, canUp, canDown, onMerge, compact }: MergeMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Don't render if neither direction is available
  if (!canUp && !canDown) return null;

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={compact ? styles.btnCompact : styles.btn}
        title={t('segment.merge.title')}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        ⇄
      </button>
      {open && (
        <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
          {canDown && (
            <button
              className={styles.item}
              onClick={(e) => { e.stopPropagation(); setOpen(false); onMerge(segmentId, 'down'); }}
            >
              <span className={styles.icon}>⇣</span> {t('segment.merge.mergeDown')}
            </button>
          )}
          {canUp && (
            <button
              className={styles.item}
              onClick={(e) => { e.stopPropagation(); setOpen(false); onMerge(segmentId, 'up'); }}
            >
              <span className={styles.icon}>⇡</span> {t('segment.merge.mergeUp')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
