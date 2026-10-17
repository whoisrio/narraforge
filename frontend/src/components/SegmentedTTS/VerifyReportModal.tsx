/**
 * 核对报告弹层：批量核对完成后汇总本次 run 的发现。
 *
 * 每条 mismatch/error 段直接并排 基准（实际朗读） vs ASR 回读 diff + 相似度，
 * 提供「详情」（打开单段核对详情弹层）与「忽略」（mismatch 置 ignored）。
 * 目标：不用逐段点角标，一处看全"哪几段、差在哪"。
 */
import type { VerifyReportData, VerifyReportItem } from '../../services/ttsVerify';
import { VerificationDiffText } from './VerificationDiffText';
import { useTranslation } from '../../i18n';
import styles from './VerifyReportModal.module.css';

interface VerifyReportModalProps {
  data: VerifyReportData;
  onClose: () => void;
  /** 打开单段核对详情（调用方负责先关报告，避免双层遮罩） */
  onOpenDetail: (segmentId: string) => void;
  /** 忽略不一致（仅 mismatch 条目渲染；调用方同步移除该条目） */
  onIgnore: (segmentId: string) => void;
}

function ReportItemRow({ item, onOpenDetail, onIgnore }: {
  item: VerifyReportItem;
  onOpenDetail: (segmentId: string) => void;
  onIgnore: (segmentId: string) => void;
}) {
  const { t } = useTranslation();
  const v = item.verification;
  const isError = v.status === 'error';
  const similarityPct = v.similarity != null ? Math.round(v.similarity * 100) : null;

  return (
    <article className={styles.item} data-segment-id={item.segmentId}>
      <header className={styles.itemHeader}>
        <span className={styles.itemLoc}>{t('ttsVerify.report.chapterSegment', { chapter: item.chapterName, index: item.segmentIndex })}</span>
        <span className={`${styles.statusChip} ${isError ? styles.statusError : styles.statusMismatch}`}>
          {isError ? t('ttsVerify.badge.error') : t('ttsVerify.badge.mismatch')}
        </span>
        {similarityPct != null && (
          <span className={styles.similarity}>{t('ttsVerify.detail.similarity', { similarity: similarityPct })}</span>
        )}
        <span className={styles.itemActions}>
          <button type="button" className={styles.ghostBtn} onClick={() => onOpenDetail(item.segmentId)}>
            {t('ttsVerify.report.openDetail')}
          </button>
          {!isError && (
            <button type="button" className={styles.ghostBtn} onClick={() => onIgnore(item.segmentId)}>
              {t('ttsVerify.report.ignore')}
            </button>
          )}
        </span>
      </header>
      {isError ? (
        <p className={styles.errorNote}>{t('ttsVerify.detail.errorNote', { error: v.error || '' })}</p>
      ) : (
        <div className={styles.textGrid}>
          <div className={styles.textCol}>
            <h4>{t('ttsVerify.detail.displayText')}</h4>
            <p className={styles.plainText}>{item.displayText || '—'}</p>
          </div>
          <div className={styles.diffPair}>
            <div className={styles.textCol}>
              <h4>{t('ttsVerify.detail.baseline')}</h4>
              <p className={styles.diffText}>
                {v.diff && v.diff.length > 0 ? <VerificationDiffText ops={v.diff} side="baseline" /> : v.baseline_text || '—'}
              </p>
            </div>
            <div className={styles.textCol}>
              <h4>{t('ttsVerify.detail.asr')}</h4>
              <p className={styles.diffText}>
                {v.diff && v.diff.length > 0 ? <VerificationDiffText ops={v.diff} side="asr" /> : v.asr_text || '—'}
              </p>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export function VerifyReportModal({ data, onClose, onOpenDetail, onIgnore }: VerifyReportModalProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.overlay} role="dialog" aria-label={t('ttsVerify.report.title')} onClick={onClose}>
      <section className={styles.card} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h3>{t('ttsVerify.report.title')}</h3>
          <button type="button" aria-label={t('common.close')} onClick={onClose}>×</button>
        </header>

        <div className={styles.summary}>
          <span className={styles.scopeLine}>
            {t('ttsVerify.report.scopeLine', {
              scope: data.scope === 'chapter' ? t('ttsVerify.menu.verifyChapter') : t('ttsVerify.menu.verifyProject'),
              total: data.total,
              verified: data.verified,
            })}
          </span>
          <span className={`${styles.countChip} ${styles.countMatch}`}>{t('ttsVerify.report.matchCount', { count: data.matchCount })}</span>
          <span className={`${styles.countChip} ${styles.countMismatch}`}>{t('ttsVerify.report.mismatchCount', { count: data.mismatchCount })}</span>
          <span className={`${styles.countChip} ${styles.countError}`}>{t('ttsVerify.report.errorCount', { count: data.errorCount })}</span>
        </div>

        <div className={styles.body}>
          {data.items.length === 0 ? (
            <p className={styles.allMatch}>{t('ttsVerify.report.allMatch')}</p>
          ) : (
            data.items.map((item) => (
              <ReportItemRow key={item.segmentId} item={item} onOpenDetail={onOpenDetail} onIgnore={onIgnore} />
            ))
          )}
        </div>

        <footer className={styles.footer}>
          <span className={styles.spacer} />
          <button type="button" className={styles.primaryBtn} onClick={onClose}>{t('ttsVerify.report.close')}</button>
        </footer>
      </section>
    </div>
  );
}
