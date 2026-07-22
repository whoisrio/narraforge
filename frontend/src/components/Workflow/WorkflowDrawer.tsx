import { useEffect, useRef, useState } from 'react';
import { useStream } from '@langchain/langgraph-sdk/react';
import { agentClient } from '../../services/langgraph/client';
import { NODE_STATE_KEYS } from '../../services/langgraph/contracts';
import type { MilestoneEvent, ReviewResult, WorkflowState } from '../../services/langgraph/types';
import {
  bucketMessagesByNode,
  mergeStageLLMData,
  totalWorkflowUsage,
  type StreamMessageLike,
} from '../../services/langgraph/llmStreams';
import { PipelineTimeline } from './PipelineTimeline';
import { StageCard } from './StageCard';
import { StageLLMPane } from './StageLLMPane';
import { ReviewPanel } from './ReviewPanel';
import { ConfirmPanel } from './ConfirmPanel';
import { EngineSelectPanel } from './EngineSelectPanel';
import type { ConfirmOverwriteInterrupt, SelectEngineInterrupt } from '../../services/langgraph/types';
import { pickForkCheckpoint, type HistoryCheckpoint } from '../../services/langgraph/fork';
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
  const startedRef = useRef(false);

  const stream = useStream<WorkflowState, { CustomEventType: MilestoneEvent }>({
    apiUrl: typeof window !== 'undefined' ? `http://${window.location.hostname}:2024` : 'http://127.0.0.1:2024',
    assistantId,
    threadId,
    // SDK 回调参数是 { namespace, mutate }，不含节点名；分桶统一用事件自带 stage。
    onCustomEvent: (event) => {
      const stage = event.stage;
      setMilestones((prev) => ({ ...prev, [stage]: [...(prev[stage] ?? []), event] }));
    },
  });

  // fetch graph topology once
  // SDK Client 类型未暴露 getGraph，局部收窄到所需形状。
  useEffect(() => {
    (agentClient.assistants as unknown as {
      getGraph: (assistantId: string) => Promise<{ nodes?: { id: string }[] }>;
    })
      .getGraph(assistantId)
      .then((g) => {
        // 过滤 __start__/__end__ 伪节点，只渲染业务阶段卡片
        const ns = (g.nodes ?? [])
          .map((n) => ({ id: n.id, name: n.id }))
          .filter((n) => !n.id.startsWith('__'));
        if (ns.length) setNodes(ns);
      })
      .catch(() => {
        /* keep defaults */
      });
  }, [assistantId]);

  // start the run once (ref 守卫避免 setState 触发级联渲染)。
  // 必须等线程状态加载完再判断，按线程当前状态分三种接管方式：
  // - 已有 interrupt（等待人工）或历史状态：只展示，不重启；
  // - 别处启动的运行中 run（如上一会话/其他客户端）：joinStream 接管实时流；
  // - 全新线程：submit 启动新 run。
  // 否则重开 drawer 会向同一线程重复提交新 run，或接管时收不到实时事件。
  useEffect(() => {
    if (startedRef.current || stream.isThreadLoading) return;
    if (stream.isLoading) {
      startedRef.current = true; // 自己的 run 正在流式
      return;
    }
    startedRef.current = true;
    void (async () => {
      // 先查 active run：运行中的线程可能同时带历史 interrupt（resume 后
      // 检查点尚未推进）和历史 values，所以 running 判断必须最先做。
      // 别处启动的运行中 run（如上一会话/其他客户端）用 joinStream 接管实时流。
      // 整体 try/catch：查询/join 失败时降级为「只展示」，绝不让 effect 抛 unhandled rejection。
      try {
        const running = await agentClient.runs
          .list(threadId, { status: 'running', limit: 1 })
          .catch(() => []);
        if (running.length > 0) {
          await stream.joinStream(running[0].run_id, undefined, {
            streamMode: ['values', 'messages', 'custom', 'updates'],
          });
          return;
        }
      } catch {
        // fall through to display-only / fresh-submit logic below
      }
      // 等待人工审批或已完成：只展示，不重启
      if ((stream.interrupts?.length ?? 0) > 0) return;
      if (Object.keys(stream.values ?? {}).length > 0) return;
      stream.submit(
        { project_id: projectId },
        { streamMode: ['values', 'messages', 'custom', 'updates'] },
      );
    })();
  }, [stream, threadId, projectId]);

  // messages 通道：SDK 按 message id 聚合 token chunks，这里按 langgraph_node 分桶，
  // 再与 custom 事件（llm_call/stage_complete 的 data.usage）合并成每阶段 LLM 视图模型。
  // 计算量小，直接内联（项目启用 React Compiler，手写 useMemo 反而干扰编译）。
  const messages = (stream.messages ?? []) as unknown as StreamMessageLike[];
  const llmBuckets = bucketMessagesByNode(messages, (message, index) => {
    // 单元测试的 useStream mock 没有 getMessagesMetadata，运行时必有。
    const meta = stream.getMessagesMetadata?.(message as never, index)?.streamMetadata;
    return typeof meta?.langgraph_node === 'string' ? meta.langgraph_node : undefined;
  });
  const llmByStage = mergeStageLLMData(llmBuckets, milestones, stream.values?.stage_usage);

  const values = stream.values ?? {};
  const currentStage = values.current_stage;
  const interrupt = stream.interrupts?.[0]?.value as
    | ({ script: string; review: ReviewResult; available_actions: string[] } & Partial<ConfirmOverwriteInterrupt> & Partial<SelectEngineInterrupt>)
    | undefined;
  const isConfirmInterrupt = interrupt?.kind === 'confirm_overwrite';
  const isSelectEngineInterrupt = interrupt?.kind === 'select_tts_engine';
  // 与 PipelineTimeline 同一判定：所有业务节点的完成态 state key 都就绪才算完成，
  // 避免接管历史线程时徽标误报「完成」。
  const allDone =
    nodes.length > 0 &&
    nodes.every((n) =>
      (NODE_STATE_KEYS[n.id] ?? []).every(
        (k) => (values as Record<string, unknown>)[k] != null,
      ),
    );
  const hasValues = Object.keys(values).length > 0;
  // 工作流已完成后，历史 interrupt 不再有效——避免 synthesis 全做完还呈现审批面板。
  const activeInterrupt = allDone ? undefined : interrupt;
  // workflow 全局 token 汇总（各阶段 stage_complete 权威值，流式中降级实时值）
  const workflowUsage = totalWorkflowUsage(llmByStage);
  // useStream (sdk 1.9.x) has no `respond`; interrupts resume via submit + command.resume
  const respond = (payload: unknown) =>
    stream.submit(null, { command: { resume: payload } });

  // 指定节点重跑（fork）：确认后从该节点首次完成的 checkpoint 恢复执行。
  const handleFork = async (nodeId: string) => {
    if (!window.confirm(`从「${nodeId}」节点重跑？该节点及之后的进度将被覆盖。`)) return;
    try {
      const history = await agentClient.threads.getHistory(threadId, { limit: 100 });
      const checkpointId = pickForkCheckpoint(history as unknown as HistoryCheckpoint[], nodeId);
      if (!checkpointId) {
        alert(`无法从「${nodeId}」重跑：未找到该节点执行前的历史检查点。`);
        return;
      }
      // SDK SubmitOptions 用 checkpoint（非 checkpointId）；checkpoint_ns 空串为默认命名空间。
      // checkpoint_map 不能传 null（服务端 schema 校验失败），给空对象占位。
      stream.submit(null, {
        checkpoint: { checkpoint_ns: '', checkpoint_id: checkpointId, checkpoint_map: {} },
      });
    } catch {
      // 历史查询失败时静默放弃，不影响当前展示
    }
  };

  return (
    <div className={styles.drawer}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={`material-symbols-outlined ${styles.icon}`}>account_tree</span>
          <strong>旁白工作流</strong>
          {stream.isLoading ? (
            <span className={styles.badge}>
              <span className={styles.badgeDot} />
              运行中
            </span>
          ) : activeInterrupt ? (
            <span className={styles.badgeIdle}>待审批</span>
          ) : values.error ? (
            <span className={styles.badgeIdle}>已失败</span>
          ) : allDone ? (
            <span className={styles.badgeIdle}>完成</span>
          ) : hasValues ? (
            <span className={styles.badgeIdle}>未完成</span>
          ) : null}
          {workflowUsage && (
            <span
              className={styles.globalTokens}
              title={`输入 ${workflowUsage.input_tokens.toLocaleString('en-US')} · 输出 ${workflowUsage.output_tokens.toLocaleString('en-US')}` +
                (workflowUsage.reasoning_tokens
                  ? `（含思考 ${workflowUsage.reasoning_tokens.toLocaleString('en-US')}）`
                  : '')}
            >
              <span className={`material-symbols-outlined ${styles.globalTokensIcon}`}>toll</span>
              ↑{workflowUsage.input_tokens.toLocaleString('en-US')}
              ↓{workflowUsage.output_tokens.toLocaleString('en-US')}
              <strong>Σ{(workflowUsage.total_tokens ?? workflowUsage.input_tokens + workflowUsage.output_tokens).toLocaleString('en-US')}</strong>
            </span>
          )}
        </div>
        <div className={styles.headerActions}>
          <button onClick={onCollapse} className={styles.iconBtn} aria-label="收起">
            <span className="material-symbols-outlined">unfold_less</span>
          </button>
          <button onClick={onClose} className={styles.iconBtn} aria-label="关闭">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <PipelineTimeline nodes={nodes} values={values} currentStage={currentStage} />

        {activeInterrupt && isConfirmInterrupt && (
          <ConfirmPanel
            interrupt={activeInterrupt as ConfirmOverwriteInterrupt}
            onRespond={(p) => respond(p)}
          />
        )}

        {activeInterrupt && isSelectEngineInterrupt && (
          <EngineSelectPanel
            interrupt={activeInterrupt as SelectEngineInterrupt}
            onRespond={(p) => respond(p)}
          />
        )}

        {activeInterrupt && !isConfirmInterrupt && !isSelectEngineInterrupt && (
          <ReviewPanel
            interrupt={activeInterrupt}
            onRespond={(p) => respond(p)}
          />
        )}

        {nodes.map((n) => {
          if (activeInterrupt && (n.id === 'script_review' || n.id === 'quality_review' || n.id === 'preflight_check' || (isSelectEngineInterrupt && n.id === 'synthesis'))) return null;
          const keys = NODE_STATE_KEYS[n.id] ?? [];
          const completed = keys.every((k) => values[k as keyof WorkflowState] != null);
          const status: 'completed' | 'running' | 'pending' = completed
            ? 'completed'
            : n.id === currentStage
              ? 'running'
              : 'pending';
          const llm = llmByStage[n.id];
          return (
            <StageCard
              key={n.id}
              nodeId={n.id}
              title={n.name}
              status={status}
              summary={summaryFor(n.id, values)}
              llmPhase={llm?.phase}
              tokenUsage={llm?.usage ?? llm?.liveUsage}
              defaultOpen={status === 'running'}
              onFullscreen={() => setFullscreen(n.id)}
              onFork={status === 'completed' ? () => void handleFork(n.id) : undefined}
            >
              <div className={styles.stageDetail}>
                {llm && (
                  <StageLLMPane
                    phase={llm.phase}
                    text={llm.text}
                    reasoning={llm.reasoning}
                  />
                )}
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
                    <span className={`${styles.fsEmotion} ${styles[`fsEmotion${seg.emotion.charAt(0).toUpperCase() + seg.emotion.slice(1)}`] || ''}`}>{seg.emotion}</span>
                    {seg.text}
                  </div>
                ))}
              </div>
            ))}
            {fullscreen === 'script_review' && activeInterrupt && (
              <ReviewPanel interrupt={activeInterrupt} onRespond={(p) => { respond(p); setFullscreen(null); }} />
            )}
          </div>
        </StageDetailModal>
      )}
    </div>
  );
}
