import { useState, useEffect, useRef } from 'react';
import { textSplitApi } from '../../services/api';
import { stripMarkdownForTTS } from '../../utils/stripMarkdownForTTS';
import type { Chapter } from '../../types';
import type { SplitVoiceMode } from '../../services/segmentKindInference';
import styles from './TextInputPanel.module.css';

interface TextInputPanelProps {
  splitConfig: Chapter['split_config'];
  onSplitConfigChange: (config: Chapter['split_config']) => void;
  onSplit: (texts: string[], originalText: string, voiceMode: SplitVoiceMode) => void;
  onLLMSplit: (text: string, voiceMode: SplitVoiceMode) => Promise<void>;
  sourceText?: string;
  segmentTexts?: string[];
  segmentCount?: number;
  chapterId?: string;
  chapterName?: string;
  splitVoiceMode?: SplitVoiceMode;
  onSplitVoiceModeChange?: (mode: SplitVoiceMode) => void;
  showVoiceModeSwitch?: boolean;
}

const DELIMITER_OPTIONS = ['，', '。', '！', '？', '；', '、'];

export function TextInputPanel({
  splitConfig,
  onSplitConfigChange,
  onSplit,
  onLLMSplit,
  sourceText,
  segmentTexts,
  segmentCount,
  chapterId,
  chapterName,
  splitVoiceMode: controlledSplitVoiceMode,
  onSplitVoiceModeChange,
  showVoiceModeSwitch = true,
}: TextInputPanelProps) {
  const [text, setText] = useState(sourceText ?? '');
  const mode = splitConfig.mode;
  const [isSplitting, setIsSplitting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [localSplitVoiceMode, setLocalSplitVoiceMode] = useState<SplitVoiceMode>('narration');
  const splitVoiceMode = controlledSplitVoiceMode ?? localSplitVoiceMode;
  const setSplitVoiceMode = (next: SplitVoiceMode) => {
    setLocalSplitVoiceMode(next);
    onSplitVoiceModeChange?.(next);
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasSegments = (segmentCount ?? 0) > 0;
  const [detailsOpen, setDetailsOpen] = useState(!hasSegments);

  const lastSourceKeyRef = useRef(`${chapterId ?? ''}\n${sourceText ?? ''}`);

  // Source Text is the Library chapter text. It should not be replaced by joined
  // segment text; existing segments only drive the stale warning below.
  useEffect(() => {
    const sourceKey = `${chapterId ?? ''}\n${sourceText ?? ''}`;
    if (lastSourceKeyRef.current !== sourceKey) {
      setText(sourceText ?? '');
      setDetailsOpen(!hasSegments);
      lastSourceKeyRef.current = sourceKey;
    }
  }, [chapterId, sourceText, hasSegments]);

  const normalizedSourceText = (sourceText ?? '').trim();
  const normalizedSegmentText = (segmentTexts ?? []).join('\n').trim();
  const isSourceStale = hasSegments && !!normalizedSourceText && normalizedSourceText !== normalizedSegmentText;

  const useLibrarySourceText = () => {
    setText(sourceText ?? '');
    setDetailsOpen(true);
    lastSourceKeyRef.current = `${chapterId ?? ''}\n${sourceText ?? ''}`;
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const getErrorMessage = (error: unknown, fallback = '请重试') => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null) {
      const response = (error as { response?: { data?: { detail?: unknown } } }).response;
      if (typeof response?.data?.detail === 'string') return response.data.detail;
    }
    return fallback;
  };

  const handleSplit = async () => {
    if (!text.trim()) return;
    setIsSplitting(true);
    try {
      if (mode === 'llm') {
        await onLLMSplit(text, splitVoiceMode);
      } else {
        const segments = await textSplitApi.ruleSplit(text, splitConfig.delimiters);
        onSplit(segments, text, splitVoiceMode);
      }
      setDetailsOpen(false);
    } catch (error: unknown) {
      if (mode === 'llm') {
        console.warn('LLM split failed, falling back to rule:', error);
        try {
          const segments = await textSplitApi.ruleSplit(text, splitConfig.delimiters);
          onSplit(segments, text, splitVoiceMode);
          setDetailsOpen(false);
        } catch (fallbackError: unknown) {
          alert(`智能拆分失败，规则拆分也失败: ${getErrorMessage(error) || getErrorMessage(fallbackError)}`);
        }
      } else {
        console.error('Rule split failed:', error);
        alert(`拆分失败: ${getErrorMessage(error)}`);
      }
    } finally {
      setIsSplitting(false);
    }
  };

  const toggleDelimiter = (d: string) => {
    const next = splitConfig.delimiters.includes(d)
      ? splitConfig.delimiters.filter((x: string) => x !== d)
      : [...splitConfig.delimiters, d];
    onSplitConfigChange({ ...splitConfig, delimiters: next });
  };

  const hasMarkdown = /[#*`[\]|_~>]/.test(text) || /^\d+\.\s/m.test(text) || /^[-*+]\s/m.test(text);

  const handleStripMarkdown = () => {
    const cleaned = stripMarkdownForTTS(text);
    setText(cleaned);
  };

  return (
    <div className={styles.detailsRoot}>
      <details open={detailsOpen} onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}>
        <summary className={styles.summaryContent}>
          <div className={styles.summaryLeft}>
            <span className={styles.sourceTextBadge}>SOURCE TEXT</span>
            {chapterName && <span className={styles.chapterLabel}>{chapterName}</span>}
          </div>
          <div className={styles.summaryRight}>
            {hasSegments && <span className={styles.segmentMeta}>{segmentCount} 段 · {text.length} 字</span>}
            <button
              type="button"
              className={styles.smartSegmentBtn}
              onClick={(e) => { e.preventDefault(); handleSplit(); }}
              disabled={isSplitting || !text.trim()}
            >
              {isSplitting ? '拆分中...' : 'SMART SEGMENT'}
            </button>
          </div>
        </summary>

        <div className={styles.expandedContent}>
          {isSourceStale && (
            <div className={styles.staleNotice}>
              <div>
                <strong>文本库已更新，建议重新拆分</strong>
                <span>不会自动覆盖已有段落与音频；确认后可用章节全文生成新的拆分草稿。</span>
              </div>
              <button className={styles.sourceBtn} onClick={useLibrarySourceText}>使用文本库全文</button>
            </div>
          )}
          <div className={styles.textareaWrap}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              placeholder="粘贴整段文本，拆分为多个语音段落..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={hasSegments ? 3 : 6}
            />
          </div>

          <div className={styles.actionBar}>
            {showVoiceModeSwitch && <div className={styles.voiceModeSwitch} aria-label="配音模式">
              <button className={`${styles.voiceModeBtn} ${splitVoiceMode === 'narration' ? styles.active : ''}`}
                onClick={() => setSplitVoiceMode('narration')}>旁白为主</button>
              <button className={`${styles.voiceModeBtn} ${splitVoiceMode === 'dialogue' ? styles.active : ''}`}
                onClick={() => setSplitVoiceMode('dialogue')}>对话/剧本</button>
              <button className={`${styles.voiceModeBtn} ${splitVoiceMode === 'mixed' ? styles.active : ''}`}
                onClick={() => setSplitVoiceMode('mixed')}>混合模式</button>
            </div>}

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
      </details>
    </div>
  );
}
