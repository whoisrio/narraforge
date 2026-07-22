import ReactMarkdown from 'react-markdown';
import type { LLMPhase } from '../../services/langgraph/llmStreams';
import styles from './StageLLMPane.module.css';

const PHASE_LABEL: Record<LLMPhase, string> = {
  idle: '待调用',
  streaming: '生成中',
  done: '已完成',
};

interface Props {
  phase: LLMPhase;
  /** 实时流式文本（messages 通道聚合）。 */
  text: string;
  /** 思考过程（reasoning_content，thinking 模式模型才有）。 */
  reasoning?: string;
}

export function StageLLMPane({ phase, text, reasoning }: Props) {
  if (phase === 'idle' && !text && !reasoning) return null;

  return (
    <section className={styles.pane} data-phase={phase} aria-label="LLM 输出">
      <div className={styles.head}>
        <span className={`material-symbols-outlined ${styles.headIcon}`}>neurology</span>
        <span className={styles.headTitle}>LLM 输出</span>
        <span className={styles.phase} data-phase={phase}>
          {phase === 'streaming' && <span className={styles.pulseDot} />}
          {PHASE_LABEL[phase]}
        </span>
      </div>

      {reasoning ? (
        <details className={styles.thinking} open={phase === 'streaming'}>
          <summary className={styles.thinkingSummary}>
            <span className={`material-symbols-outlined ${styles.thinkingIcon}`}>psychology</span>
            思考过程
            {phase === 'streaming' && <span className={styles.caret}>▍</span>}
          </summary>
          <div className={styles.thinkingBody}>{reasoning}</div>
        </details>
      ) : (
        phase === 'streaming' && !text && (
          <div className={styles.stream}>
            <span className={styles.placeholder}>模型思考中…</span>
            <span className={styles.caret}>▍</span>
          </div>
        )
      )}

      {text ? (
        phase === 'done' ? (
          <div className={styles.markdown}>
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        ) : (
          <div className={styles.stream}>
            {text}
            {phase === 'streaming' && <span className={styles.caret}>▍</span>}
          </div>
        )
      ) : null}
    </section>
  );
}
