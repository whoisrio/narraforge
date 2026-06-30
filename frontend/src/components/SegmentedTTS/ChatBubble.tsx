import type { ReactNode } from 'react';
import type { EmotionType, Role, Segment } from '../../types';
import { useTranslation } from '../../i18n';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import { segEngine, segEffectiveParams } from '../../services/segmentShims';
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
  onUpdateRole?: (id: string, roleId: string | null) => void;
  onUpdateKind?: (id: string) => void;
  onTextSelection: (segmentId: string, start: number, end: number, text: string) => void;
}

const EMOTION_LABELS: Record<EmotionType, string> = {
  happy: 'segmentEdit.emotion.happy', sad: 'segmentEdit.emotion.sad', angry: 'segmentEdit.emotion.angry',
  calm: 'segmentEdit.emotion.calm', neutral: 'segmentEdit.emotion.neutral', excited: 'segmentEdit.emotion.excited',
};

function emotionClass(emotion?: EmotionType): string {
  const value = emotion ?? 'neutral';
  return styles[`emo${value.charAt(0).toUpperCase()}${value.slice(1)}`] || styles.emoNeutral;
}

function voiceLabel(segment: Segment, t: (key: string) => string): string {
  const eff = segEffectiveParams(segment);
  if (eff.edge_voice) return eff.edge_voice as string;
  if (eff.voice_id) return eff.voice_id as string;
  if (eff.mimo_preset_voice) return eff.mimo_preset_voice as string;
  return t('segment.chatBubble.noVoiceSelected');
}

function renderMarkedText(segment: Segment, t: (key: string) => string): ReactNode {
  // prosody_marks removed in V3 — render plain text
  return segment.text || t('segment.chatBubble.emptyLine');
}

export function ChatBubble({ segment, index, role, roles = [], isSelected, isPlaying, isStale, onSelect, onRegenerate, onPlay, onUpdateRole, onUpdateKind, onTextSelection }: ChatBubbleProps) {
  const { t } = useTranslation();
  const roleName = role?.name ?? t('segment.chatBubble.unnamedRole');
  const emotion = (segment.emotion ?? 'neutral') as EmotionType;
  return (
    <article
      className={`${styles.root} ${emotionClass(emotion)} ${isSelected ? styles.selected : ''}`}
      onClick={() => onSelect(segment.id)}
    >
      <VoiceAvatar name={roleName} size={36} gender="female" />
      <div className={styles.body}>
        <header className={styles.meta}>
          <span>{t('segment.chatBubble.lineNumber', { index: String(index).padStart(2, '0') })}</span>
          {onUpdateKind && (
            <button
              type="button"
              className={styles.kindSwitch}
              onClick={(event) => { event.stopPropagation(); onUpdateKind(segment.id); }}
            >
              {t('segment.chatBubble.switchToNarration')}
            </button>
          )}
          {onUpdateRole ? (
            <label className={styles.rolePicker} onClick={(event) => event.stopPropagation()}>
              <span>{t('segment.chatBubble.selectRole')}</span>
              <select
                aria-label={t('segment.chatBubble.selectRole')}
                value={segment.role_id ?? ''}
                onChange={(event) => {
                  const nextRole = roles.find(item => item.id === event.target.value);
                  onUpdateRole(segment.id, nextRole?.id ?? null);
                }}
              >
                <option value="">{t('segment.chatBubble.noVoiceSelected')}</option>
                {roles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          ) : (
            <span>{roleName}</span>
          )}
          <span>{segEngine(segment) === 'edge_tts' ? 'Edge-TTS' : segEngine(segment)} · {voiceLabel(segment, t)}</span>
          <span>{t(EMOTION_LABELS[emotion])}</span>
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
          {renderMarkedText(segment, t)}
        </p>
        <footer className={styles.footer}>
          <span>{t(EMOTION_LABELS[emotion])}</span>
          <span>{t('segment.chatBubble.prosodyMarks', { count: 0 })}</span>
          {isStale && <span className={styles.stale}>{t('segment.chatBubble.needRegenerate')}</span>}
          <button type="button" onClick={(event) => { event.stopPropagation(); onPlay(segment.id); }}>{isPlaying ? t('segment.chatBubble.playing') : t('segment.chatBubble.play')}</button>
          <button type="button" onClick={(event) => { event.stopPropagation(); onRegenerate(segment.id); }}>{t('segment.chatBubble.generate')}</button>
        </footer>
      </div>
    </article>
  );
}
