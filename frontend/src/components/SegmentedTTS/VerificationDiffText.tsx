/**
 * 基准/回读两行的 diff 高亮（核对详情弹层与核对报告共用）。
 * delete 标在基准行，insert 标在回读行，replace 两行都标。
 */
import type { VerificationDiffOp } from '../../types';
import styles from './VerificationDetailModal.module.css';

export function VerificationDiffText({ ops, side }: { ops: VerificationDiffOp[]; side: 'baseline' | 'asr' }) {
  return (
    <>
      {ops.map((op, i) => {
        const text = side === 'baseline' ? op.baseline : op.asr;
        const marked = op.op !== 'equal' && (op.op !== 'delete' || side === 'baseline') && (op.op !== 'insert' || side === 'asr');
        if (!text) return null;
        return marked
          ? <mark key={i} className={styles[`mark_${op.op}`] ?? styles.markReplace}>{text}</mark>
          : <span key={i}>{text}</span>;
      })}
    </>
  );
}
