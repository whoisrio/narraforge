import { useEffect, useState } from 'react';
import { useStream } from '@langchain/langgraph-sdk/react';
import { agentClient } from '../../services/langgraph/client';
import { NODE_STATE_KEYS } from '../../services/langgraph/contracts';
import type { MilestoneEvent, NarraWorkflowState } from '../../services/langgraph/types';
import { PipelineTimeline } from './PipelineTimeline';
import { StageCard } from './StageCard';
import { ReviewPanel } from './ReviewPanel';
import { StageDetailModal } from './StageDetailModal';
import styles from './WorkflowDrawer.module.css';

interface Props {
  threadId: string;
  projectId: string;
  onClose: () => void;
  onCollapse: () => void;
}

interface GraphNode {
  id: string;
  name: string;
}

const DEFAULT_NODES: GraphNode[] = [
  { id: 'gen_script', name: 'gen_script' },
  { id: 'script_review', name: 'script_review' },
  { id: 'split_segment', name: 'split_segment' },
  { id: 'synthesis', name: 'synthesis' },
];

function summaryFor(nodeId: string, values: Partial<NarraWorkflowState>): string | undefined {
  switch (nodeId) {
    case 'gen_script':
      if (values.narration_script) return `${values.script_chapters?.length ?? 0} 章 · ${values.narration_script.length} 字`;
      return undefined;
    case 'script_review':
      if (values.review_feedback) return `评分 ${values.review_feedback.overall_score}/5`;
      return undefined;
    case 'split_segment':
      if (values.structured_segments) {
        const total = values.structured_segments.reduce((s: number, c) => s + c.segments.length, 0);
        return `${values.structured_segments.length} 章 · ${total} 段`;
      }
      return undefined;
    case 'synthesis':
      if (values.synthesis_results) return `${values.synthesis_results.length} 段`;
      return undefined;
  }
  return undefined;
}

export function WorkflowDrawer({ threadId, projectId, onClose, onCollapse }: Props) {
  const [nodes, setNodes] = useState<GraphNode[]>(DEFAULT_NODES);
  const [milestones, setMilestones] = useState<Record<string, MilestoneEvent[]>>({});
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const stream = useStream<NarraWorkflowState>({
    apiUrl: typeof window !== 'undefined' ? `${window.location.origin}/agent` : '/agent',
    assistantId: 'narration',
    threadId,
    streamMode: ['values', 'messages', 'custom', 'updates'],
    onCustomEvent: (event: MilestoneEvent, { meta }: { meta?: { langgraph_node?: string } }) => {
      const stage = meta?.langgraph_node || event.stage;
      setMilestones((prev) => ({ ...prev, [stage]: [...(prev[stage] ?? []), event] }));
    },
  } as any);

  // fetch graph topology once
  useEffect(() => {
    (agentClient.assistants as any)
      .getGraph('narration')
      .then((g: any) => {
        const ns = (g.nodes ?? []).map((n: any) => ({ id: n.id, name: n.id }));
        if (ns.length) setNodes(ns);
      })
      .catch(() => {
        /* keep defaults */
      });
  }, []);

  // start the run once if thread is idle
  useEffect(() => {
    if (!started && !stream.isLoading && stream.values && Object.keys(stream.values).length === 0) {
      stream.submit({ project_id: projectId });
      setStarted(true);
    }
  }, [started, stream.isLoading, stream.values, projectId]);

  const values = stream.values ?? {};
  const currentStage = values.current_stage;
  const interrupt = stream.interrupts?.[0]?.value as
    | { script: string; review: any; available_actions: string[] }
    | undefined;

  return (
    <div className={styles.drawer}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={`material-symbols-outlined ${styles.icon}`}>account_tree</span>
          <strong>旁白工作流</strong>
          {stream.isLoading ? (
            <span className={styles.badge}>运行中</span>
          ) : (
            <span className={styles.badgeIdle}>完成</span>
          )}
        </div>
        <div className={styles.headerActions}>
          <button onClick={onCollapse} className={styles.iconBtn}>
            <span className="material-symbols-outlined">unfold_less</span>
          </button>
          <button onClick={onClose} className={styles.iconBtn}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <PipelineTimeline nodes={nodes} values={values} currentStage={currentStage} />

        {interrupt && (
          <ReviewPanel
            interrupt={interrupt}
            onRespond={(p) => stream.respond(p as any)}
          />
        )}

        {nodes.map((n) => {
          if (interrupt && n.id === 'script_review') return null; // shown as ReviewPanel
          const keys = NODE_STATE_KEYS[n.id] ?? [];
          const completed = keys.every((k) => (values as any)[k] != null);
          const status: 'completed' | 'running' | 'pending' = completed
            ? 'completed'
            : n.id === currentStage
              ? 'running'
              : 'pending';
          return (
            <StageCard
              key={n.id}
              nodeId={n.id}
              title={n.name}
              status={status}
              summary={summaryFor(n.id, values)}
              defaultOpen={status === 'running'}
              onFullscreen={() => setFullscreen(n.id)}
            >
              <div className={styles.stageDetail}>
                {n.id === 'gen_script' && values.narration_script && (
                  <pre className={styles.scriptPreview}>
                    {values.narration_script.slice(0, 300)}
                    {values.narration_script.length > 300 ? '...' : ''}
                  </pre>
                )}
                {n.id === 'split_segment' && values.structured_segments && (
                  <div>
                    {values.structured_segments.map((ch, i) => (
                      <div key={i} className={styles.chapterSummary}>
                        <strong>{ch.chapter_title}</strong> · {ch.segments.length} 段
                      </div>
                    ))}
                  </div>
                )}
                {n.id === 'synthesis' && values.synthesis_results && (
                  <div>
                    {milestones[n.id]
                      ?.filter((e) => e.type === 'progress')
                      .slice(-1)
                      .map((e, i) => (
                        <div key={i}>
                          进度: {String(e.data.completed)}/{String(e.data.total)}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </StageCard>
          );
        })}
      </div>

      {fullscreen && (
        <StageDetailModal
          title={`${fullscreen} · 完整内容`}
          onClose={() => setFullscreen(null)}
        >
          <div className={styles.fullscreenContent}>
            {fullscreen === 'gen_script' && values.narration_script && (
              <pre className={styles.fullScript}>{values.narration_script}</pre>
            )}
            {fullscreen === 'split_segment' && values.structured_segments?.map((ch, i) => (
              <div key={i} className={styles.fsChapter}>
                <strong>{ch.chapter_title}</strong>
                {ch.segments.map((seg, j) => (
                  <div key={j} className={styles.fsSegment}>
                    <span className={styles.fsEmotion}>{seg.emotion}</span>
                    {seg.text}
                  </div>
                ))}
              </div>
            ))}
            {fullscreen === 'script_review' && interrupt && (
              <ReviewPanel interrupt={interrupt} onRespond={(p) => { stream.respond(p as any); setFullscreen(null); }} />
            )}
          </div>
        </StageDetailModal>
      )}
    </div>
  );
}