import { useEffect } from 'react';
import { useTranslation } from '../../i18n';
import type { TextAnalysisSplitResult } from '../../services/api';
import styles from './ScriptAnalysisModal.module.css';

interface Props {
  result: TextAnalysisSplitResult | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ScriptAnalysisModal({ result, loading, onClose, onConfirm }: Props) {
  const { t } = useTranslation();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <span className={styles.titleIcon}>🤖</span>
            <span className={styles.titleText}>{t('scriptAnalysis.title')}</span>
            {result?.method && (
              <span className={styles.methodBadge}>{result.method}</span>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading}>{t('scriptAnalysis.analyzing')}</div>
          ) : !result ? (
            <div className={styles.loading}>{t('scriptAnalysis.failed')}</div>
          ) : (
            <>
              {/* Chapters */}
              <div className={styles.section}>
                <div className={styles.sectionLabel}>
                  {t('scriptAnalysis.chaptersCount', { count: result.chapters.length })}
                </div>
                {result.chapters.length > 0 ? (
                  <div className={styles.chapterList}>
                    {result.chapters.map((ch, i) => (
                      <div key={i} className={styles.chapterItem}>
                        <span className={styles.chapterIdx}>#{i + 1}</span>
                        <span className={styles.chapterTitle}>{ch.title || t('scriptAnalysis.unnamed')}</span>
                        <span className={styles.chapterSegCount}>{t('scriptAnalysis.sentenceCount', { count: ch.segments.length })}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.empty}>{t('scriptAnalysis.noChaptersDetected')}</div>
                )}
              </div>

              {/* Roles */}
              <div className={styles.section}>
                <div className={styles.sectionLabel}>
                  {t('scriptAnalysis.rolesCount', { count: result.detected_roles.length })}
                </div>
                {result.detected_roles.length > 0 ? (
                  <div className={styles.roleList}>
                    {result.detected_roles.map((role) => (
                      <div key={role.name} className={styles.roleCard}>
                        <div className={styles.roleAvatar}>
                          {role.name.charAt(0)}
                        </div>
                        <div className={styles.roleInfo}>
                          <div className={styles.roleName}>{role.name}</div>
                          <div className={styles.roleOccur}>
                            {t('scriptAnalysis.occurrences', { count: role.occurrences })}
                          </div>
                        </div>
                        <span className={`${styles.roleConfBadge} ${role.confidence >= 0.9 ? styles.high : styles.mid}`}>
                          {Math.round(role.confidence * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.empty}>{t('scriptAnalysis.noRolesDetected')}</div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {result && !loading && (
          <div className={styles.footer}>
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
              {t('scriptAnalysis.cancel')}
            </button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onConfirm}>
              {t('scriptAnalysis.confirmAndApply')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
