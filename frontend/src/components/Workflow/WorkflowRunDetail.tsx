import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { workflowApi } from '../../services/api';
import { Loading } from '../ui/Loading';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { WorkflowRun, WorkflowStageName } from '../../types';
import styles from './WorkflowRunDetail.module.css';

interface WorkflowRunDetailProps {
  projectId: string;
  runId: string;
  onBack: () => void;
}

const STATUS_ICONS: Record<string, string> = {
  completed: 'check_circle',
  running: 'sync',
  failed: 'error',
  interrupted: 'pause_circle',
  pending: 'schedule',
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'var(--color-success)',
  running: 'var(--color-primary)',
  failed: 'var(--color-error)',
  interrupted: 'var(--color-warning)',
  pending: 'var(--color-text-muted)',
};

export function WorkflowRunDetail({ projectId, runId, onBack }: WorkflowRunDetailProps) {
  const { t } = useTranslation();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'replay' | 'fork'; stage: WorkflowStageName } | null>(null);

  const fetchRun = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await workflowApi.get(projectId, runId);
      setRun(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow run');
    } finally {
      setLoading(false);
    }
  }, [projectId, runId]);

  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  const handleConfirmAction = async () => {
    if (!confirmAction || !run) return;
    try {
      if (confirmAction.type === 'replay') {
        await workflowApi.replay(projectId, runId, { from_stage: confirmAction.stage });
        await fetchRun();
      } else {
        await workflowApi.fork(projectId, runId, { from_stage: confirmAction.stage, state_override: {} });
        onBack();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${confirmAction.type} workflow`);
    } finally {
      setConfirmAction(null);
    }
  };

  if (loading) {
    return <Loading message={t('workflow.common.loading')} />;
  }

  if (error) {
    return (
      <div className={styles.runDetail}>
        <button className={styles.backButton} onClick={onBack}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
          {t('workflow.common.back')}
        </button>
        <div className={styles.errorBanner}>{error}</div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className={styles.runDetail}>
        <button className={styles.backButton} onClick={onBack}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
          {t('workflow.common.back')}
        </button>
        <div className={styles.loading}>{t('workflow.common.notFound')}</div>
      </div>
    );
  }

  const totalDuration = run.stages.reduce((sum, s) => sum + (s.duration_sec || 0), 0);

  const formatDuration = (seconds: number | null) => {
    if (seconds == null) return '-';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  return (
    <div className={styles.runDetail}>
      <button className={styles.backButton} onClick={onBack}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
        {t('workflow.common.back')}
      </button>

      <div className={styles.header}>
        <h2 className={styles.title}>
          {t('workflow.detail.runId', { id: run.id.slice(0, 8) })} — {t(`workflow.status.${run.status}`)}
        </h2>
        <div className={styles.meta}>
          <span>{t('workflow.detail.startedAt')}: {new Date(run.created_at).toLocaleString()}</span>
          <span>{t('workflow.detail.totalDuration')}: {formatDuration(totalDuration)}</span>
        </div>
      </div>

      {run.error && (
        <div className={styles.errorBanner}>
          {run.error}
        </div>
      )}

      {run.status === 'interrupted' && run.interrupt_payload && (
        <div className={styles.interruptInfo}>
          <div className={styles.interruptLabel}>{t('workflow.detail.reviewResult')}</div>
          <div className={styles.interruptValue}>
            {t('workflow.detail.reviewScore')}:
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--color-primary)', verticalAlign: 'text-bottom', marginLeft: 4 }}>star</span>
            {run.interrupt_payload.review.overall_score}/5
          </div>
        </div>
      )}

      {run.stages.map(stage => (
        <div key={stage.name} className={styles.stageCard}>
          <div className={styles.stageHeader}>
            <span className={styles.stageName}>
              <span
                className={`material-symbols-outlined ${styles.statusIcon}`}
                style={{ color: STATUS_COLORS[stage.status] }}
              >
                {STATUS_ICONS[stage.status]}
              </span>
              {t(`workflow.stage.${stage.name}`)}
            </span>
            <span className={styles.stageDuration}>
              {formatDuration(stage.duration_sec)}
            </span>
          </div>

          <div className={styles.stageOutput}>
            {stage.status === 'completed' && stage.name === 'gen_script' && (
              <span>{t('workflow.detail.outputSummary')}: ...</span>
            )}
            {stage.status === 'completed' && stage.name === 'script_review' && run.interrupt_payload && (
              <span>
                {t('workflow.detail.reviewScore')}:
                <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--color-primary)', verticalAlign: 'text-bottom', marginLeft: 4 }}>star</span>
                {run.interrupt_payload.review.overall_score}/5
              </span>
            )}
            {stage.status === 'completed' && stage.name === 'split_segment' && (
              <span>{t('workflow.detail.segments')}: ...</span>
            )}
            {stage.status === 'completed' && stage.name === 'synthesis' && (
              <span>{t('workflow.detail.audioFiles')}: ...</span>
            )}
            {stage.status === 'failed' && run.error && (
              <span className={styles.errorMessage}>{run.error}</span>
            )}
          </div>

          <div className={styles.stageActions}>
            {(stage.status === 'completed' || stage.status === 'failed') && (
              <>
                <button
                  className={styles.actionButton}
                  onClick={() => setConfirmAction({ type: 'replay', stage: stage.name })}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>replay</span>
                  {t('workflow.detail.replayFromHere')}
                </button>
                <button
                  className={styles.actionButton}
                  onClick={() => setConfirmAction({ type: 'fork', stage: stage.name })}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>call_split</span>
                  {t('workflow.detail.forkFromHere')}
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.type === 'replay' ? t('workflow.detail.replayFromHere') : t('workflow.detail.forkFromHere')}
        message={confirmAction ? (
          confirmAction.type === 'replay'
            ? t('workflow.detail.confirmReplay', { stage: t(`workflow.stage.${confirmAction.stage}`) })
            : t('workflow.detail.confirmFork', { stage: t(`workflow.stage.${confirmAction.stage}`) })
        ) : ''}
        variant="warning"
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
