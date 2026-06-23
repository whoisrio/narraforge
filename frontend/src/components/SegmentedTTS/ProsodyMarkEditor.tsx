import { useState } from 'react';
import type { EmotionType, ProsodyMark } from '../../types';
import styles from './ProsodyMarkEditor.module.css';

interface ProsodyMarkEditorProps {
  selection: { start: number; end: number; text: string } | null;
  onSave: (mark: ProsodyMark) => void;
  onCancel: () => void;
}

const STYLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'low_voice', label: '低声' },
  { value: 'emphasis', label: '重读' },
  { value: 'pause', label: '停顿' },
  { value: 'slow', label: '放慢' },
  { value: 'fast', label: '加快' },
];

const EMOTIONS: { value: EmotionType; label: string }[] = [
  { value: 'neutral', label: '中性' },
  { value: 'happy', label: '开心' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '愤怒' },
  { value: 'calm', label: '平静' },
  { value: 'excited', label: '兴奋' },
];

export function ProsodyMarkEditor({ selection, onSave, onCancel }: ProsodyMarkEditorProps) {
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
      <label>情绪
        <select value={emotion} onChange={event => setEmotion(event.target.value as EmotionType)}>
          {EMOTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
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
            {option.label}
          </button>
        ))}
      </div>
      <label>强度
        <input type="range" min="0" max="1" step="0.1" value={intensity} onChange={event => setIntensity(Number(event.target.value))} />
      </label>
      <label>高级指令
        <input value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="例如：压低声音，带一点犹豫" />
      </label>
      <div className={styles.actions}>
        <button type="button" onClick={save}>保存标注</button>
        <button type="button" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
