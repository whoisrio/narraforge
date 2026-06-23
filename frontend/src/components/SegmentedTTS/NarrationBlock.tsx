import type { ReactNode } from 'react';
import type { EmotionType, Segment } from '../../types';
import styles from './NarrationBlock.module.css';

interface NarrationBlockProps {
  segment: Segment;
  index: number;
  isSelected: boolean;
  hasNarratorVoice: boolean;
  onSelect: (id: string) => void;
  onTextSelection: (segmentId: string, start: number, end: number, text: string) => void;
}

function emotionClass(emotion?: EmotionType): string {
  const value = emotion ?? 'neutral';
  return styles[`emo${value.charAt(0).toUpperCase()}${value.slice(1)}`] || styles.emoNeutral;
}

function renderMarkedText(segment: Segment): ReactNode {
  const text = segment.text || '空旁白';
  const marks = [...(segment.prosody_marks ?? [])].sort((a, b) => a.start - b.start);
  if (marks.length === 0) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start > cursor) parts.push(<span key={`plain-${cursor}`}>{text.slice(cursor, mark.start)}</span>);
    parts.push(<mark key={mark.id} className={styles.prosodyMark}>{text.slice(mark.start, mark.end)}</mark>);
    cursor = Math.max(cursor, mark.end);
  }
  if (cursor < text.length) parts.push(<span key={`plain-${cursor}`}>{text.slice(cursor)}</span>);
  return parts;
}

export function NarrationBlock({ segment, index, isSelected, hasNarratorVoice, onSelect, onTextSelection }: NarrationBlockProps) {
  return (
    <article
      className={`${styles.root} ${emotionClass(segment.emotion)} ${isSelected ? styles.selected : ''}`}
      onClick={() => onSelect(segment.id)}
    >
      <div className={styles.label}>旁白 #{String(index).padStart(2, '0')}</div>
      {!hasNarratorVoice && <div className={styles.warning}>需要设置旁白音色</div>}
      <p
        onMouseUp={(event) => {
          const selection = window.getSelection();
          const selected = selection?.toString() ?? '';
          if (!selection || selected.length === 0) return;
          const start = segment.text.indexOf(selected);
          if (start < 0) return;
          event.stopPropagation();
          onTextSelection(segment.id, start, start + selected.length, selected);
        }}
      >
        {renderMarkedText(segment)}
      </p>
    </article>
  );
}
