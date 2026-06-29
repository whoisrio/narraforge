import { useState, useEffect, useRef } from 'react';
import { t } from '../../i18n';
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

  const getErrorMessage = (error: unknown, fallback = t('common.pleaseRetry')) => {
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
          alert(`${t('textInput.modeLLM')}失败，{t('textInput.modeRule')}也失败: ${getErrorMessage(error) || getErrorMessage(fallbackError)}`);
        }
      } else {
        console.error('Rule split failed:', error);
        alert(`${t('textInput.split')}失败: ${getErrorMessage(error)}`);
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
            {hasSegments && <span className={styles.segmentMeta}>{segmentCount} {t('common.segment')} · {text.length} {t('common.chars')}</span>}
            <button
              type="button"
              className={styles.smartSegmentBtn}
              onClick={(e) => { e.preventDefault(); handleSplit(); }}
              disabled={isSplitting || !text.trim()}
            >
              {isSplitting ? t('textInput.splitting') : t('textInput.smartSegment')}
            </button>
          </div>
        </summary>

        <div className={styles.expandedContent}>
          {isSourceStale && (
            <div className={styles.staleNotice}>
              <div>
                <strong>{t('textInput.staleTitle')}</strong>
                <span>{t('textInput.staleDesc')}</span>
              </div>
              <button className={styles.sourceBtn} onClick={useLibrarySourceText}>{t('textInput.useLibrary')}</button>
            </div>
          )}
          <div className={styles.textareaWrap}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              placeholder={t('textInput.placeholder')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={hasSegments ? 3 : 6}
            />
          </div>

          <div className={styles.actionBar}>
            {showVoiceModeSwitch && <div className={styles.voiceModeSwitch} aria-label={t('studio.voiceMode')}>
              <button className={`${styles.voiceModeBtn} ${splitVoiceMode === 'narration' ? styles.active : ''}`}
                onClick={() => setSplitVoiceMode('narration')}>{t('studio.narration')}</button>
              <button className={`${styles.voiceModeBtn} ${splitVoiceMode === 'dialogue' ? styles.active : ''}`}
                onClick={() => setSplitVoiceMode('dialogue')}>{t('studio.dialogue')}</button>
            </div>}

            <button className={styles.settingsToggle} onClick={() => setShowSettings(!showSettings)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              {showSettings ? t('textInput.settingsCollapse') : t('textInput.settings')}
            </button>

            <div className={styles.modeSwitch}>
              <button className={`${styles.modeBtn} ${mode === 'rule' ? styles.active : ''}`}
                onClick={() => onSplitConfigChange({ ...splitConfig, mode: 'rule' })}>{t('textInput.modeRule')}</button>
              <button className={`${styles.modeBtn} ${mode === 'llm' ? styles.active : ''}`}
                onClick={() => onSplitConfigChange({ ...splitConfig, mode: 'llm' })}>{t('textInput.modeLLM')}</button>
            </div>

            {hasMarkdown && (
              <button className={styles.stripMdBtn} onClick={handleStripMarkdown} title={t('textInput.stripMarkdownTitle')}>
                📝 {t('textInput.stripMarkdown')}
              </button>
            )}

            <button className={styles.splitBtn} onClick={handleSplit} disabled={isSplitting || !text.trim()}>
              {isSplitting ? t('textInput.splitting') : hasSegments ? t('textInput.reSplit') : t('textInput.split')}
            </button>
            <span className={styles.charCount}>{text.length} {t('common.chars')}</span>
          </div>

          {showSettings && (
            <div className={styles.settingsPanel}>
              <div className={styles.settingRow}>
                <span className={styles.settingLabel}>{t('segment.textInput.separator')}</span>
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
