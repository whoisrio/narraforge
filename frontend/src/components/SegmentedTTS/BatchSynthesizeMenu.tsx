import { useState, useRef, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import styles from './BatchSynthesizeMenu.module.css';

export type BatchSynthesizeMode = 'unsynthesized' | 'all';

interface BatchSynthesizeMenuProps {
  disabled?: boolean;
  onSelect: (mode: BatchSynthesizeMode) => void;
  /** 触发按钮文案；默认「批量合成」，一键制作全本复用本组件时传「一键制作全本」 */
  label?: string;
  /** 菜单弹出方向：默认向下；底部工具栏（VoiceStudio 传输条）传 'up' 向上弹出 */
  placement?: 'down' | 'up';
}

export function BatchSynthesizeMenu({ disabled, onSelect, label, placement = 'down' }: BatchSynthesizeMenuProps) {
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
        ⚡ {label ?? t('studio.batchSynthesize')} ▾
      </button>
      {open && (
        <div className={`${styles.menu} ${placement === 'up' ? styles.menuUp : ''}`} onClick={(e) => e.stopPropagation()}>
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
