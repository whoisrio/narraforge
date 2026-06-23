import type { ReactNode } from 'react';
import type { EmotionType, Role, Segment } from '../../types';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import styles from './ChatBubble.module.css';

interface ChatBubbleProps {
  segment: Segment;
  index: number;
  role?: Role;
  isSelected: boolean;
  isPlaying: boolean;
  isStale?: boolean;
  onSelect: (id: string) => void;
  onRegenerate: (id: string) => void;
  onPlay: (id: string) => void;
  onTextSelection: (segmentId: string, start: number, end: number, text: string) => void;
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

function renderMarkedText(segment: Segment): ReactNode {
  const text = segment.text || '空台词';
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

export function ChatBubble({ segment, index, role, isSelected, isPlaying, isStale, onSelect, onRegenerate, onPlay, onTextSelection }: ChatBubbleProps) {
  const roleName = role?.name ?? segment.role_snapshot?.name ?? '未命名角色';
  const emotion = (segment.emotion ?? 'neutral') as EmotionType;
  return (
    <article
      className={`${styles.root} ${emotionClass(emotion)} ${isSelected ? styles.selected : ''}`}
      onClick={() => onSelect(segment.id)}
    >
      <VoiceAvatar name={roleName} size={36} gender="female" />
      <div className={styles.body}>
        <header className={styles.meta}>
          <span>台词 #{String(index).padStart(2, '0')}</span>
          <span>{roleName}</span>
          <span>{segment.params.engine === 'edge_tts' ? 'Edge-TTS' : segment.params.engine} · {voiceLabel(segment)}</span>
          <span>{emotion}</span>
        </header>
        <p
          className={styles.text}
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
        <footer className={styles.footer}>
          <span>{EMOTION_LABELS[emotion]}</span>
          <span>{segment.prosody_marks?.length ?? 0} 个局部语气</span>
          {isStale && <span className={styles.stale}>需重新生成</span>}
          <button type="button" onClick={(event) => { event.stopPropagation(); onPlay(segment.id); }}>{isPlaying ? '播放中' : '播放'}</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onRegenerate(segment.id); }}>生成</button>
        </footer>
      </div>
    </article>
  );
}
