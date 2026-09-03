import { createPortal } from 'react-dom';
import { useTranslation } from '../../i18n';
import styles from './LoadingModal.module.css';

export interface LoadingModalProps {
  message: string;
  elapsedMs: number;
  retryable: boolean;
  onRetry: () => void;
}

const SLOW_HINT_MS = 10_000;
const RETRY_MS = 30_000;

/**
 * 全局加载反馈模态（由 LoadingProvider 渲染，不直接对外使用）。
 *
 * 不可关闭：无关闭按钮、点遮罩无效——底层请求无法取消，"假关闭"会让用户
 * 以为操作完成。挂死防护：10s 安抚文案 + 已等待秒数；30s 且 retryable 时
 * 提供重试（abort 当前请求后重跑）。
 */
export function LoadingModal({ message, elapsedMs, retryable, onRetry }: LoadingModalProps) {
  const { t } = useTranslation();
  const showSlowHint = elapsedMs >= SLOW_HINT_MS;
  const showRetry = retryable && elapsedMs >= RETRY_MS;
  const elapsedSec = Math.floor(elapsedMs / 1000);

  return createPortal(
    <div className={styles.overlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-busy="true"
        aria-live="polite"
      >
        <div className={styles.spinner} aria-hidden="true" />
        <div className={styles.message}>{message}</div>
        {showSlowHint && (
          <div className={styles.slowHint}>
            <span>{t('loading.slowHint')}</span>
            <span>{t('loading.waitSeconds', { sec: elapsedSec })}</span>
          </div>
        )}
        {showRetry && (
          <button type="button" className={styles.retryBtn} onClick={onRetry}>
            {t('loading.retry')}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
