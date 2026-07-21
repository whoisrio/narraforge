import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { workflowApi } from '../../services/api';
import { useWorkflowStream } from '../../hooks/useWorkflowStream';
import { LiveProgress } from './LiveProgress';
import { Loading } from '../ui/Loading';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import type { WorkflowRun, WorkflowStatus, WorkflowStageName } from '../../types';
import styles from './WorkflowHub.module.css';

interface WorkflowHubProps {
  projectId: string;
  onViewRun?: (runId: string) => void;
  onViewReview?: (runId: string) => void;
}

const STAGES: WorkflowStageName[] = ['gen_script', 'script_review', 'split_segment', 'synthesis'];

export function WorkflowHub({ projectId, onViewRun, onViewReview }: WorkflowHubProps) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const data = await workflowApi.list(projectId);
      setRuns(data);
      // Auto-subscribe to running workflow SSE (covers resume from interrupted)
      const running = data.find(r => r.status === 'running');
      if (running) {
        setActiveRunId(prev => prev ?? running.id);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Subscribe to active workflow SSE
  useWorkflowStream(projectId, activeRunId, {
    onStageComplete: () => fetchRuns(),
    onComplete: () => { fetchRuns(); setActiveRunId(null); },
    onError: () => fetchRuns(),
    onInterrupt: () => fetchRuns(),
  });

  const handleStart = async () => {
    try {
      const run = await workflowApi.start(projectId);
      setActiveRunId(run.id);
      await fetchRuns();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { status?: number } };
        if (axiosErr.response?.status === 409) {
          alert(t('workflow.hub.activeWorkflowExists'));
        }
      }
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    await workflowApi.cancel(projectId, cancelTarget);
    setCancelTarget(null);
    await fetchRuns();
  };

  const hasActive = runs.some(r => r.status === 'running' || r.status === 'interrupted');

  const statusClass = (status: WorkflowStatus) => {
    switch (status) {
      case 'running': return styles.statusRunning;
      case 'interrupted': return styles.statusInterrupted;
      case 'completed': return styles.statusCompleted;
      case 'failed': return styles.statusFailed;
      case 'cancelled': return styles.statusCancelled;
    }
  };

  const stageClass = (run: WorkflowRun, stage: WorkflowStageName) => {
    const s = run.stages.find(s => s.name === stage);
    if (!s) return '';
    switch (s.status) {
      case 'completed': return styles.stageChipCompleted;
      case 'running': return styles.stageChipRunning;
      case 'failed': return styles.stageChipFailed;
      default: return '';
    }
  };

  if (loading) return <Loading message={t('workflow.common.loading')} />;

  return (
    <div className={styles.workflowHub}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t('workflow.hub.title')}</h2>
        <button
          className={styles.newRunButton}
          onClick={handleStart}
          disabled={hasActive}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          {t('workflow.common.newRun')}
        </button>
      </div>

      {/* Live progress for active workflow */}
      {runs.some(r => r.status === 'running') && (
        <LiveProgress
          projectId={projectId}
          runId={runs.find(r => r.status === 'running')!.id}
          currentStage={runs.find(r => r.status === 'running')!.current_stage}
          status="running"
        />
      )}

      {runs.length === 0 ? (
        <div className={styles.emptyState}>{t('workflow.hub.noRuns')}</div>
      ) : (
        runs.map(run => (
          <div key={run.id} className={styles.runCard}>
            <div className={styles.runHeader}>
              <span className={`${styles.statusBadge} ${statusClass(run.status)}`}>
                {t(`workflow.status.${run.status}`)}
                {run.status === 'interrupted' && ` @ ${t(`workflow.stage.${run.current_stage}`)}`}
              </span>
              <span className={styles.timestamp}>
                {t('workflow.hub.startedAt', { time: new Date(run.created_at).toLocaleString() })}
              </span>
            </div>

            <div className={styles.stagesRow}>
              {STAGES.map(stage => (
                <div
                  key={stage}
                  className={`${styles.stageChip} ${stageClass(run, stage)}`}
                >
                  {t(`workflow.stage.${stage}`)}
                </div>
              ))}
            </div>

            <div className={styles.actions}>
              {run.status === 'interrupted' && (
                <button
                  className={`${styles.actionButton} ${styles.primary}`}
                  onClick={() => onViewReview?.(run.id)}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>rate_review</span>
                  {t('workflow.hub.viewReview')}
                </button>
              )}
              {(run.status === 'completed' || run.status === 'failed') && (
                <button
                  className={styles.actionButton}
                  onClick={() => onViewRun?.(run.id)}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility</span>
                  {t('workflow.hub.viewDetail')}
                </button>
              )}
              {(run.status === 'running' || run.status === 'interrupted') && (
                <button
                  className={`${styles.actionButton} ${styles.danger}`}
                  onClick={() => setCancelTarget(run.id)}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>cancel</span>
                  {t('workflow.common.cancel')}
                </button>
              )}
            </div>
          </div>
        ))
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        title={t('workflow.common.cancel')}
        message={t('workflow.hub.confirmCancel')}
        variant="danger"
        onConfirm={handleConfirmCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
