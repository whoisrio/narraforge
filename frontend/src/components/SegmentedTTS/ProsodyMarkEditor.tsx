import { useState } from 'react';
import type { EmotionType, ProsodyMark } from '../../types';
import { useTranslation } from '../../i18n';
import styles from './ProsodyMarkEditor.module.css';

interface ProsodyMarkEditorProps {
  selection: { start: number; end: number; text: string } | null;
  onSave: (mark: ProsodyMark) => void;
  onCancel: () => void;
}

const STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'low_voice', label: 'segment.prosody.lowVoice' },
  { value: 'emphasis', label: 'segment.prosody.emphasis' },
  { value: 'pause', label: 'segment.prosody.pause' },
  { value: 'slow', label: 'segment.prosody.slow' },
  { value: 'fast', label: 'segment.prosody.fast' },
];

const EMOTIONS: { value: EmotionType; label: string }[] = [
  { value: 'neutral', label: 'segment.prosody.neutral' },
  { value: 'happy', label: 'segment.prosody.happy' },
  { value: 'sad', label: 'segment.prosody.sad' },
  { value: 'angry', label: 'segment.prosody.angry' },
  { value: 'calm', label: 'segment.prosody.calm' },
  { value: 'excited', label: 'segment.prosody.excited' },
];

export function ProsodyMarkEditor({ selection, onSave, onCancel }: ProsodyMarkEditorProps) {
  const { t } = useTranslation();
  const [emotion, setEmotion] = useState<EmotionType>('neutral');
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  const [intensity, setIntensity] = useState(0.5);

  if (!selection) return null;

  const toggleStyle = (value: string) => {
    setStyleTags(prev => (prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value]));
  };

  const save = () => {
    onSave({
      id: `mark-${Date.now()}`,
      start: selection.start,
      end: selection.end,
      emotion,
      style_tags: styleTags,
      instruction: instruction.trim() || undefined,
      intensity,
    });
  };

  return (
    <div className={styles.root}>
      <div className={styles.selection}>“{selection.text}”</div>
      <label>{t('segment.prosody.emotion')}
        <select value={emotion} onChange={event => setEmotion(event.target.value as EmotionType)}>
          {EMOTIONS.map(item => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
        </select>
      </label>
      <div className={styles.styles}>
        {STYLE_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={styleTags.includes(option.value)}
            onClick={() => toggleStyle(option.value)}
          >
            {t(option.label)}
          </button>
        ))}
      </div>
      <label>{t('segment.prosody.intensity')}
        <input type="range" min="0" max="1" step="0.1" value={intensity} onChange={event => setIntensity(Number(event.target.value))} />
      </label>
      <label>{t('segment.prosody.advancedInstruction')}
        <input value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={t('segment.prosody.placeholder')} />
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={save}>{t('segment.prosody.save')}</button>
        <button type="button" onClick={onCancel}>{t('segment.prosody.cancel')}</button>
      </div>
    </div>
  );
}
