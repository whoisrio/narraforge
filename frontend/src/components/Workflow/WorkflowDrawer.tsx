import { useEffect, useState } from 'react';
import { useStream } from '@langchain/langgraph-sdk/react';
import { agentClient } from '../../services/langgraph/client';
import { NODE_STATE_KEYS } from '../../services/langgraph/contracts';
import type { MilestoneEvent, WorkflowState } from '../../services/langgraph/types';
import { PipelineTimeline } from './PipelineTimeline';
import { StageCard } from './StageCard';
import { ReviewPanel } from './ReviewPanel';
import { ConfirmPanel } from './ConfirmPanel';
import type { ConfirmOverwriteInterrupt } from '../../services/langgraph/types';
import { StageDetailModal } from './StageDetailModal';
import styles from './WorkflowDrawer.module.css';

interface Props {
  threadId: string;
  projectId: string;
  assistantId?: string;
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

function summaryFor(nodeId: string, values: Partial<WorkflowState>): string | undefined {
  switch (nodeId) {
    case 'gen_script':
    case 'gen_narration':
      if (values.narration_script) return `${values.script_chapters?.length ?? 0} 章 · ${values.narration_script.length} 字`;
      return undefined;
    case 'script_review':
      if (values.review_feedback) return `评分 ${values.review_feedback.overall_score}/5`;
      return undefined;
    case 'quality_review':
      if (values.review_result) return values.review_result.passed ? '审查通过' : `审查发现 ${values.review_result.issues.length} 个问题`;
      return undefined;
    case 'split_segment':
    case 'split_chapters':
      if (values.structured_segments) {
        const total = values.structured_segments.reduce((s: number, c) => s + c.segments.length, 0);
        return `${values.structured_segments.length} 章 · ${total} 段`;
      }
      return undefined;
    case 'synthesis':
      if (values.synthesis_results) return `${values.synthesis_results.length} 段`;
      return undefined;
    case 'scaffold_remotion':
      if (values.remotion_project_dir) return values.remotion_project_dir;
      return undefined;
    case 'gen_animation_brief':
      if (values.animation_brief) return `${values.animation_brief.chapters.length} 章 brief`;
      return undefined;
  }
  return undefined;
}

export function WorkflowDrawer({ threadId, projectId, assistantId = 'narration', onClose, onCollapse }: Props) {
  const [nodes, setNodes] = useState<GraphNode[]>(DEFAULT_NODES);
  const [milestones, setMilestones] = useState<Record<string, MilestoneEvent[]>>({});
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const stream = useStream<WorkflowState>({
    apiUrl: typeof window !== 'undefined' ? `http://${window.location.hostname}:2024` : 'http://127.0.0.1:2024',
    assistantId,
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
      .getGraph(assistantId)
      .then((g: any) => {
        const ns = (g.nodes ?? []).map((n: any) => ({ id: n.id, name: n.id }));
        if (ns.length) setNodes(ns);
      })
      .catch(() => {
        /* keep defaults */
      });
  }, [assistantId]);

  // start the run once
  useEffect(() => {
    if (!started && !stream.isLoading) {
      stream.submit({ project_id: projectId });
      setStarted(true);
    }
  }, [started, stream.isLoading, threadId, projectId]);

  const values = stream.values ?? {};
  const currentStage = values.current_stage;
  const interrupt = stream.interrupts?.[0]?.value as
    | ({ script: string; review: any; available_actions: string[] } & Partial<ConfirmOverwriteInterrupt>)
    | undefined;
  const isConfirmInterrupt = interrupt?.kind === 'confirm_overwrite';
  // useStream (sdk 1.9.x) has no `respond`; interrupts resume via submit + command.resume
  const respond = (payload: unknown) =>
    stream.submit(null, { command: { resume: payload } } as any);

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

        {interrupt && isConfirmInterrupt && (
          <ConfirmPanel
            interrupt={interrupt as ConfirmOverwriteInterrupt}
            onRespond={(p) => respond(p)}
          />
        )}

        {interrupt && !isConfirmInterrupt && (
          <ReviewPanel
            interrupt={interrupt}
            onRespond={(p) => respond(p)}
          />
        )}

        {nodes.map((n) => {
          if (interrupt && (n.id === 'script_review' || n.id === 'quality_review' || n.id === 'preflight_check')) return null;
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
                {(n.id === 'gen_script' || n.id === 'gen_narration') && values.narration_script && (
                  <pre className={styles.scriptPreview}>
                    {values.narration_script.slice(0, 300)}
                    {values.narration_script.length > 300 ? '...' : ''}
                  </pre>
                )}
                {(n.id === 'split_segment' || n.id === 'split_chapters') && values.structured_segments && (
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
            {(fullscreen === 'gen_script' || fullscreen === 'gen_narration') && values.narration_script && (
              <pre className={styles.fullScript}>{values.narration_script}</pre>
            )}
            {(fullscreen === 'split_segment' || fullscreen === 'split_chapters') && values.structured_segments?.map((ch, i) => (
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
              <ReviewPanel interrupt={interrupt} onRespond={(p) => { respond(p); setFullscreen(null); }} />
            )}
          </div>
        </StageDetailModal>
      )}
    </div>
  );
}