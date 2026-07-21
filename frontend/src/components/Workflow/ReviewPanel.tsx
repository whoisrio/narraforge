import { useState } from 'react';
import type { ReviewResult } from '../../services/langgraph/types';
import styles from './ReviewPanel.module.css';

interface InterruptPayload {
  script: string;
  review: ReviewResult;
  available_actions: string[];
}

interface Props {
  interrupt: InterruptPayload;
  onRespond: (payload: { action: 'approve' | 'reject'; [k: string]: unknown }) => void;
}

const STATUS_ICON: Record<string, string> = {
  pass: 'check_circle',
  warn: 'warning',
  fail: 'cancel',
};

const STATUS_COLOR: Record<string, string> = {
  pass: 'var(--color-success)',
  warn: 'var(--color-warning)',
  fail: 'var(--color-error)',
};

export function ReviewPanel({ interrupt, onRespond }: Props) {
  const { script, review } = interrupt;
  const [editedScript, setEditedScript] = useState(script);
  const [comment, setComment] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState('');

  const approve = () =>
    onRespond({ action: 'approve', edited_script: editedScript, comment });
  const doReject = () => {
    if (feedback.trim()) onRespond({ action: 'reject', feedback });
  };

  return (
    <div className={styles.root}>
      <div className={styles.scoreRow}>
        <span className={styles.stars}>
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className="material-symbols-outlined"
              style={{
                color: i < review.overall_score ? 'var(--color-primary)' : 'var(--color-text-disabled)',
                fontVariationSettings: i < review.overall_score ? "'FILL' 1" : "'FILL' 0",
              }}
            >
              star
            </span>
          ))}
        </span>
        <strong>{review.overall_score}/5</strong>
        <span className={styles.comment}>{review.overall_comment}</span>
      </div>

      {review.has_critical_issue && (
        <div className={styles.critical}>
          <span className="material-symbols-outlined">error</span>
          内容忠实度存在严重问题，务必修正后再通过
        </div>
      )}

      <div className={styles.dimensions}>
        {review.dimensions.map((d, i) => (
          <div
            key={i}
            className={styles.dimension}
            style={{ borderLeftColor: STATUS_COLOR[d.status] }}
          >
            <span
              className="material-symbols-outlined"
              style={{
                color: STATUS_COLOR[d.status],
                fontVariationSettings: "'FILL' 1",
              }}
            >
              {STATUS_ICON[d.status]}
            </span>
            <div>
              <div className={styles.dimName}>{d.name}</div>
              <div className={styles.dimComment}>{d.comment}</div>
              {d.suggestion && (
                <div className={styles.dimSuggestion}>
                  <span className="material-symbols-outlined">arrow_forward</span>
                  {d.suggestion}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>
          旁白脚本（可编辑）
          <span className={styles.stats}>{editedScript.length} 字</span>
        </div>
        <textarea
          className={styles.scriptEditor}
          value={editedScript}
          onChange={(e) => setEditedScript(e.target.value)}
        />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>导演备注（可选）</div>
        <textarea
          className={styles.noteEditor}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="导演备注..."
        />
      </div>

      {rejecting && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>拒绝反馈（必填）</div>
          <textarea
            className={styles.noteEditor}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="描述需要改进的地方..."
          />
        </div>
      )}

      <div className={styles.actions}>
        {rejecting ? (
          <>
            <button className={styles.rejectBtn} onClick={doReject} disabled={!feedback.trim()}>
              <span className="material-symbols-outlined">close</span>确认拒绝
            </button>
            <button className={styles.ghostBtn} onClick={() => setRejecting(false)}>
              取消
            </button>
          </>
        ) : (
          <>
            <button className={styles.rejectBtn} onClick={() => setRejecting(true)}>
              <span className="material-symbols-outlined">close</span>拒绝并反馈
            </button>
            <button className={styles.primaryBtn} onClick={approve}>
              <span className="material-symbols-outlined">check</span>批准
            </button>
          </>
        )}
      </div>
    </div>
  );
}