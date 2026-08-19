import { useEffect, type ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 纯文本或富内容（如重拆确认的保留/丢弃明细） */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'warning' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message,
  confirmLabel,
  cancelLabel,
  variant = 'warning',
  onConfirm, onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t('common.confirm');
  const resolvedCancelLabel = cancelLabel ?? t('common.cancel');

  // Esc dismisses (equivalent to cancel). Only active while open.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} role="alertdialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className={variant === 'danger' ? styles.headerDanger : styles.headerWarning}>
          <span className={styles.icon}>{variant === 'danger' ? '🗑' : '⚠'}</span>
          <h3 className={styles.title}>{title}</h3>
        </div>
        <div className={styles.body}>
          <div className={styles.message}>{message}</div>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.cancelBtn}
            // For destructive actions, default focus to cancel so an accidental
            // Enter doesn't trigger the destructive confirm.
            autoFocus={variant === 'danger'}
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
          >{resolvedCancelLabel}</button>
          <button
            className={variant === 'danger' ? styles.confirmDanger : styles.confirmWarning}
            autoFocus={variant !== 'danger'}
            onClick={(e) => { e.stopPropagation(); onConfirm(); }}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
