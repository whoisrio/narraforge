import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '../../i18n';
import type { Segment, SegmentEngineParams, EmotionType, VoiceProfile } from '../../types';
import { ttsApi } from '../../services/api';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import { StyleInstructionPicker } from '../TTSSynthesis/StyleInstructionPicker';
import styles from './SegmentEditPanel.module.css';

type SegmentOverride = NonNullable<Segment['overrides']>[number];
type SegmentParamField = keyof SegmentEngineParams;
type SegmentParamValue = SegmentEngineParams[SegmentParamField];

const EMOTION_LABELS: Record<EmotionType, string> = {
  happy: 'segmentEdit.emotion.happy', sad: 'segmentEdit.emotion.sad', angry: 'segmentEdit.emotion.angry',
  calm: 'segmentEdit.emotion.calm', neutral: 'segmentEdit.emotion.neutral', excited: 'segmentEdit.emotion.excited',
};

interface SegmentEditPanelProps {
  segment: Segment | null;
  voices: VoiceProfile[];
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
  { key: 'happy', label: 'segmentEdit.emotion.happy', color: '#e8a838', bg: '#fef7e6' },
  { key: 'excited', label: 'segmentEdit.emotion.excited', color: '#d46a2c', bg: '#fdf0e8' },
  { key: 'calm', label: 'segmentEdit.emotion.calm', color: '#7ba68a', bg: '#eef5f0' },
  { key: 'neutral', label: 'segmentEdit.emotion.neutral', color: '#9e978e', bg: '#f5f4f0' },
  { key: 'sad', label: 'segmentEdit.emotion.sad', color: '#6b8db5', bg: '#edf2f8' },
  { key: 'angry', label: 'segmentEdit.emotion.angry', color: '#c45a4a', bg: '#fceae7' },
];

const MIMO_PRESET_VOICES = ['冰糖', '星辰', '雪梨', '琥珀', '青云', '紫霞'];

const MIMO_PRESET_LABELS: Record<string, string> = {
  '冰糖': 'segmentEdit.mimoPreset_bingke',
  '星辰': 'segmentEdit.mimoPreset_xingchen',
  '雪梨': 'segmentEdit.mimoPreset_xueli',
  '琥珀': 'segmentEdit.mimoPreset_hupo',
  '青云': 'segmentEdit.mimoPreset_qingyun',
  '紫霞': 'segmentEdit.mimoPreset_zixia',
};

