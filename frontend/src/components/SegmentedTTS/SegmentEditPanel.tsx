import { useState, useEffect, useCallback, useRef } from 'react';
import type { Segment, SegmentEngineParams, EmotionType } from '../../types';
import { ttsApi } from '../../services/api';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
import type { VoiceProfile } from '../../types';
import styles from './SegmentEditPanel.module.css';

const EMOTION_LABELS: Record<EmotionType, string> = {
  happy: '欣喜', sad: '沉重', angry: '愤怒',
  calm: '沉稳', neutral: '中性', excited: '激昂',
};

interface SegmentEditPanelProps {
  segment: Segment | null;
  globalVoiceName?: string;
  onClose: () => void;
  onUpdateText: (id: string, text: string) => void;
  onUpdateSSML: (id: string, ssml: string) => void;
  onUpdateParams: (id: string, params: Partial<SegmentEngineParams>) => void;
  onUpdateOverrides?: (id: string, overrides: Segment['overrides']) => void;
  onUpdateEmotion?: (id: string, emotion: string) => void;
  onRegenerate: (id: string) => void;
  onAnnotateSSML: (id: string) => void;
}

const ALL_EMOTIONS: { key: string; label: string; color: string; bg: string }[] = [
  { key: 'happy', label: '欣喜', color: '#e8a838', bg: '#fef7e6' },
  { key: 'excited', label: '激昂', color: '#d46a2c', bg: '#fdf0e8' },
  { key: 'calm', label: '沉稳', color: '#7ba68a', bg: '#eef5f0' },
  { key: 'neutral', label: '中性', color: '#9e978e', bg: '#f5f4f0' },
  { key: 'sad', label: '沉重', color: '#6b8db5', bg: '#edf2f8' },
  { key: 'angry', label: '愤怒', color: '#c45a4a', bg: '#fceae7' },
];

