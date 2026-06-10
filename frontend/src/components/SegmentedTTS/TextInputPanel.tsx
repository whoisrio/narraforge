import { useState, useEffect, useRef } from 'react';
import { textSplitApi } from '../../services/api';
import { stripMarkdownForTTS } from '../../utils/stripMarkdownForTTS';
import type { SegmentedProject } from '../../types';
import styles from './TextInputPanel.module.css';

interface TextInputPanelProps {
  splitConfig: SegmentedProject['split_config'];
  onSplitConfigChange: (config: SegmentedProject['split_config']) => void;
  onSplit: (texts: string[], originalText: string) => void;
  onLLMSplit: (text: string) => Promise<void>;
  /** 当前所有段落的文本（用于同步显示） */
  segmentTexts?: string[];
  /** 段落数量 */
  segmentCount?: number;
}

const DELIMITER_OPTIONS = ['，', '。', '！', '？', '；', '、'];

export function TextInputPanel({ splitConfig, onSplitConfigChange, onSplit, onLLMSplit, segmentTexts, segmentCount }: TextInputPanelProps) {
  const [text, setText] = useState('');
  const mode = splitConfig.mode;
  const [isSplitting, setIsSplitting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync text from segments when not editing
  useEffect(() => {
    if (!editing && segmentTexts && segmentTexts.length > 0) {
      setText(segmentTexts.join('\n'));
    }
  }, [segmentTexts, editing]);

  const hasSegments = (segmentCount ?? 0) > 0;

  const handleSplit = async () => {
    if (!text.trim()) return;
    setIsSplitting(true);
    try {
      if (mode === 'llm') {
        await onLLMSplit(text);
      } else {
        const segments = await textSplitApi.ruleSplit(text, splitConfig.delimiters);
        onSplit(segments, text);
      }
      setEditing(false);
    } catch (e: any) {
      if (mode === 'llm') {
        console.warn('LLM split failed, falling back to rule:', e);
        try {
          const segments = await textSplitApi.ruleSplit(text, splitConfig.delimiters);
          onSplit(segments, text);
          setEditing(false);
        } catch (e2) {
          alert('智能拆分失败，规则拆分也失败: ' + ((e as any)?.message || (e2 as any)?.message || '请重试'));
        }
      } else {
        console.error('Rule split failed:', e);
        alert('拆分失败: ' + ((e as any)?.response?.data?.detail || (e as any)?.message || '请重试'));
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

  const hasMarkdown = /[#*`\[\]|_~>]/.test(text) || /^\d+\.\s/m.test(text) || /^[-*+]\s/m.test(text);

  const handleStripMarkdown = () => {
    const cleaned = stripMarkdownForTTS(text);
    setText(cleaned);
  };

  // Collapsed summary bar (when segments exist and not editing)
  if (hasSegments && !editing) {
    const preview = text.replace(/\n/g, ' ').slice(0, 60);
    return (
      <div className={styles.summaryBar} onClick={() => { setEditing(true); setTimeout(() => textareaRef.current?.focus(), 50); }}>
        <div className={styles.summaryLeft}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.4 }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>
          </svg>
          <span className={styles.summaryText}>{preview}{text.length > 60 ? '...' : ''}</span>
        </div>
        <div className={styles.summaryRight}>
          <span className={styles.summaryMeta}>{segmentCount} 段 · {text.length} 字</span>
          <button className={styles.summaryEditBtn} onClick={(e) => { e.stopPropagation(); setEditing(true); setTimeout(() => textareaRef.current?.focus(), 50); }}>
            编辑
          </button>
        </div>
      </div>
    );
  }

  // Expanded: textarea + split controls
  return (
    <div className={styles.panel}>
      <div className={styles.textareaWrap}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          placeholder="粘贴整段文本，拆分为多个语音段落..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={hasSegments ? 3 : 4}
        />
        {hasSegments && (
          <button className={styles.collapseBtn} onClick={() => setEditing(false)} title="收起">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg>
          </button>
        )}
      </div>

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
            onClick={() => onSplitConfigChange({ ...splitConfig, mode: 'rule' })}>规则</button>
          <button className={`${styles.modeBtn} ${mode === 'llm' ? styles.active : ''}`}
            onClick={() => onSplitConfigChange({ ...splitConfig, mode: 'llm' })}>智能</button>
        </div>

        {hasMarkdown && (
          <button className={styles.stripMdBtn} onClick={handleStripMarkdown} title="清除 Markdown 格式，转为口语化纯文本">
            📝 清除格式
          </button>
        )}

        <button className={styles.splitBtn} onClick={handleSplit} disabled={isSplitting || !text.trim()}>
          {isSplitting ? '拆分中...' : hasSegments ? '重新拆分' : '拆分'}
        </button>
        <span className={styles.charCount}>{text.length} 字</span>
      </div>

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
