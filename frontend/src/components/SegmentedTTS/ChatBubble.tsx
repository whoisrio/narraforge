import type { EmotionType, Role, Segment } from '../../types';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import styles from './ChatBubble.module.css';

interface ChatBubbleProps {
  segment: Segment;
  index: number;
  role?: Role;
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: (id: string) => void;
  onRegenerate: (id: string) => void;
  onPlay: (id: string) => void;
}

const EMOTION_LABELS: Record<EmotionType, string> = {
  happy: '欣喜', sad: '沉重', angry: '愤怒', calm: '沉稳', neutral: '中性', excited: '激昂',
};

function emotionClass(emotion?: EmotionType): string {
  const value = emotion ?? 'neutral';
  return styles[`emo${value.charAt(0).toUpperCase()}${value.slice(1)}`] || styles.emoNeutral;
}

function voiceLabel(segment: Segment): string {
  const snapshot = segment.role_snapshot;
  if (snapshot?.default_voice) return snapshot.default_voice;
  if (segment.params.edge_voice) return segment.params.edge_voice;
  if (segment.params.voice_id) return segment.params.voice_id;
  if (segment.params.mimo_preset_voice) return segment.params.mimo_preset_voice;
  return '未选择音色';
}

export function ChatBubble({ segment, index, role, isSelected, isPlaying, onSelect, onRegenerate, onPlay }: ChatBubbleProps) {
  const roleName = role?.name ?? segment.role_snapshot?.name ?? '未命名角色';
  const emotion = (segment.emotion ?? 'neutral') as EmotionType;
  return (
    <article
      className={`${styles.root} ${emotionClass(emotion)} ${isSelected ? styles.selected : ''}`}
      onClick={() => onSelect(segment.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => { if (event.key === 'Enter') onSelect(segment.id); }}
    >
      <VoiceAvatar name={roleName} size={36} gender="female" />
      <div className={styles.body}>
        <header className={styles.meta}>
          <span>#{String(index).padStart(2, '0')} · {roleName}</span>
          <span>{segment.params.engine} · {voiceLabel(segment)}</span>
        </header>
        <p className={styles.text}>{segment.text || '空台词'}</p>
        <footer className={styles.footer}>
          <span>{EMOTION_LABELS[emotion]}</span>
          <span>{segment.prosody_marks?.length ?? 0} 个局部语气</span>
          <button type="button" onClick={(event) => { event.stopPropagation(); onPlay(segment.id); }}>{isPlaying ? '播放中' : '播放'}</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onRegenerate(segment.id); }}>生成</button>
        </footer>
      </div>
    </article>
  );
}
