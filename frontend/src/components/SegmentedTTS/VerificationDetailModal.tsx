/**
 * 核对详情弹层：基准文本 vs 回读文本并排 diff + 相似度 + 三个操作
 * （忽略不一致 / 重新核对 / 重新 TTS）。
 *
 * 最终裁决是人：归一化 + 相似度只负责把可疑段挑出来，忽略或重 TTS 由用户决定。
 */
import type { Segment } from '../../types';
import { resolveVerificationView } from '../../services/ttsVerify';
import { VerificationDiffText } from './VerificationDiffText';
import { useTranslation } from '../../i18n';
import styles from './VerificationDetailModal.module.css';

interface VerificationDetailModalProps {
  segment: Segment | undefined;
  verifying?: boolean;
  onClose: () => void;
  /** 忽略不一致（status → ignored，保留 asr_text 供追溯） */
  onIgnore: (segmentId: string) => void;
  /** 重新核对 */
  onReverify: (segmentId: string) => void;
  /** 重新 TTS（走现有重生成流程，完成后按设置决定是否自动重核） */
  onRegenerate: (segmentId: string) => void;
}

export function VerificationDetailModal({
  segment, verifying, onClose, onIgnore, onReverify, onRegenerate,
}: VerificationDetailModalProps) {
  const { t } = useTranslation();
  if (!segment) return null;
  const view = resolveVerificationView(segment);
  const v = view.verification;
  const similarityPct = v?.similarity != null ? Math.round(v.similarity * 100) : null;
  const emptyAsr = !!v && v.status !== 'error' && !v.asr_text.trim();

  const statusLabel = verifying
    ? t('ttsVerify.badge.verifying')
    : view.stale
      ? t('ttsVerify.badge.stale')
      : v
        ? t(`ttsVerify.badge.${v.status === 'match' ? 'match' : v.status === 'mismatch' ? 'mismatch' : v.status === 'ignored' ? 'ignored' : 'error'}`)
        : t('ttsVerify.badge.unverified');

  return (
    <div className={styles.overlay} role="dialog" aria-label={t('ttsVerify.detail.title')} onClick={onClose}>
      <section className={styles.card} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h3>{t('ttsVerify.detail.title')}</h3>
          <button type="button" aria-label={t('common.close')} onClick={onClose}>×</button>
        </header>

        <div className={styles.body}>
          <div className={styles.metaRow}>
            <span className={`${styles.statusChip} ${styles[`status_${verifying ? 'verifying' : view.state}`]}`}>
              {statusLabel}
            </span>
            {similarityPct != null && !verifying && (
              <span className={styles.similarity}>{t('ttsVerify.detail.similarity', { similarity: similarityPct })}</span>
            )}
            {v?.checked_at && (
              <span className={styles.checkedAt}>{new Date(v.checked_at).toLocaleString()}</span>
            )}
          </div>

          {v?.status === 'error' && (
            <p className={styles.errorNote}>{t('ttsVerify.detail.errorNote', { error: v.error || '' })}</p>
          )}
          {emptyAsr && (
            <p className={styles.errorNote}>{t('ttsVerify.detail.emptyAsr')}</p>
          )}
          {view.stale && (
            <p className={styles.staleNote}>{t('ttsVerify.detail.staleNote')}</p>
          )}

          <div className={styles.textGrid}>
            <div className={styles.textCol}>
              <h4>{t('ttsVerify.detail.displayText')}</h4>
              <p className={styles.plainText}>{segment.text || '—'}</p>
            </div>
            {v && (
              <>
                <div className={styles.textCol}>
                  <h4>{t('ttsVerify.detail.baseline')}</h4>
                  <p className={styles.diffText}>
                    {v.diff && v.diff.length > 0
                      ? <VerificationDiffText ops={v.diff} side="baseline" />
                      : v.baseline_text || '—'}
                  </p>
                </div>
                <div className={styles.textCol}>
                  <h4>{t('ttsVerify.detail.asr')}</h4>
                  <p className={styles.diffText}>
                    {v.diff && v.diff.length > 0
                      ? <VerificationDiffText ops={v.diff} side="asr" />
                      : v.asr_text || '—'}
                  </p>
                </div>
              </>
            )}
          </div>
          {!v && !verifying && (
            <p className={styles.staleNote}>{t('ttsVerify.detail.noVerification')}</p>
          )}
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.ghostBtn} onClick={onClose}>{t('common.close')}</button>
          <span className={styles.spacer} />
          <button
            type="button"
            className={styles.ghostBtn}
            disabled={verifying}
            onClick={() => onReverify(segment.id)}
          >
            {t('ttsVerify.detail.reverify')}
          </button>
          <button
            type="button"
            className={styles.ghostBtn}
            disabled={verifying}
            onClick={() => onRegenerate(segment.id)}
          >
            {t('ttsVerify.detail.regenerate')}
          </button>
          {v?.status === 'mismatch' && (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => onIgnore(segment.id)}
            >
              {t('ttsVerify.detail.ignore')}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
