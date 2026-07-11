import { useState, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { workflowApi } from '../../services/api';
import type { WorkflowRun, WorkflowReviewResult, WorkflowReviewDimension } from '../../types';
import styles from './ReviewEditor.module.css';

interface ReviewEditorProps {
  projectId: string;
  runId: string;
  onBack: () => void;
  onComplete?: () => void;
}

const DIMENSION_ICONS: Record<string, string> = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
};

export function ReviewEditor({ projectId, runId, onBack, onComplete }: ReviewEditorProps) {
  const { t } = useTranslation();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [script, setScript] = useState('');
  const [directorNote, setDirectorNote] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    workflowApi.get(projectId, runId).then(r => {
      setRun(r);
      if (r.interrupt_payload) {
        setScript(r.interrupt_payload.script);
      }
    });
  }, [projectId, runId]);

  if (!run || !run.interrupt_payload) return <div>Loading...</div>;

  const review = run.interrupt_payload.review as WorkflowReviewResult;

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      await workflowApi.resume(projectId, runId, {
        stage: run!.current_stage,
        action: 'approve',
        edited_script: script !== run.interrupt_payload!.script ? script : undefined,
        comment: directorNote || undefined,
      });
      onComplete?.();
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectFeedback.trim()) return;
    setSubmitting(true);
    try {
      await workflowApi.resume(projectId, runId, {
        stage: run!.current_stage,
        action: 'reject',
        feedback: rejectFeedback,
      });
      onComplete?.();
    } finally {
      setSubmitting(false);
    }
  };

  const wordCount = script.length;
  const estimatedMinutes = Math.ceil(wordCount / 180);

  return (
    <div className={styles.reviewEditor}>
      <button className={styles.backButton} onClick={onBack}>
        ← {t('workflow.common.back')}
      </button>

      <h2 className={styles.title}>
        {t('workflow.review.title')} — Run #{run.id.slice(0, 8)}
      </h2>

      {/* LLM Review 反馈 */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('workflow.review.llmReview')}</div>

        <div className={styles.overallScore}>
          <span className={styles.scoreStars}>
            {'⭐'.repeat(review.overall_score)}{'☆'.repeat(5 - review.overall_score)}
          </span>
          <span className={styles.scoreValue}>{review.overall_score}/5</span>
          <span className={styles.overallComment}>{review.overall_comment}</span>
        </div>

        {review.has_critical_issue && (
          <div className={styles.criticalWarning}>
            {t('workflow.review.criticalIssueWarning')}
          </div>
        )}

        <div className={styles.dimensionList}>
          {review.dimensions.map((dim: WorkflowReviewDimension) => (
            <div key={dim.name} className={styles.dimension}>
              <span className={styles.dimensionIcon}>{DIMENSION_ICONS[dim.status]}</span>
              <div className={styles.dimensionContent}>
                <div className={styles.dimensionName}>{dim.name}</div>
                <div className={styles.dimensionComment}>{dim.comment}</div>
                {dim.suggestion && (
                  <div className={styles.dimensionSuggestion}>
                    → {dim.suggestion}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 旁白脚本编辑器 */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('workflow.review.scriptEditor')}</div>
        <textarea
          className={styles.scriptEditor}
          value={script}
          onChange={e => setScript(e.target.value)}
        />
        <div className={styles.stats}>
          <span>{t('workflow.review.wordCount')}: {wordCount}</span>
          <span>{t('workflow.review.estimatedDuration')}: {estimatedMinutes}min</span>
        </div>
      </div>

      {/* 导演备注 */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('workflow.review.directorNote')}</div>
        <textarea
          className={styles.directorNoteInput}
          value={directorNote}
          onChange={e => setDirectorNote(e.target.value)}
          placeholder={t('workflow.review.directorNotePlaceholder')}
        />
      </div>

      {/* 拒绝反馈输入 */}
      {showRejectInput && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('workflow.review.rejectFeedbackTitle')}</div>
          <textarea
            className={styles.directorNoteInput}
            value={rejectFeedback}
            onChange={e => setRejectFeedback(e.target.value)}
            placeholder={t('workflow.review.rejectFeedbackPlaceholder')}
          />
        </div>
      )}

      {/* 操作按钮 */}
      <div className={styles.actions}>
        {showRejectInput ? (
          <>
            <button
              className={`${styles.actionButton} ${styles.rejectButton}`}
              onClick={handleReject}
              disabled={submitting || !rejectFeedback.trim()}
            >
              {t('workflow.review.reject')}
            </button>
            <button
              className={styles.actionButton}
              onClick={() => setShowRejectInput(false)}
            >
              {t('workflow.common.cancel')}
            </button>
          </>
        ) : (
          <>
            <button
              className={`${styles.actionButton} ${styles.rejectButton}`}
              onClick={() => setShowRejectInput(true)}
            >
              ❌ {t('workflow.review.reject')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.approveButton}`}
              onClick={handleApprove}
              disabled={submitting}
            >
              ✅ {t('workflow.review.approve')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.approveEditButton}`}
              onClick={handleApprove}
              disabled={submitting}
            >
              ✅ {t('workflow.review.approveAndEdit')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
