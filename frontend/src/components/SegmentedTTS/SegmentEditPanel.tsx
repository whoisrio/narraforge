import { useState, useEffect, useCallback, useRef } from 'react';
import type { Segment, SegmentEngineParams, EmotionType, VoiceProfile } from '../../types';
import { ttsApi } from '../../services/api';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
import { StyleInstructionPicker } from '../TTSSynthesis/StyleInstructionPicker';
import styles from './SegmentEditPanel.module.css';

type SegmentOverride = NonNullable<Segment['overrides']>[number];
type SegmentParamField = keyof SegmentEngineParams;
type SegmentParamValue = SegmentEngineParams[SegmentParamField];

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
  onSplit?: (id: string, position: number) => void;
}

const ALL_EMOTIONS: { key: string; label: string; color: string; bg: string }[] = [
  { key: 'happy', label: '欣喜', color: '#e8a838', bg: '#fef7e6' },
  { key: 'excited', label: '激昂', color: '#d46a2c', bg: '#fdf0e8' },
  { key: 'calm', label: '沉稳', color: '#7ba68a', bg: '#eef5f0' },
  { key: 'neutral', label: '中性', color: '#9e978e', bg: '#f5f4f0' },
  { key: 'sad', label: '沉重', color: '#6b8db5', bg: '#edf2f8' },
  { key: 'angry', label: '愤怒', color: '#c45a4a', bg: '#fceae7' },
];

const MIMO_PRESET_VOICES = ['冰糖', '星辰', '雪梨', '琥珀', '青云', '紫霞'];

