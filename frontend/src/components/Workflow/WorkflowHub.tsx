import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { workflowApi } from '../../services/api';
import { useWorkflowStream } from '../../hooks/useWorkflowStream';
import { LiveProgress } from './LiveProgress';
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

  const fetchRuns = useCallback(async () => {
    try {
      const data = await workflowApi.list(projectId);
      setRuns(data);
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

  const handleCancel = async (runId: string) => {
    if (!confirm(t('workflow.hub.confirmCancel'))) return;
    await workflowApi.cancel(projectId, runId);
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

  if (loading) return <div>Loading...</div>;

  return (
    <div className={styles.workflowHub}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t('workflow.hub.title')}</h2>
        <button
          className={styles.newRunButton}
          onClick={handleStart}
          disabled={hasActive}
        >
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
              <span style={{ fontSize: 12, color: '#999' }}>
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
                  {t('workflow.hub.viewReview')}
                </button>
              )}
              {(run.status === 'completed' || run.status === 'failed') && (
                <button
                  className={styles.actionButton}
                  onClick={() => onViewRun?.(run.id)}
                >
                  {t('workflow.hub.viewDetail')}
                </button>
              )}
              {(run.status === 'running' || run.status === 'interrupted') && (
                <button
                  className={`${styles.actionButton} ${styles.danger}`}
                  onClick={() => handleCancel(run.id)}
                >
                  {t('workflow.common.cancel')}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
