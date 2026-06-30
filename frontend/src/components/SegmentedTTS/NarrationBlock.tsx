import type { ReactNode } from 'react';
import type { EmotionType, Segment, SegmentKind } from '../../types';
import styles from './NarrationBlock.module.css';

interface NarrationBlockProps {
  segment: Segment;
  index: number;
  isSelected: boolean;
  hasNarratorVoice: boolean;
  onSelect: (id: string) => void;
  onUpdateKind?: (id: string, kind: SegmentKind) => void;
  onTextSelection: (segmentId: string, start: number, end: number, text: string) => void;
}

function emotionClass(emotion?: EmotionType): string {
  const value = emotion ?? 'neutral';
  return styles[`emo${value.charAt(0).toUpperCase()}${value.slice(1)}`] || styles.emoNeutral;
}

function renderMarkedText(segment: Segment): ReactNode {
  // prosody_marks removed in V3 — render plain text
  return segment.text || '空旁白';
}

export function NarrationBlock({ segment, index, isSelected, hasNarratorVoice, onSelect, onUpdateKind, onTextSelection }: NarrationBlockProps) {
  return (
    <article
      className={`${styles.root} ${emotionClass(segment.emotion)} ${isSelected ? styles.selected : ''}`}
      onClick={() => onSelect(segment.id)}
    >
      <div className={styles.label}>旁白 #{String(index).padStart(2, '0')}</div>
      {onUpdateKind && (
        <button
          type="button"
          className={styles.kindSwitch}
          onClick={(event) => { event.stopPropagation(); onUpdateKind(segment.id, 'dialogue'); }}
        >
          改为台词
        </button>
      )}
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
