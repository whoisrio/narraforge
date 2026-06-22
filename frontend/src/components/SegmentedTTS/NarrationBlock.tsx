import type { EmotionType, Segment } from '../../types';
import styles from './NarrationBlock.module.css';

interface NarrationBlockProps {
  segment: Segment;
  index: number;
  isSelected: boolean;
  hasNarratorVoice: boolean;
  onSelect: (id: string) => void;
}

function emotionClass(emotion?: EmotionType): string {
  const value = emotion ?? 'neutral';
  return styles[`emo${value.charAt(0).toUpperCase()}${value.slice(1)}`] || styles.emoNeutral;
}

export function NarrationBlock({ segment, index, isSelected, hasNarratorVoice, onSelect }: NarrationBlockProps) {
  return (
    <article
      className={`${styles.root} ${emotionClass(segment.emotion)} ${isSelected ? styles.selected : ''}`}
      onClick={() => onSelect(segment.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => { if (event.key === 'Enter') onSelect(segment.id); }}
    >
      <div className={styles.label}>旁白 #{String(index).padStart(2, '0')}</div>
      {!hasNarratorVoice && <div className={styles.warning}>需要设置旁白音色</div>}
      <p>{segment.text || '空旁白'}</p>
    </article>
  );
}
