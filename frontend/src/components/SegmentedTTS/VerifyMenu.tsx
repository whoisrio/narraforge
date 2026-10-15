/**
 * 「语音核对」下拉 + 进度 pill（Studio 底部工具栏）。
 *
 * 三态：
 * - 空闲：下拉（核对本章 / 全量核对——目标段走 selectVerifySegments，只补缺）
 * - 活跃 run（本 tab 在跑或快照）：pill「核对中 done/total」，本 tab 可取消；
 *   快照 run 不随进度跳动（不轮询），下拉禁用（409 防重兜底在数据层）
 * - 中断 run：pill「上次核对中断于 done/total」+ 一键续跑（幂等只补缺）
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import styles from './VerifyMenu.module.css';

export type VerifyScope = { kind: 'chapter' } | { kind: 'project' };

interface VerifyMenuProps {
  disabled?: boolean;
  /** 活跃 run（本 tab 实时或跨 tab 快照；心跳过期由调用方归入 interrupted） */
  running?: { done: number; total: number; snapshot: boolean } | null;
  /** 中断 run（上次没跑完） */
  interrupted?: { done: number; total: number } | null;
  onSelect: (scope: VerifyScope) => void;
  onCancel?: () => void;
  onResume?: () => void;
}

export function VerifyMenu({ disabled, running, interrupted, onSelect, onCancel, onResume }: VerifyMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const runActive = !!running;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // 活跃/中断时用 pill 代替下拉入口
  if (runActive || interrupted) {
    return (
      <div className={styles.wrap} data-testid="verify-run-pill">
        <span className={`${styles.pill} ${runActive ? styles.pillRunning : styles.pillInterrupted}`}>
          {runActive
            ? t('ttsVerify.pill.running', { done: running!.done, total: running!.total })
            : t('ttsVerify.pill.interrupted', { done: interrupted!.done, total: interrupted!.total })}
        </span>
        {runActive && !running!.snapshot && onCancel && (
          <button type="button" className={styles.pillBtn} onClick={onCancel}>
            {t('ttsVerify.pill.cancel')}
          </button>
        )}
        {!runActive && onResume && (
          <button type="button" className={styles.pillBtn} onClick={onResume}>
            {t('ttsVerify.pill.resume')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.btn}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        ◎ {t('ttsVerify.menu.label')} ▾
      </button>
      {open && (
        <div className={`${styles.menu} ${styles.menuUp}`} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={styles.item}
            onClick={(e) => { e.stopPropagation(); setOpen(false); onSelect({ kind: 'chapter' }); }}
          >
            {t('ttsVerify.menu.verifyChapter')}
          </button>
          <button
            type="button"
            className={styles.item}
            onClick={(e) => { e.stopPropagation(); setOpen(false); onSelect({ kind: 'project' }); }}
          >
            {t('ttsVerify.menu.verifyProject')}
          </button>
        </div>
      )}
    </div>
  );
}
