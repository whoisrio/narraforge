import { useState, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { workflowApi } from '../../services/api';
import { Loading } from '../ui/Loading';
import type { WorkflowRun, WorkflowReviewResult, WorkflowReviewDimension } from '../../types';
import styles from './ReviewEditor.module.css';

interface ReviewEditorProps {
  projectId: string;
  runId: string;
  onBack: () => void;
  onComplete?: () => void;
}

const DIMENSION_ICONS: Record<string, string> = {
  pass: 'check_circle',
  warn: 'warning',
  fail: 'cancel',
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

  if (!run || !run.interrupt_payload) return <Loading message={t('workflow.common.loading')} />;

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
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
        {t('workflow.common.back')}
      </button>

      <h2 className={styles.title}>
        {t('workflow.review.title')} — Run #{run.id.slice(0, 8)}
      </h2>

      {/* LLM Review 反馈 */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{t('workflow.review.llmReview')}</div>

        <div className={styles.overallScore}>
          <span className={styles.scoreStars}>
            {Array.from({ length: 5 }, (_, i) => (
              <span
                key={i}
                className="material-symbols-outlined"
                style={{ color: i < review.overall_score ? 'var(--color-primary)' : 'var(--color-text-disabled)', fontSize: 20 }}
              >
                {i < review.overall_score ? 'star' : 'star_border'}
              </span>
            ))}
          </span>
          <span className={styles.scoreValue}>{review.overall_score}/5</span>
          <span className={styles.overallComment}>{review.overall_comment}</span>
        </div>

        {review.has_critical_issue && (
          <div className={styles.criticalWarning}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>error</span>
            {t('workflow.review.criticalIssueWarning')}
          </div>
        )}

        <div className={styles.dimensionList}>
          {review.dimensions.map((dim: WorkflowReviewDimension) => (
            <div key={dim.name} className={styles.dimension}>
              <span className={styles.dimensionIcon}>
                <span
                  className="material-symbols-outlined"
                  style={{
                    color: dim.status === 'pass' ? 'var(--color-success)' : dim.status === 'warn' ? 'var(--color-warning)' : 'var(--color-error)',
                    fontSize: 20,
                  }}
                >
                  {DIMENSION_ICONS[dim.status]}
                </span>
              </span>
              <div className={styles.dimensionContent}>
                <div className={styles.dimensionName}>{dim.name}</div>
                <div className={styles.dimensionComment}>{dim.comment}</div>
                {dim.suggestion && (
                  <div className={styles.dimensionSuggestion}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_forward</span>
                    {dim.suggestion}
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
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
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
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
              {t('workflow.review.reject')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.approveButton}`}
              onClick={handleApprove}
              disabled={submitting}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span>
              {t('workflow.review.approve')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.approveEditButton}`}
              onClick={handleApprove}
              disabled={submitting}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
              {t('workflow.review.approveAndEdit')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
