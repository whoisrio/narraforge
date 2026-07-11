import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { workflowApi } from '../../services/api';
import type { WorkflowRun, WorkflowStageName } from '../../types';
import styles from './WorkflowRunDetail.module.css';

interface WorkflowRunDetailProps {
  projectId: string;
  runId: string;
  onBack: () => void;
}

const STATUS_ICONS: Record<string, string> = {
  completed: '✅',
  running: '🔄',
  failed: '❌',
  interrupted: '⏸️',
  pending: '⏳',
};

export function WorkflowRunDetail({ projectId, runId, onBack }: WorkflowRunDetailProps) {
  const { t } = useTranslation();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const handleReplay = async (stage: WorkflowStageName) => {
    if (!confirm(t('workflow.detail.confirmReplay', { stage: t(`workflow.stage.${stage}`) }))) return;
    try {
      await workflowApi.replay(projectId, runId, { from_stage: stage });
      await fetchRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to replay workflow');
    }
  };

  const handleFork = async (stage: WorkflowStageName) => {
    if (!confirm(t('workflow.detail.confirmFork', { stage: t(`workflow.stage.${stage}`) }))) return;
    try {
      await workflowApi.fork(projectId, runId, { from_stage: stage, state_override: {} });
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fork workflow');
    }
  };

  if (loading) {
    return <div className={styles.loading}>{t('workflow.common.loading')}</div>;
  }

  if (error) {
    return (
      <div className={styles.runDetail}>
        <button className={styles.backButton} onClick={onBack}>
          ← {t('workflow.common.back')}
        </button>
        <div className={styles.errorBanner}>{error}</div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className={styles.runDetail}>
        <button className={styles.backButton} onClick={onBack}>
          ← {t('workflow.common.back')}
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
        ← {t('workflow.common.back')}
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
            {t('workflow.detail.reviewScore')}: ⭐{run.interrupt_payload.review.overall_score}/5
          </div>
        </div>
      )}

      {run.stages.map(stage => (
        <div key={stage.name} className={styles.stageCard}>
          <div className={styles.stageHeader}>
            <span className={styles.stageName}>
              <span className={styles.statusIcon}>{STATUS_ICONS[stage.status]}</span>
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
                {t('workflow.detail.reviewScore')}: ⭐{run.interrupt_payload.review.overall_score}/5
              </span>
            )}
            {stage.status === 'completed' && stage.name === 'split_segment' && (
              <span>{t('workflow.detail.segments')}: ...</span>
            )}
            {stage.status === 'completed' && stage.name === 'synthesis' && (
              <span>{t('workflow.detail.audioFiles')}: ...</span>
            )}
            {stage.status === 'failed' && run.error && (
              <span style={{ color: 'var(--color-error)' }}>{run.error}</span>
            )}
          </div>

          <div className={styles.stageActions}>
            {(stage.status === 'completed' || stage.status === 'failed') && (
              <>
                <button
                  className={styles.actionButton}
                  onClick={() => handleReplay(stage.name)}
                >
                  🔄 {t('workflow.detail.replayFromHere')}
                </button>
                <button
                  className={styles.actionButton}
                  onClick={() => handleFork(stage.name)}
                >
                  🍴 {t('workflow.detail.forkFromHere')}
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