export function SegmentEditPanel({
  segment, globalVoiceName, onClose, onUpdateText,
  onUpdateParams, onUpdateOverrides, onUpdateEmotion, onRegenerate, onAnnotateSSML,
}: SegmentEditPanelProps) {
  const [localText, setLocalText] = useState(segment?.text ?? '');
  const [showParams, setShowParams] = useState(false);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { refreshCounter } = useVoiceRefresh();

  useEffect(() => {
    if (segment) {
      setLocalText(segment.text);
      setShowParams(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [segment?.id]);

  useEffect(() => {
    ttsApi.getVoices().then(setVoices).catch(() => {});
  }, [refreshCounter]);

  const handleTextChange = useCallback((text: string) => {
    setLocalText(text);
    if (segment) onUpdateText(segment.id, text);
  }, [segment, onUpdateText]);

  if (!segment) return null;

  const emotion = segment.emotion || 'neutral';
  const emoCamel = emotion.charAt(0).toUpperCase() + emotion.slice(1);
  const isCosyVoice = segment.params.engine === 'cosyvoice';
  const hasOverrides = segment.overrides && segment.overrides.length > 0;

  // Build override summary text
  const overrideSummary: string[] = [];
  if (segment.overrides?.includes('voice')) {
    const v = voices.find(v => (v.qwen_voice_id || v.id) === segment.params.voice_id);
    overrideSummary.push(`音色: ${v?.description || v?.name || '自定义'}`);
  }
  if (segment.overrides?.includes('speed')) overrideSummary.push(`语速: ${(segment.params.speed ?? 1).toFixed(1)}×`);
  if (segment.overrides?.includes('pitch')) overrideSummary.push(`语调: ${(segment.params.pitch ?? 1).toFixed(1)}`);

  const handleParamChange = useCallback((field: string, value: any) => {
    if (!segment) return;
    const params: Partial<SegmentEngineParams> = {};
    if (field === 'speed') params.speed = value;
    else if (field === 'volume') params.volume = value;
    else if (field === 'pitch') params.pitch = value;
    else if (field === 'voice_id') params.voice_id = value;
    else if (field === 'language') params.language = value;
    else if (field === 'instruction') params.instruction = value;
    onUpdateParams(segment.id, params);

    // Track overrides
    const overrideField = field === 'voice_id' ? 'voice' : field as any;
    if (onUpdateOverrides && !segment.overrides?.includes(overrideField)) {
      onUpdateOverrides(segment.id, [...(segment.overrides || []), overrideField]);
    }
  }, [segment, onUpdateParams, onUpdateOverrides]);

  const handleResetOverride = useCallback((field: NonNullable<Segment['overrides']>[number]) => {
    if (!segment || !onUpdateOverrides) return;
    onUpdateOverrides(segment.id, (segment.overrides || []).filter(f => f !== field));
  }, [segment, onUpdateOverrides]);

  return (
    <div className={styles.panel}>
      <div className={styles.strip} />
      <div className={styles.body}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.title}>
            {segment.emotion && (
              <span className={`${styles.emotionTag} ${styles[`emotion${emoCamel}`]}`}>
                {EMOTION_LABELS[emotion]}
              </span>
            )}
            编辑 #{segment.id.slice(-3)}
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Text */}
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={localText}
          onChange={e => handleTextChange(e.target.value)}
        />

        {/* SSML shortcuts (CosyVoice only) */}
        {isCosyVoice && (
          <div className={styles.ssmlBar}>
            <button className={styles.ssmlBtn} onClick={() => onAnnotateSSML(segment.id)}>✨ 智能标注</button>
          </div>
        )}

        {/* Emotion picker */}
        <div className={styles.emotionPicker}>
          <span className={styles.emotionPickerLabel}>感情色彩</span>
          <div className={styles.emotionChips}>
            {ALL_EMOTIONS.map(e => (
              <button
                key={e.key}
                className={styles.emotionChip}
                style={{
                  background: emotion === e.key ? e.color : e.bg,
                  color: emotion === e.key ? '#fff' : e.color,
                  borderColor: emotion === e.key ? e.color : 'transparent',
                }}
                onClick={() => onUpdateEmotion?.(segment.id, e.key)}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>

        {/* Compact action bar */}
        <div className={styles.compactActions}>
          <div className={styles.compactSummary}>
            {hasOverrides ? (
              <>
                <span className={styles.dot} />
                <span>{overrideSummary.join(' · ')}</span>
              </>
            ) : (
              <span style={{ color: 'var(--color-text-muted)' }}>使用全局参数</span>
            )}
          </div>
          <button
            className={`${styles.expandBtn} ${showParams ? styles.expandBtnOpen : ''}`}
            onClick={() => setShowParams(!showParams)}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            参数覆盖
          </button>
          {segment.status === 'ready' && (
            <button className={styles.btnSecondary} onClick={() => onRegenerate(segment.id)}>
              撤销
            </button>
          )}
          <button className={styles.btnPrimary} onClick={() => onRegenerate(segment.id)}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ verticalAlign: '-1px', marginRight: 3 }}><polygon points="5 3 19 12 5 21 5 3"/></svg>
            重新生成
          </button>
        </div>

        {/* Params panel (collapsed by default) */}
        {showParams && (
          <div className={styles.paramsPanel}>
            <div className={styles.paramsTitle}>
              参数覆盖
              <span className={styles.paramsHint}>— 修改后此段不再跟随全局</span>
            </div>
            <div className={styles.paramsGrid}>
              {/* Voice */}
              <div className={styles.paramField}>
                <div className={styles.paramLabel}>
                  {segment.overrides?.includes('voice') && <span className={styles.overrideDot} />}
                  音色
                </div>
                <select
                  className={styles.paramSelect}
                  value={segment.params.voice_id || ''}
                  onChange={e => handleParamChange('voice_id', e.target.value)}
                >
                  <option value="">🌐 跟随全局 — {globalVoiceName || '全局音色'}</option>
                  {voices.map(v => {
                    const key = v.qwen_voice_id || v.id;
                    return <option key={v.id} value={key}>⭐ {v.description || v.name}</option>;
                  })}
                </select>
              </div>

              {/* Language */}
              <div className={styles.paramField}>
                <div className={styles.paramLabel}>语言</div>
                <select
                  className={styles.paramSelect}
                  value={segment.params.language || 'Chinese'}
                  onChange={e => handleParamChange('language', e.target.value)}
                >
                  <option value="Chinese">中文</option>
                  <option value="English">English</option>
                  <option value="Japanese">日本語</option>
                  <option value="Korean">한국어</option>
                </select>
              </div>

              {/* Speed */}
              <div className={styles.paramField}>
                <div className={styles.paramLabel}>
                  {segment.overrides?.includes('speed') && <span className={styles.overrideDot} />}
                  语速
                  {segment.overrides?.includes('speed') && (
                    <button className={styles.resetBtn} onClick={() => handleResetOverride('speed')}>重置</button>
                  )}
                </div>
                <div className={styles.sliderRow}>
                  <input type="range" min={0.5} max={2.0} step={0.1}
                    className={styles.range} value={segment.params.speed ?? 1.0}
                    onChange={e => handleParamChange('speed', parseFloat(e.target.value))} />
                  <span className={styles.sliderVal}>{(segment.params.speed ?? 1.0).toFixed(1)}×</span>
                </div>
              </div>

              {/* Volume */}
              <div className={styles.paramField}>
                <div className={styles.paramLabel}>
                  {segment.overrides?.includes('volume') && <span className={styles.overrideDot} />}
                  音量
                  {segment.overrides?.includes('volume') && (
                    <button className={styles.resetBtn} onClick={() => handleResetOverride('volume')}>重置</button>
                  )}
                </div>
                <div className={styles.sliderRow}>
                  <input type="range" min={0} max={100} step={1}
                    className={styles.range} value={segment.params.volume ?? 80}
                    onChange={e => handleParamChange('volume', parseInt(e.target.value))} />
                  <span className={styles.sliderVal}>{segment.params.volume ?? 80}</span>
                </div>
              </div>

              {/* Pitch */}
              <div className={styles.paramField}>
                <div className={styles.paramLabel}>
                  {segment.overrides?.includes('pitch') && <span className={styles.overrideDot} />}
                  语调
                  {segment.overrides?.includes('pitch') && (
                    <button className={styles.resetBtn} onClick={() => handleResetOverride('pitch')}>重置</button>
                  )}
                </div>
                <div className={styles.sliderRow}>
                  <input type="range" min={0.5} max={2.0} step={0.1}
                    className={styles.range} value={segment.params.pitch ?? 1.0}
                    onChange={e => handleParamChange('pitch', parseFloat(e.target.value))} />
                  <span className={styles.sliderVal}>{(segment.params.pitch ?? 1.0).toFixed(1)}</span>
                </div>
              </div>

              {/* Instruction */}
              <div className={styles.paramField}>
                <div className={styles.paramLabel}>
                  {segment.overrides?.includes('instruction') && <span className={styles.overrideDot} />}
                  复刻指令
                  {segment.overrides?.includes('instruction') && (
                    <button className={styles.resetBtn} onClick={() => handleResetOverride('instruction')}>重置</button>
                  )}
                </div>
                <input
                  className={styles.paramInput}
                  value={segment.params.instruction || ''}
                  placeholder="跟随全局指令..."
                  onChange={e => handleParamChange('instruction', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
