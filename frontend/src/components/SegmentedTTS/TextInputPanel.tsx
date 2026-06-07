import { useState } from 'react';
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
  const [showSettings, setShowSettings] = useState(false);

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
          alert('智能拆分失败，规则拆分也失败: ' + (e?.message || e2?.message || '请重试'));
        }
      } else {
        console.error('Rule split failed:', e);
        alert('拆分失败: ' + (e?.response?.data?.detail || e?.message || '请重试'));
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
        placeholder="粘贴整段文本，拆分为多个语音段落..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
      />

      {/* Action bar */}
      <div className={styles.actionBar}>
        <button className={styles.settingsToggle} onClick={() => setShowSettings(!showSettings)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          {showSettings ? '收起设置' : '拆分设置'}
        </button>

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

      {/* Collapsible settings */}
      {showSettings && (
        <div className={styles.settingsPanel}>
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>分隔符</span>
            <div className={styles.delimiters}>
              {DELIMITER_OPTIONS.map(d => (
                <label key={d} className={`${styles.delimChip} ${splitConfig.delimiters.includes(d) ? styles.delimActive : ''}`}>
                  <input type="checkbox" checked={splitConfig.delimiters.includes(d)}
                    onChange={() => toggleDelimiter(d)} hidden />
                  {d}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
