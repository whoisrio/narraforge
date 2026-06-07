import { useState, useRef } from 'react';
import { textSplitApi } from '../../services/api';
import type { SegmentedProject } from '../../types';
import styles from './TextInputPanel.module.css';

interface TextInputPanelProps {
  splitConfig: SegmentedProject['split_config'];
  onSplitConfigChange: (config: SegmentedProject['split_config']) => void;
  onSplit: (texts: string[]) => void;
  onLLMSplit: (text: string) => Promise<void>;
}

const DELIMITER_OPTIONS = ['，', '。', '！', '？', '；', '、'];

export function TextInputPanel({ splitConfig, onSplitConfigChange, onSplit, onLLMSplit }: TextInputPanelProps) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'rule' | 'llm'>(splitConfig.mode);
  const [isSplitting, setIsSplitting] = useState(false);

  const handleSplit = async () => {
    if (!text.trim()) return;
    setIsSplitting(true);
    try {
      if (mode === 'llm') {
        await onLLMSplit(text);
      } else {
        const segments = await textSplitApi.ruleSplit(text, splitConfig.delimiters);
        onSplit(segments);
      }
    } catch (e: any) {
      if (mode === 'llm') {
        console.warn('LLM split failed, falling back to rule:', e);
        try {
          const segments = await textSplitApi.ruleSplit(text, splitConfig.delimiters);
          onSplit(segments);
        } catch (e2) {
          alert('拆分失败，请重试');
        }
      } else {
        alert('拆分失败，请重试');
      }
    } finally {
      setIsSplitting(false);
    }
  };

  const toggleDelimiter = (d: string) => {
    const next = splitConfig.delimiters.includes(d)
      ? splitConfig.delimiters.filter(x => x !== d)
      : [...splitConfig.delimiters, d];
    onSplitConfigChange({ ...splitConfig, delimiters: next });
  };

  return (
    <div className={styles.panel}>
      <textarea
        className={styles.textarea}
        placeholder="输入要拆分的文字..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
      />
      <div className={styles.controls}>
        <div className={styles.delimiters}>
          {DELIMITER_OPTIONS.map(d => (
            <label key={d} className={styles.checkLabel}>
              <input type="checkbox" checked={splitConfig.delimiters.includes(d)}
                onChange={() => toggleDelimiter(d)} />
              {d}
            </label>
          ))}
        </div>
        <div className={styles.modeSwitch}>
          <button className={`${styles.modeBtn} ${mode === 'rule' ? styles.active : ''}`}
            onClick={() => setMode('rule')}>规则</button>
          <button className={`${styles.modeBtn} ${mode === 'llm' ? styles.active : ''}`}
            onClick={() => setMode('llm')}>智能</button>
        </div>
        <button className={styles.splitBtn} onClick={handleSplit} disabled={isSplitting || !text.trim()}>
          {isSplitting ? '拆分中...' : '拆分'}
        </button>
        <span className={styles.charCount}>{text.length} 字</span>
      </div>
    </div>
  );
}
