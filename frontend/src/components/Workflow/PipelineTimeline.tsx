import { NODE_STATE_KEYS } from '../../services/langgraph/contracts';
import type { NarraWorkflowState } from '../../services/langgraph/types';
import styles from './PipelineTimeline.module.css';

const STAGE_ICON: Record<string, string> = {
  gen_script: 'edit_note',
  script_review: 'rate_review',
  split_segment: 'content_cut',
  synthesis: 'mic',
};

interface Props {
  nodes: { id: string; name: string }[];
  values: Partial<NarraWorkflowState>;
  currentStage?: string;
}

function statusFor(
  nodeId: string,
  values: Partial<NarraWorkflowState>,
  currentStage?: string,
): 'completed' | 'running' | 'pending' {
  const keys = NODE_STATE_KEYS[nodeId] ?? [];
  const completed = keys.every((k) => values[k as keyof NarraWorkflowState] != null);
  if (completed) return 'completed';
  if (nodeId === currentStage) return 'running';
  return 'pending';
}

export function PipelineTimeline({ nodes, values, currentStage }: Props) {
  return (
    <div className={styles.timeline}>
      {nodes.map((n, i) => {
        const status = statusFor(n.id, values, currentStage);
        return (
          <div key={n.id} className={styles.stage} data-status={status}>
            <span className={`material-symbols-outlined ${styles.icon}`}>
              {STAGE_ICON[n.id] ?? 'circle'}
            </span>
            <span className={styles.label}>{n.name}</span>
            {i < nodes.length - 1 && (
              <span className={`material-symbols-outlined ${styles.chevron}`}>
                chevron_right
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}