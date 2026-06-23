import type { ReactNode } from 'react';
import type { EmotionType, Role, RoleSnapshot, Segment } from '../../types';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import styles from './ChatBubble.module.css';

interface ChatBubbleProps {
  segment: Segment;
  index: number;
  role?: Role;
  roles?: Role[];
  isSelected: boolean;
  isPlaying: boolean;
  isStale?: boolean;
  onSelect: (id: string) => void;
  onRegenerate: (id: string) => void;
  onPlay: (id: string) => void;
  onUpdateRole?: (id: string, roleId: string | null, roleSnapshot: RoleSnapshot | null) => void;
  onUpdateKind?: (id: string) => void;
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

function toSnapshot(role: Role): RoleSnapshot {
  return {
    id: role.id,
    name: role.name,
    avatar: role.avatar,
    description: role.description,
    default_engine: role.default_engine,
    default_voice: role.default_voice,
    default_engine_params: { ...role.default_engine_params },
    favorite_styles: [...role.favorite_styles],
  };
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

export function ChatBubble({ segment, index, role, roles = [], isSelected, isPlaying, isStale, onSelect, onRegenerate, onPlay, onUpdateRole, onUpdateKind, onTextSelection }: ChatBubbleProps) {
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
          {onUpdateKind && (
            <button
              type="button"
              className={styles.kindSwitch}
              onClick={(event) => { event.stopPropagation(); onUpdateKind(segment.id); }}
            >
              改为旁白
            </button>
          )}
          {onUpdateRole ? (
            <label className={styles.rolePicker} onClick={(event) => event.stopPropagation()}>
              <span>选择角色</span>
              <select
                aria-label="选择角色"
                value={segment.role_id ?? ''}
                onChange={(event) => {
                  const nextRole = roles.find(item => item.id === event.target.value);
                  onUpdateRole(segment.id, nextRole?.id ?? null, nextRole ? toSnapshot(nextRole) : null);
                }}
              >
                <option value="">未选择</option>
                {roles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          ) : (
            <span>{roleName}</span>
          )}
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
