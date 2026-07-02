import { useEffect } from 'react';
import type { TextAnalysisSplitResult } from '../../services/api';
import styles from './ScriptAnalysisModal.module.css';

interface Props {
  result: TextAnalysisSplitResult | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ScriptAnalysisModal({ result, loading, onClose, onConfirm }: Props) {
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
            <span className={styles.titleText}>智能分析结果</span>
            {result?.method && (
              <span className={styles.methodBadge}>{result.method}</span>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading}>分析中...</div>
          ) : !result ? (
            <div className={styles.loading}>分析失败，请重试</div>
          ) : (
            <>
              {/* Chapters */}
              <div className={styles.section}>
                <div className={styles.sectionLabel}>
                  📑 {result.chapters.length} 个章节
                </div>
                {result.chapters.length > 0 ? (
                  <div className={styles.chapterList}>
                    {result.chapters.map((ch, i) => (
                      <div key={i} className={styles.chapterItem}>
                        <span className={styles.chapterIdx}>#{i + 1}</span>
                        <span className={styles.chapterTitle}>{ch.title || '(未命名)'}</span>
                        <span className={styles.chapterSegCount}>{ch.segments.length} 句</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.empty}>未检测到章节</div>
                )}
              </div>

              {/* Roles */}
              <div className={styles.section}>
                <div className={styles.sectionLabel}>
                  🎭 {result.detected_roles.length} 个角色
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
                            出现 {role.occurrences} 次
                          </div>
                        </div>
                        <span className={`${styles.roleConfBadge} ${role.confidence >= 0.9 ? styles.high : styles.mid}`}>
                          {Math.round(role.confidence * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.empty}>未检测到角色 · 可能文本量太小或格式不标准</div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {result && !loading && (
          <div className={styles.footer}>
            <button className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
              取消
            </button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onConfirm}>
              确认并应用
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
