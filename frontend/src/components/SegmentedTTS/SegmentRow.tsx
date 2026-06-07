import { useCallback } from 'react';
import type { Segment } from '../../types';
import { useCountUp } from '../../hooks/useCountUp';
import styles from './SegmentRow.module.css';

interface SegmentRowProps {
  segment: Segment;
  isSelected: boolean;
  layout: 'vertical' | 'horizontal';
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onInsertAfter: (afterId: string) => void;
  onEdit: (id: string) => void;
  onRegenerate: (id: string) => void;
  onUndo: (id: string) => void;
  onAnnotateSSML?: (id: string) => void;
}

const ENGINE_LABELS: Record<string, string> = {
  cosyvoice: 'CosyVoice',
  edge_tts: 'Edge-TTS',
  mimo_tts: 'MiMo',
};

export function SegmentRow({
  segment, isSelected, layout, onSelect, onDelete,
  onInsertAfter, onEdit, onRegenerate, onUndo, onAnnotateSSML,
}: SegmentRowProps) {
  const animValue = useCountUp(segment.duration_sec ?? 0, 400, segment.status === 'ready' && segment.duration_sec !== undefined);
  const displayDuration = segment.status === 'ready'
    ? animValue.toFixed(1) + 's'
    : segment.status === 'pending'
      ? '⏳'
      : '—';

  const hasUndo = !!(segment.previous_audio_id && segment.status === 'ready');
  const isGenerating = segment.status === 'pending' || segment.status === 'queued';
  const isLong = segment.text.length > 100;

  const statusClass = styles[`status_${segment.status}`] || '';

  if (layout === 'horizontal') {
    return (
      <div
        className={`${styles.horizontalBlock} ${statusClass} ${isSelected ? styles.selected : ''}`}
        onClick={() => onSelect(segment.id)}
        title={segment.text}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect(segment.id); }}
      >
        <span className={styles.horizIndex}>#{segment.id.slice(-3)}</span>
        <span className={styles.horizDuration}>{displayDuration}</span>
        <span className={styles.horizText}>{segment.text.slice(0, 8)}{segment.text.length > 8 ? '…' : ''}</span>
      </div>
    );
  }

  return (
    <div
      className={`${styles.row} ${statusClass} ${isSelected ? styles.selected : ''}`}
      onClick={() => onSelect(segment.id)}
      role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(segment.id); }}
    >
      <div className={styles.rowMain}>
        <span className={styles.index}>#{segment.id.slice(-3)}</span>
        <span className={styles.text}>
          {segment.text}
          {isLong && <span className={styles.longWarning} title="单段过长，建议拆分">⚠</span>}
        </span>
        <span className={styles.duration}>{displayDuration}</span>
      </div>
      <div className={styles.rowMeta}>
        <span className={styles.metaInfo}>
          {segment.status === 'ready' ? '已生成' : segment.status === 'failed' ? '失败' : '未生成'}
          {' · '}{ENGINE_LABELS[segment.params.engine] || segment.params.engine}
          {segment.ssml && (segment.ssml_annotated_by_llm ? ' · SSML✨' : ' · SSML')}
        </span>
        <div className={styles.actions}>
          <button className={styles.btn} disabled={!segment.current_audio_id}
            onClick={(e) => { e.stopPropagation(); /* play handled by parent */ }} title="播放">▶</button>
          <button className={styles.btn}
            onClick={(e) => { e.stopPropagation(); onEdit(segment.id); }} title="编辑">✎</button>
          {hasUndo && <button className={styles.btn}
            onClick={(e) => { e.stopPropagation(); onUndo(segment.id); }} title="撤回">↻</button>}
          <button className={styles.btn} disabled={isGenerating}
            title={isGenerating ? '生成中无法删除' : '删除'}
            onClick={(e) => { e.stopPropagation(); onDelete(segment.id); }}>✕</button>
          <select
            className={styles.menuSelect}
            value=""
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              if (e.target.value === 'annotate' && onAnnotateSSML) onAnnotateSSML(segment.id);
              if (e.target.value === 'duplicate') {
                // Placeholder for future
              }
              e.currentTarget.value = '';
            }}
          >
            <option value="">⋮</option>
            {segment.params.engine === 'cosyvoice' && <option value="annotate">✨ 智能标注 SSML</option>}
            <option value="duplicate">复制段</option>
          </select>
        </div>
      </div>
      <div className={styles.insertZone} onClick={(e) => { e.stopPropagation(); onInsertAfter(segment.id); }}>
        + 在此处插入新段
      </div>
    </div>
  );
}