export function SegmentEditPanel({
  segment, globalVoiceName, onClose, onUpdateText,
  onUpdateParams, onUpdateOverrides, onUpdateEmotion, onRegenerate, onAnnotateSSML, onSplit,
}: SegmentEditPanelProps) {
  const [localText, setLocalText] = useState(segment?.text ?? '');
  const [showParams, setShowParams] = useState(false);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [edgeVoices, setEdgeVoices] = useState<{ short_name: string; display_name: string; gender: string }[]>([]);
  const [edgeLang] = useState('Chinese');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { refreshCounter } = useVoiceRefresh();

  useEffect(() => {
    if (segment) {
      setLocalText(segment.text);
      setShowParams(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [segment?.id]);

  // Sync localText when the segment's text changes externally (e.g., after split)
  useEffect(() => {
    if (segment && segment.text !== localText) {
      setLocalText(segment.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment?.text]);

  // Load voices
  useEffect(() => {
    ttsApi.getVoices().then(setVoices).catch(() => {});
  }, [refreshCounter]);

  // Load Edge-TTS voices when engine is edge_tts
  useEffect(() => {
    if (segment?.params.engine === 'edge_tts' || showParams) {
      ttsApi.getEdgeVoices(edgeLang).then(setEdgeVoices).catch(() => {});
    }
  }, [edgeLang, segment?.params.engine, showParams]);

  const handleTextChange = useCallback((text: string) => {
    setLocalText(text);
    if (segment) onUpdateText(segment.id, text);
  }, [segment, onUpdateText]);

  const handleParamChange = useCallback((field: SegmentParamField, value: SegmentParamValue) => {
    if (!segment) return;
    const params: Partial<SegmentEngineParams> = {};
    if (field === 'engine') {
      params.engine = value as SegmentEngineParams['engine'];
      // Reset voice when switching engine
      if (value === 'edge_tts') { params.edge_voice = ''; }
      else if (value === 'mimo_tts') { params.mimo_preset_voice = '冰糖'; }
      else if (value === 'voxcpm') { params.voxcpm_mode = 'tts'; }
      else { params.voice_id = ''; }
    }
    else if (field === 'speed') params.speed = value as number;
    else if (field === 'volume') params.volume = value as number;
    else if (field === 'pitch') params.pitch = value as number;
    else if (field === 'voice_id') params.voice_id = value as string;
    else if (field === 'edge_voice') params.edge_voice = value as string;
    else if (field === 'mimo_preset_voice') params.mimo_preset_voice = value as string;
    else if (field === 'mimo_clone_voice_id') params.mimo_clone_voice_id = value as string;
    else if (field === 'mimo_instruction') params.mimo_instruction = value as string;
    else if (field === 'voxcpm_style_control') params.voxcpm_style_control = value as string;
    else if (field === 'language') params.language = value as string;
    else if (field === 'instruction') params.instruction = value as string;
    onUpdateParams(segment.id, params);

    // Track overrides (skip engine switch)
    if (field !== 'engine') {
      const overrideField: SegmentOverride = field === 'voice_id' || field === 'edge_voice' || field === 'mimo_preset_voice' || field === 'mimo_clone_voice_id'
        ? 'voice'
        : (field === 'mimo_instruction' || field === 'voxcpm_style_control' ? 'instruction' : field as SegmentOverride);
      if (onUpdateOverrides && !segment.overrides?.includes(overrideField)) {
        onUpdateOverrides(segment.id, [...(segment.overrides || []), overrideField]);
      }
    }
  }, [segment, onUpdateParams, onUpdateOverrides]);

  const handleResetOverride = useCallback((field: SegmentOverride) => {
    if (!segment || !onUpdateOverrides) return;
    onUpdateOverrides(segment.id, (segment.overrides || []).filter(f => f !== field));
  }, [segment, onUpdateOverrides]);

  if (!segment) return null;

  const emotion = segment.emotion || 'neutral';
  const emoCamel = emotion.charAt(0).toUpperCase() + emotion.slice(1);
  const isCosyVoice = segment.params.engine === 'cosyvoice';
  const isEdgeTTS = segment.params.engine === 'edge_tts';
  const isMiMo = segment.params.engine === 'mimo_tts';
  const isVoxCPM = segment.params.engine === 'voxcpm';
  const hasOverrides = segment.overrides && segment.overrides.length > 0;

  // Build override summary
  const overrideSummary: string[] = [];
  if (segment.overrides?.includes('voice')) {
    if (isEdgeTTS) {
      overrideSummary.push(`音色: ${segment.params.edge_voice || '自定义'}`);
    } else if (isMiMo) {
      overrideSummary.push(`音色: ${segment.params.mimo_preset_voice || '自定义'}`);
    } else if (isVoxCPM) {
      const v = voices.find(v => v.id === segment.params.voice_id);
      overrideSummary.push(`音色: ${v?.description || v?.name || '自定义'}`);
    } else {
      const v = voices.find(v => (v.qwen_voice_id || v.id) === segment.params.voice_id);
      overrideSummary.push(`音色: ${v?.description || v?.name || '自定义'}`);
    }
  }
  if (segment.overrides?.includes('speed')) overrideSummary.push(`语速: ${(segment.params.speed ?? 1).toFixed(1)}×`);
  if (segment.overrides?.includes('pitch')) overrideSummary.push(`语调: ${(segment.params.pitch ?? 1).toFixed(1)}`);

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
        <textarea ref={textareaRef} className={styles.textarea} value={localText}
          onChange={e => handleTextChange(e.target.value)} />

        {/* Split at cursor */}
        {onSplit && localText.length > 1 && (
          <div className={styles.splitBar}>
            <button className={styles.splitBtn} onClick={() => {
              const pos = textareaRef.current?.selectionStart ?? localText.length;
              if (pos > 0 && pos < localText.length) {
                onSplit(segment.id, pos);
              }
            }}>
              ✂ 在光标处拆分
            </button>
          </div>
        )}

        {/* SSML (CosyVoice only) */}
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
              <button key={e.key} className={styles.emotionChip}
                style={{ background: emotion === e.key ? e.color : e.bg, color: emotion === e.key ? '#fff' : e.color, borderColor: emotion === e.key ? e.color : 'transparent' }}
                onClick={() => onUpdateEmotion?.(segment.id, e.key)}>
                {e.label}
              </button>
            ))}
          </div>
        </div>

        {/* Compact action bar */}
        <div className={styles.compactActions}>
          <div className={styles.compactSummary}>
            {hasOverrides ? (
              <><span className={styles.dot} /><span>{overrideSummary.join(' · ')}</span></>
            ) : (
              <span style={{ color: 'var(--color-text-muted)' }}>使用全局参数</span>
            )}
          </div>
          <button className={`${styles.expandBtn} ${showParams ? styles.expandBtnOpen : ''}`}
            onClick={() => setShowParams(!showParams)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            参数覆盖
          </button>
          {segment.status === 'ready' && (
            <button className={styles.btnSecondary} onClick={() => onRegenerate(segment.id)}>撤销</button>
          )}
          <button className={styles.btnPrimary} onClick={() => onRegenerate(segment.id)}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ verticalAlign: '-1px', marginRight: 3 }}><polygon points="5 3 19 12 5 21 5 3"/></svg>
            重新生成
          </button>
        </div>

        {/* Params panel (collapsed) */}
        {showParams && (
          <div className={styles.paramsPanel}>
            <div className={styles.paramsTitle}>
              参数覆盖
              <span className={styles.paramsHint}>— 修改后此段不再跟随全局</span>
            </div>

            {/* Engine selector — full width */}
            <div className={styles.engineRow}>
              <span className={styles.paramLabel}>模型</span>
              <div className={styles.enginePills}>
                {(['cosyvoice', 'edge_tts', 'mimo_tts', 'voxcpm'] as const).map(eng => (
                  <button key={eng} className={`${styles.enginePill} ${segment.params.engine === eng ? styles.enginePillActive : ''}`}
                    onClick={() => handleParamChange('engine', eng)}>
                    {eng === 'cosyvoice' ? 'CosyVoice' : eng === 'edge_tts' ? 'Edge-TTS' : eng === 'mimo_tts' ? 'MiMo' : 'VoxCPM'}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.paramsGrid}>
              {/* Voice — per engine */}
              <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                <div className={styles.paramLabel}>
                  {segment.overrides?.includes('voice') && <span className={styles.overrideDot} />}
                  音色
                </div>

                {isCosyVoice && (
                  <select className={styles.paramSelect} value={segment.params.voice_id || ''}
                    onChange={e => handleParamChange('voice_id', e.target.value)}>
                    <option value="">🌐 跟随全局 — {globalVoiceName || '全局音色'}</option>
                    {voices.map(v => {
                      const key = v.qwen_voice_id || v.id;
                      return <option key={v.id} value={key}>⭐ {v.description || v.name}</option>;
                    })}
                  </select>
                )}

                {isEdgeTTS && (
                  <select className={styles.paramSelect} value={segment.params.edge_voice || ''}
                    onChange={e => handleParamChange('edge_voice', e.target.value)}>
                    <option value="">🌐 跟随全局</option>
                    {edgeVoices.map(v => (
                      <option key={v.short_name} value={v.short_name}>
                        {v.display_name} ({v.gender === 'Female' ? '女' : '男'})
                      </option>
                    ))}
                  </select>
                )}

                {isMiMo && (
                  <select className={styles.paramSelect} value={segment.params.mimo_preset_voice || ''}
                    onChange={e => handleParamChange('mimo_preset_voice', e.target.value)}>
                    <option value="">🌐 跟随全局</option>
                    {MIMO_PRESET_VOICES.map(name => (
                      <option key={name} value={name}>⭐ {name}</option>
                    ))}
                  </select>
                )}

                {isVoxCPM && (
                  <select className={styles.paramSelect} value={segment.params.voice_id || ''}
                    onChange={e => handleParamChange('voice_id', e.target.value)}>
                    <option value="">🌐 跟随全局</option>
                    {voices.map(v => (
                      <option key={v.id} value={v.id}>⭐ {v.description || v.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Speed */}
              <div className={styles.paramField}>
                <div className={styles.paramLabel}>
                  {segment.overrides?.includes('speed') && <span className={styles.overrideDot} />}
                  语速
                  {segment.overrides?.includes('speed') && <button className={styles.resetBtn} onClick={() => handleResetOverride('speed')}>重置</button>}
                </div>
                <div className={styles.sliderRow}>
                  <input type="range" min={0.5} max={2.0} step={0.1} className={styles.range}
                    value={segment.params.speed ?? 1.0} onChange={e => handleParamChange('speed', parseFloat(e.target.value))} />
                  <span className={styles.sliderVal}>{(segment.params.speed ?? 1.0).toFixed(1)}×</span>
                </div>
              </div>

              {/* Volume */}
              <div className={styles.paramField}>
                <div className={styles.paramLabel}>
                  {segment.overrides?.includes('volume') && <span className={styles.overrideDot} />}
                  音量
                  {segment.overrides?.includes('volume') && <button className={styles.resetBtn} onClick={() => handleResetOverride('volume')}>重置</button>}
                </div>
                <div className={styles.sliderRow}>
                  <input type="range" min={0} max={100} step={1} className={styles.range}
                    value={segment.params.volume ?? 80} onChange={e => handleParamChange('volume', parseInt(e.target.value))} />
                  <span className={styles.sliderVal}>{segment.params.volume ?? 80}</span>
                </div>
              </div>

              {/* Pitch (CosyVoice only) */}
              {isCosyVoice && (
                <div className={styles.paramField}>
                  <div className={styles.paramLabel}>
                    {segment.overrides?.includes('pitch') && <span className={styles.overrideDot} />}
                    语调
                    {segment.overrides?.includes('pitch') && <button className={styles.resetBtn} onClick={() => handleResetOverride('pitch')}>重置</button>}
                  </div>
                  <div className={styles.sliderRow}>
                    <input type="range" min={0.5} max={2.0} step={0.1} className={styles.range}
                      value={segment.params.pitch ?? 1.0} onChange={e => handleParamChange('pitch', parseFloat(e.target.value))} />
                    <span className={styles.sliderVal}>{(segment.params.pitch ?? 1.0).toFixed(1)}</span>
                  </div>
                </div>
              )}

              {/* Language (CosyVoice) */}
              {isCosyVoice && (
                <div className={styles.paramField}>
                  <div className={styles.paramLabel}>语言</div>
                  <select className={styles.paramSelect} value={segment.params.language || 'Chinese'}
                    onChange={e => handleParamChange('language', e.target.value)}>
                    <option value="Chinese">中文</option>
                    <option value="English">English</option>
                    <option value="Japanese">日本語</option>
                    <option value="Korean">한국어</option>
                  </select>
                </div>
              )}

              {/* Instruction (CosyVoice/MiMo/VoxCPM) */}
              {(isCosyVoice || isMiMo || isVoxCPM) && (
                <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                  <div className={styles.paramLabel}>
                    {segment.overrides?.includes('instruction') && <span className={styles.overrideDot} />}
                    风格指令
                    {segment.overrides?.includes('instruction') && <button className={styles.resetBtn} onClick={() => handleResetOverride('instruction')}>重置</button>}
                  </div>
                  <StyleInstructionPicker
                    value={isMiMo ? (segment.params.mimo_instruction || '') : isVoxCPM ? (segment.params.voxcpm_style_control || '') : (segment.params.instruction || '')}
                    onChange={value => handleParamChange(isMiMo ? 'mimo_instruction' : isVoxCPM ? 'voxcpm_style_control' : 'instruction', value)}
                    label=""
                    placeholder="跟随全局风格指令，或选择预设/直接输入..."
                    dense
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
