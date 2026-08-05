import { useState, useRef, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import styles from './BatchSynthesizeMenu.module.css';

export type BatchSynthesizeMode = 'unsynthesized' | 'all';

interface BatchSynthesizeMenuProps {
  disabled?: boolean;
  onSelect: (mode: BatchSynthesizeMode) => void;
}

export function BatchSynthesizeMenu({ disabled, onSelect }: BatchSynthesizeMenuProps) {
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

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.btn}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        ⚡ {t('studio.batchSynthesize')} ▾
      </button>
      {open && (
        <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={styles.item}
            onClick={(e) => { e.stopPropagation(); setOpen(false); onSelect('unsynthesized'); }}
          >
            {t('studio.batchSynthesizeUnsynthesized')}
          </button>
          <button
            type="button"
            className={styles.item}
            onClick={(e) => { e.stopPropagation(); setOpen(false); onSelect('all'); }}
          >
            {t('studio.batchSynthesizeRegenerateAll')}
          </button>
        </div>
      )}
    </div>
  );
}