export function SegmentEditPanel({
  segment, voices, globalVoiceName, onClose, onUpdateText,
  onUpdateParams, onUpdateOverrides, onUpdateEmotion, onRegenerate, onAnnotateSSML, onSplit,
}: SegmentEditPanelProps) {
  const { t } = useTranslation();
  const [localText, setLocalText] = useState(segment?.text ?? '');
  const [showParams, setShowParams] = useState(false);
  const [edgeVoices, setEdgeVoices] = useState<{ short_name: string; display_name: string; gender: string }[]>([]);
  const [edgeLang] = useState('Chinese');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (segment) {
      setLocalText(segment.text);
      setShowParams(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment?.id]);

  // Sync localText when the segment's text changes externally (e.g., after split)
  useEffect(() => {
    if (segment && segment.text !== localText) {
      setLocalText(segment.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment?.text]);

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
      overrideSummary.push(`{t('segmentEdit.voice')}: ${segment.params.edge_voice || t('segmentEdit.custom')}`);
    } else if (isMiMo) {
      overrideSummary.push(`{t('segmentEdit.voice')}: ${segment.params.mimo_preset_voice || t('segmentEdit.custom')}`);
    } else if (isVoxCPM) {
      const v = voices.find(v => v.id === segment.params.voice_id);
      overrideSummary.push(`{t('segmentEdit.voice')}: ${v?.name || t('segmentEdit.custom')}`);
    } else {
      const v = voices.find(v => (v.qwen_voice_id || v.id) === segment.params.voice_id);
      overrideSummary.push(`{t('segmentEdit.voice')}: ${v?.name || t('segmentEdit.custom')}`);
    }
  }
  if (segment.overrides?.includes('speed')) overrideSummary.push(`{t('segmentEdit.speed')}: ${(segment.params.speed ?? 1).toFixed(1)}×`);
  if (segment.overrides?.includes('pitch')) overrideSummary.push(`{t('segmentEdit.pitch')}: ${(segment.params.pitch ?? 1).toFixed(1)}`);

  return (
    <div className={styles.panel}>
      <div className={styles.strip} />
      <div className={styles.body}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.title}>
            {segment.emotion && (
              <span className={`${styles.emotionTag} ${styles[`emotion${emoCamel}`]}`}>
                {t(EMOTION_LABELS[emotion])}
              </span>
            )}
            {t('segmentEdit.editSegment')} #{segment.id.slice(-3)}
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Role info (if assigned) */}
        {segment.role_snapshot && (
          <div className={styles.roleInfo}>
            <VoiceAvatar
              avatar={segment.role_snapshot.avatar}
              name={segment.role_snapshot.name}
              engine={segment.role_snapshot.default_engine}
              size={28}
            />
            <span className={styles.roleInfoName}>{segment.role_snapshot.name}</span>
          </div>
        )}

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
              {t('segmentEdit.splitAtCursor')}
            </button>
          </div>
        )}

        {/* SSML (CosyVoice only) */}
        {isCosyVoice && (
          <div className={styles.ssmlBar}>
            <button className={styles.ssmlBtn} onClick={() => onAnnotateSSML(segment.id)}>{t('segmentEdit.smartAnnotate')}</button>
          </div>
        )}

        {/* Emotion picker */}
        <div className={styles.emotionPicker}>
          <span className={styles.emotionPickerLabel}>{t('segmentEdit.emotionLabel')}</span>
          <div className={styles.emotionChips}>
            {ALL_EMOTIONS.map(e => (
              <button key={e.key} className={styles.emotionChip}
                style={{ background: emotion === e.key ? e.color : e.bg, color: emotion === e.key ? '#fff' : e.color, borderColor: emotion === e.key ? e.color : 'transparent' }}
                onClick={() => onUpdateEmotion?.(segment.id, e.key)}>
                {t(e.label)}
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
              <span style={{ color: 'var(--color-text-muted)' }}>{t('segmentEdit.useGlobalParams')}</span>
            )}
          </div>
          <button className={`${styles.expandBtn} ${showParams ? styles.expandBtnOpen : ''}`}
            onClick={() => setShowParams(!showParams)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            {t('segmentEdit.paramsOverride')}
          </button>
          {segment.status === 'ready' && (
            <button className={styles.btnSecondary} onClick={() => onRegenerate(segment.id)}>{t('segmentEdit.undo')}</button>
          )}
          <button className={styles.btnPrimary} onClick={() => onRegenerate(segment.id)}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ verticalAlign: '-1px', marginRight: 3 }}><polygon points="5 3 19 12 5 21 5 3"/></svg>
            {t('segmentEdit.regenerate')}
          </button>
        </div>

        {/* Params panel (collapsed) */}
        {showParams && (
          <div className={styles.paramsPanel}>
            <div className={styles.paramsTitle}>
              {t('segmentEdit.paramsOverride')}
              <span className={styles.paramsHint}>{t('segmentEdit.modifiedNoLongerGlobal')}</span>
            </div>

            {/* Engine selector — full width */}
            <div className={styles.engineRow}>
              <span className={styles.paramLabel}>{t('segmentEdit.model')}</span>
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
                  {t('segmentEdit.voice')}
                </div>

                {isCosyVoice && (
                  <select className={styles.paramSelect} value={segment.params.voice_id || ''}
                    onChange={e => handleParamChange('voice_id', e.target.value)}>
                    <option value="">🌐 {t('segmentEdit.followGlobal')} — {globalVoiceName || `全局${t('segmentEdit.voice')}`}</option>
                    {voices.map(v => {
                      const key = v.qwen_voice_id || v.id;
                      return <option key={v.id} value={key}>⭐ {v.name}</option>;
                    })}
                  </select>
                )}

                {isEdgeTTS && (
                  <select className={styles.paramSelect} value={segment.params.edge_voice || ''}
                    onChange={e => handleParamChange('edge_voice', e.target.value)}>
                    <option value="">🌐 {t('segmentEdit.followGlobal')}</option>
                    {edgeVoices.map(v => (
                      <option key={v.short_name} value={v.short_name}>
                        {v.display_name} ({v.gender === 'Female' ? t('segmentEdit.female') : t('segmentEdit.male')})
                      </option>
                    ))}
                  </select>
                )}

                {isMiMo && (
                  <select className={styles.paramSelect} value={segment.params.mimo_preset_voice || ''}
                    onChange={e => handleParamChange('mimo_preset_voice', e.target.value)}>
                    <option value="">🌐 {t('segmentEdit.followGlobal')}</option>
                    {MIMO_PRESET_VOICES.map(name => (
                      <option key={name} value={name}>⭐ {t(MIMO_PRESET_LABELS[name])}</option>
                    ))}
                  </select>
                )}

                {isVoxCPM && (
                  <select className={styles.paramSelect} value={segment.params.voice_id || ''}
                    onChange={e => handleParamChange('voice_id', e.target.value)}>
                    <option value="">🌐 {t('segmentEdit.followGlobal')}</option>
                    {voices.map(v => (
                      <option key={v.id} value={v.id}>⭐ {v.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Speed */}
              <div className={styles.paramField}>
                <div className={styles.paramLabel}>
                  {segment.overrides?.includes('speed') && <span className={styles.overrideDot} />}
                  {t('segmentEdit.speed')}
                  {segment.overrides?.includes('speed') && <button className={styles.resetBtn} onClick={() => handleResetOverride('speed')}>{t('segmentEdit.reset')}</button>}
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
                  {t('segmentEdit.volume')}
                  {segment.overrides?.includes('volume') && <button className={styles.resetBtn} onClick={() => handleResetOverride('volume')}>{t('segmentEdit.reset')}</button>}
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
                    {t('segmentEdit.pitch')}
                    {segment.overrides?.includes('pitch') && <button className={styles.resetBtn} onClick={() => handleResetOverride('pitch')}>{t('segmentEdit.reset')}</button>}
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
                  <div className={styles.paramLabel}>{t('segmentEdit.language')}</div>
                  <select className={styles.paramSelect} value={segment.params.language || 'Chinese'}
                    onChange={e => handleParamChange('language', e.target.value)}>
                    <option value="Chinese">{t('segment.language.chinese')}</option>
                    <option value="English">{t('segment.language.english')}</option>
                    <option value="Japanese">{t('segment.language.japanese')}</option>
                    <option value="Korean">{t('segment.language.korean')}</option>
                  </select>
                </div>
              )}

              {/* Instruction (CosyVoice/MiMo/VoxCPM) */}
              {(isCosyVoice || isMiMo || isVoxCPM) && (
                <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                  <div className={styles.paramLabel}>
                    {segment.overrides?.includes('instruction') && <span className={styles.overrideDot} />}
                    {t('segmentEdit.styleInstruction')}
                    {segment.overrides?.includes('instruction') && <button className={styles.resetBtn} onClick={() => handleResetOverride('instruction')}>{t('segmentEdit.reset')}</button>}
                  </div>
                  <StyleInstructionPicker
                    value={isMiMo ? (segment.params.mimo_instruction || '') : isVoxCPM ? (segment.params.voxcpm_style_control || '') : (segment.params.instruction || '')}
                    onChange={value => handleParamChange(isMiMo ? 'mimo_instruction' : isVoxCPM ? 'voxcpm_style_control' : 'instruction', value)}
                    label=""
                    placeholder="{t('segmentEdit.followGlobal')}{t('segmentEdit.styleInstruction')}，或选择预设/直接输入..."
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
