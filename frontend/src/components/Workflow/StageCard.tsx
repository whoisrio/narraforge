import { useState, type ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import type { LLMPhase } from '../../services/langgraph/llmStreams';
import type { TokenUsage } from '../../services/langgraph/types';
import styles from './StageCard.module.css';

const STATUS_ICON: Record<string, string> = {
  completed: 'check_circle',
  running: 'progress_activity',
  pending: 'circle',
};

interface Props {
  nodeId: string;
  title: string;
  status: 'completed' | 'running' | 'pending';
  summary?: string;
  /** LLM 活动阶段（有 LLM 调用的节点才传）。 */
  llmPhase?: LLMPhase;
  /** token 统计（stage_complete 汇总优先，流式中为实时值）。 */
  tokenUsage?: TokenUsage;
  defaultOpen?: boolean;
  onFullscreen?: () => void;
  /** 从此节点重跑（fork）。仅 completed 节点传入。 */
  onFork?: () => void;
  children?: ReactNode;
}

export function StageCard({
  nodeId,
  title,
  status,
  summary,
  llmPhase,
  tokenUsage,
  defaultOpen = false,
  onFullscreen,
  onFork,
  children,
}: Props) {
  const { t } = useTranslation();
  const llmPillLabel: Partial<Record<LLMPhase, string>> = {
    streaming: t('workflow.stageCard.streaming'),
    done: t('workflow.stageCard.done'),
  };
  const [open, setOpen] = useState(defaultOpen || status === 'running');
  // 阶段开始运行时自动展开，保证 LLM 实时流可见；render 期间调整 state 是
  // React 官方认可的 derive-from-props 模式（避免 effect 级联渲染）。
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === 'running') setOpen(true);
  }

  const llmLabel = llmPhase ? llmPillLabel[llmPhase] : undefined;
  const tokenTitle = tokenUsage
    ? t('workflow.stageCard.inputOutput', { input: tokenUsage.input_tokens.toLocaleString('en-US'), output: tokenUsage.output_tokens.toLocaleString('en-US') }) +
      (tokenUsage.reasoning_tokens
        ? t('workflow.stageCard.thinkingTokens', { count: tokenUsage.reasoning_tokens.toLocaleString('en-US') })
        : '') +
      t('workflow.stageCard.totalTokens', { count: (tokenUsage.total_tokens ?? tokenUsage.input_tokens + tokenUsage.output_tokens).toLocaleString('en-US') })
    : undefined;

  return (
    <div className={styles.card} data-status={status} data-node={nodeId}>
      <button className={styles.header} onClick={() => setOpen((o) => !o)}>
        <span className={`material-symbols-outlined ${styles.statusIcon}`}>
          {STATUS_ICON[status]}
        </span>
        <span className={styles.title}>{title}</span>
        {llmLabel && (
          <span className={styles.llmPill} data-phase={llmPhase}>
            <span className={`material-symbols-outlined ${styles.llmPillIcon}`}>neurology</span>
            {llmLabel}
          </span>
        )}
        <span className={styles.headerMeta}>
          {summary && <span className={styles.summary}>{summary}</span>}
          {tokenUsage && (
            <span className={styles.tokenBadge} title={tokenTitle} aria-label={tokenTitle}>
              <span>↑{tokenUsage.input_tokens.toLocaleString('en-US')}</span>
              <span>↓{tokenUsage.output_tokens.toLocaleString('en-US')}</span>
              <span className={styles.tokenTotal}>
                Σ{(tokenUsage.total_tokens ?? tokenUsage.input_tokens + tokenUsage.output_tokens).toLocaleString('en-US')}
              </span>
            </span>
          )}
        </span>
        <span className={`material-symbols-outlined ${styles.caret}`}>
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>
      {open && children && (
        <div className={styles.body}>
          {onFork && (
            <button
              className={styles.forkBtn}
              onClick={onFork}
              aria-label="从此重跑"
              title="从此重跑"
            >
              <span className="material-symbols-outlined">replay</span>
            </button>
          )}
          {onFullscreen && (
            <button
              className={styles.fullscreenBtn}
              onClick={onFullscreen}
              aria-label="全屏查看"
              title="全屏查看"
            >
              <span className="material-symbols-outlined">fullscreen</span>
            </button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
