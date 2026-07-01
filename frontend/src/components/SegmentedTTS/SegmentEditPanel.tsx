import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '../../i18n';
import type { Segment, SegmentEngineParams, EmotionType, VoiceProfile, MiMoPresetVoice, Role } from '../../types';
import { ttsApi, mimoTtsApi } from '../../services/api';
import { StyleInstructionPicker } from '../TTSSynthesis/StyleInstructionPicker';
import { segEngine, segEffectiveParams, segFieldOverridden, segOverrideFields } from '../../services/segmentShims';
import styles from './SegmentEditPanel.module.css';

type SegmentOverride = 'voice' | 'speed' | 'volume' | 'pitch' | 'language' | 'instruction';
type SegmentParamField = keyof SegmentEngineParams;
type SegmentParamValue = SegmentEngineParams[SegmentParamField];

const EMOTION_LABELS: Record<EmotionType, string> = {
  happy: 'segmentEdit.emotion.happy', sad: 'segmentEdit.emotion.sad', angry: 'segmentEdit.emotion.angry',
  calm: 'segmentEdit.emotion.calm', neutral: 'segmentEdit.emotion.neutral', excited: 'segmentEdit.emotion.excited',
};

interface SegmentEditPanelProps {
  segment: Segment | null;
  voices: VoiceProfile[];
  roles?: Role[];
  globalVoiceName?: string;
  onClose: () => void;
  onUpdateText: (id: string, text: string) => void;
  onUpdateSSML: (id: string, ssml: string) => void;
  onUpdateParams: (id: string, params: Partial<SegmentEngineParams>) => void;
  onUpdateOverrides?: (id: string, overrides: string[]) => void;
  onUpdateEmotion?: (id: string, emotion: string) => void;
  onUndo?: (id: string) => void;
  onRegenerate: (id: string) => void;
  onConfirmCustom?: (id: string, localParams: Record<string, unknown>) => void;
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

export function SegmentEditPanel({
  segment, voices, roles, globalVoiceName, onClose, onUpdateText,
  onUpdateParams, onUpdateOverrides, onUpdateEmotion, onUndo, onRegenerate, onConfirmCustom, onAnnotateSSML, onSplit,
}: SegmentEditPanelProps) {
  const { t } = useTranslation();
  const [localText, setLocalText] = useState(segment?.text ?? '');
  const [showParams, setShowParams] = useState(false);
  const [edgeVoices, setEdgeVoices] = useState<{ short_name: string; display_name: string; gender: string }[]>([]);
  const [mimoPresets, setMimoPresets] = useState<MiMoPresetVoice[]>([]);
  const [edgeLang] = useState('Chinese');
  const [localParams, setLocalParams] = useState<Record<string, unknown>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset local params when segment source changes
  useEffect(() => {
    if (!segment) { setLocalParams({}); return; }
    const _eff = segEffectiveParams(segment);
    // For role segments, include role voice params as base display
    if (segment.voice.source === 'role' && segment.role_id && roles) {
      const role = roles.find(r => r.id === segment.role_id);
      if (role?.voice) {
        const v = role.voice;
        let roleFlat: Record<string, unknown> = { engine: v.engine };
        if (v.engine === 'edge_tts') roleFlat = { engine: 'edge_tts', edge_voice: v.voice, edge_rate: v.rate, edge_volume: v.volume };
        else if (v.engine === 'cosyvoice') roleFlat = { engine: 'cosyvoice', voice_id: v.voice_id, speed: v.speed ?? 1, volume: v.volume ?? 80, pitch: v.pitch ?? 1, language: v.language ?? 'Chinese' };
        else if (v.engine === 'mimo_tts') roleFlat = { engine: 'mimo_tts', mimo_mode: v.mode || 'preset', ...(v.mode === 'preset' ? { mimo_preset_voice: v.voice_id } : v.mode === 'voiceclone' ? { mimo_clone_voice_id: v.voice_id } : {}), mimo_instruction: v.instruction ?? '' };
        else if (v.engine === 'voxcpm') roleFlat = { engine: 'voxcpm', voxcpm_mode: v.mode || 'clone', voice_id: v.voice_id ?? '', voxcpm_style_control: v.style_control ?? '', voxcpm_cfg_value: v.cfg_value ?? 2, voxcpm_inference_timesteps: v.inference_timesteps ?? 10 };
        setLocalParams({ ..._eff, ...roleFlat });
        return;
      }
    }
    setLocalParams(_eff);
  }, [segment?.id, segment?.voice?.source, roles]);

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
    if (segEngine(segment) === 'edge_tts' || showParams) {
      ttsApi.getEdgeVoices(edgeLang).then(setEdgeVoices).catch(() => {});
    }
  }, [edgeLang, segment ? segEngine(segment) : undefined, showParams]);

  // Load MiMo preset voices from backend
  useEffect(() => {
    if (showParams) {
      mimoTtsApi.getPresetVoices().then(setMimoPresets).catch(() => {});
    }
  }, [showParams]);

  const handleTextChange = useCallback((text: string) => {
    setLocalText(text);
    if (segment) onUpdateText(segment.id, text);
  }, [segment, onUpdateText]);

  const handleParamChange = useCallback((field: SegmentParamField, value: SegmentParamValue) => {
    if (!segment) return;
    const params: Partial<SegmentEngineParams> = {};
    if (field === 'engine') {
      params.engine = value as SegmentEngineParams['engine'];
      if (value === 'edge_tts') { params.edge_voice = ''; }
      else if (value === 'mimo_tts') { params.mimo_mode = 'preset'; params.mimo_preset_voice = '冰糖'; }
      else if (value === 'voxcpm') { params.voxcpm_mode = 'clone'; }
      else { params.voice_id = ''; }
    }
    else if (field === 'speed') params.speed = value as number;
    else if (field === 'volume') params.volume = value as number;
    else if (field === 'pitch') params.pitch = value as number;
    else if (field === 'voice_id') params.voice_id = value as string;
    else if (field === 'edge_voice') params.edge_voice = value as string;
    else if (field === 'mimo_mode') params.mimo_mode = value as SegmentEngineParams['mimo_mode'];
    else if (field === 'mimo_preset_voice') params.mimo_preset_voice = value as string;
    else if (field === 'mimo_clone_voice_id') params.mimo_clone_voice_id = value as string;
    else if (field === 'mimo_instruction') params.mimo_instruction = value as string;
    else if (field === 'voxcpm_mode') params.voxcpm_mode = value as SegmentEngineParams['voxcpm_mode'];
    else if (field === 'voxcpm_style_control') params.voxcpm_style_control = value as string;
    else if (field === 'language') params.language = value as string;
    else if (field === 'instruction') params.instruction = value as string;

    // All edits accumulate locally; only confirm button commits
    setLocalParams(prev => ({ ...prev, ...params as unknown as Record<string, unknown> }));
  }, [segment]);

  const handleResetOverride = useCallback((field: SegmentOverride) => {
    if (!segment || !onUpdateOverrides) return;
    onUpdateOverrides(segment.id, segOverrideFields(segment).filter(f => f !== field));
  }, [segment, onUpdateOverrides]);

  if (!segment) return null;

  const isCustom = segment.voice.source === 'custom';
  const emotion = segment.emotion || 'neutral';
  const emoCamel = emotion.charAt(0).toUpperCase() + emotion.slice(1);
  const _eff = segEffectiveParams(segment);
  // Merge local edits on top of effective params (for preview when not custom)
  const eff: Record<string, unknown> = isCustom ? _eff : { ..._eff, ...localParams };
  const isCosyVoice = eff.engine === 'cosyvoice';
  const isEdgeTTS = eff.engine === 'edge_tts';
  const isMiMo = eff.engine === 'mimo_tts';
  const isVoxCPM = eff.engine === 'voxcpm';
  const hasOverrides = segOverrideFields(segment).length > 0;

  // Build override summary
  const overrideSummary: string[] = [];
  if (segFieldOverridden(segment, 'voice')) {
    if (isEdgeTTS) {
      overrideSummary.push(`${t('segmentEdit.voice')}: ${eff.edge_voice || t('segmentEdit.custom')}`);
    } else if (isMiMo) {
      overrideSummary.push(`${t('segmentEdit.voice')}: ${eff.mimo_preset_voice || t('segmentEdit.custom')}`);
    } else if (isVoxCPM) {
      const v = voices.find(v => v.id === eff.voice_id);
      overrideSummary.push(`${t('segmentEdit.voice')}: ${v?.name || t('segmentEdit.custom')}`);
    } else {
      const v = voices.find(v => (v.qwen_voice_id || v.id) === eff.voice_id);
      overrideSummary.push(`${t('segmentEdit.voice')}: ${v?.name || t('segmentEdit.custom')}`);
    }
  }
  if (segFieldOverridden(segment, 'speed')) overrideSummary.push(`${t('segmentEdit.speed')}: ${Number(eff.speed ?? 1).toFixed(1)}×`);
  if (segFieldOverridden(segment, 'pitch')) overrideSummary.push(`${t('segmentEdit.pitch')}: ${Number(eff.pitch ?? 1).toFixed(1)}`);

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
          {segment.status === 'ready' && onUndo && (
            <button className={styles.btnSecondary} onClick={() => onUndo(segment.id)}>{t('segmentEdit.undo')}</button>
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
              <span className={styles.paramsHint}>
                {isCustom ? t('segmentEdit.customVoiceActive') : t('segmentEdit.willBecomeCustom')}
              </span>
            </div>

            {/* Engine selector */}
            <div className={styles.engineRow}>
              <span className={styles.paramLabel}>{t('segmentEdit.model')}</span>
              <div className={styles.enginePills}>
                {(['cosyvoice', 'edge_tts', 'mimo_tts', 'voxcpm'] as const).map(eng => (
                  <button key={eng} className={`${styles.enginePill} ${eff.engine === eng ? styles.enginePillActive : ''}`}
                    onClick={() => handleParamChange('engine', eng)}>
                    {eng === 'cosyvoice' ? 'CosyVoice' : eng === 'edge_tts' ? 'Edge-TTS' : eng === 'mimo_tts' ? 'MiMo' : 'VoxCPM'}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.paramsGrid}>
              {/* CosyVoice: cloned voice selector */}
              {isCosyVoice && (
                <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                  <div className={styles.paramLabel}>{t('segmentEdit.voice')}</div>
                  <select className={styles.paramSelect} value={eff.voice_id || ''}
                    onChange={e => handleParamChange('voice_id', e.target.value)}>
                    {!isCustom && <option value="">🌐 {t('segmentEdit.followGlobal')}</option>}
                      {voices.filter(v => v.engine?.type === 'qwen').map(v => {
                        const key = v.qwen_voice_id || v.id;
                        return <option key={key} value={key}>⭐ {v.name || key}</option>;
                      })}
                  </select>
                </div>
              )}

              {/* Edge-TTS: voice + rate + volume */}
              {isEdgeTTS && (
                <>
                  <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                    <div className={styles.paramLabel}>{t('segmentEdit.voice')}</div>
                    <select className={styles.paramSelect} value={eff.edge_voice || ''}
                      onChange={e => handleParamChange('edge_voice', e.target.value)}>
                      {!isCustom && <option value="">🌐 {t('segmentEdit.followGlobal')}</option>}
                      {edgeVoices.map(v => (
                        <option key={v.short_name} value={v.short_name}>
                          {v.display_name} ({v.gender === 'Female' ? t('segmentEdit.female') : t('segmentEdit.male')})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.paramField}>
                    <div className={styles.paramLabel}>{t('segmentEdit.speed')}</div>
                    <div className={styles.sliderRow}>
                      <input type="range" min={0.5} max={2.0} step={0.1} className={styles.range}
                        value={eff.speed ?? 1.0} onChange={e => handleParamChange('speed', parseFloat(e.target.value))} />
                      <span className={styles.sliderVal}>{(eff.speed ?? 1.0).toFixed(1)}×</span>
                    </div>
                  </div>
                  <div className={styles.paramField}>
                    <div className={styles.paramLabel}>{t('segmentEdit.volume')}</div>
                    <div className={styles.sliderRow}>
                      <input type="range" min={0} max={100} step={1} className={styles.range}
                        value={eff.volume ?? 80} onChange={e => handleParamChange('volume', parseInt(e.target.value))} />
                      <span className={styles.sliderVal}>{eff.volume ?? 80}</span>
                    </div>
                  </div>
                </>
              )}

              {/* MiMo: mode + voice */}
              {isMiMo && (
                <>
                  <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                    <div className={styles.paramLabel}>{t('segmentEdit.voiceMode')}</div>
                    <div className={styles.enginePills}>
                      <button className={`${styles.enginePill} ${(eff.mimo_mode || 'preset') === 'preset' ? styles.enginePillActive : ''}`}
                        onClick={() => handleParamChange('mimo_mode', 'preset')}>{t('segmentEdit.mimoPreset')}</button>
                      <button className={`${styles.enginePill} ${eff.mimo_mode === 'voiceclone' ? styles.enginePillActive : ''}`}
                        onClick={() => handleParamChange('mimo_mode', 'voiceclone')}>{t('segmentEdit.mimoClone')}</button>
                    </div>
                  </div>
                  {(eff.mimo_mode || 'preset') === 'preset' ? (
                    <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                      <div className={styles.paramLabel}>{t('segmentEdit.voice')}</div>
                      <select className={styles.paramSelect} value={eff.mimo_preset_voice || ''}
                        onChange={e => handleParamChange('mimo_preset_voice', e.target.value)}>
                        {!isCustom && <option value="">🌐 {t('segmentEdit.followGlobal')}</option>}
                        {mimoPresets.map(v => (
                          <option key={v.voice_id} value={v.voice_id}>⭐ {v.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                      <div className={styles.paramLabel}>{t('segmentEdit.voice')}</div>
                      <select className={styles.paramSelect} value={eff.mimo_clone_voice_id || ''}
                        onChange={e => handleParamChange('mimo_clone_voice_id', e.target.value)}>
                        {!isCustom && <option value="">🌐 {t('segmentEdit.followGlobal')}</option>}
                        {voices.filter(v => v.engine?.type === 'mimo' && v.id).map(v => (
                          <option key={v.id} value={v.id}>⭐ {v.name || v.id}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              {/* VoxCPM: mode + voice */}
              {isVoxCPM && (
                <>
                  <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                    <div className={styles.paramLabel}>{t('segmentEdit.voiceMode')}</div>
                    <div className={styles.enginePills}>
                      <button className={`${styles.enginePill} ${(eff.voxcpm_mode || 'clone') === 'clone' ? styles.enginePillActive : ''}`}
                        onClick={() => handleParamChange('voxcpm_mode', 'clone')}>{t('segmentEdit.voxcpmClone')}</button>
                      <button className={`${styles.enginePill} ${eff.voxcpm_mode === 'ultimate' ? styles.enginePillActive : ''}`}
                        onClick={() => handleParamChange('voxcpm_mode', 'ultimate')}>{t('segmentEdit.voxcpmUltimate')}</button>
                    </div>
                  </div>
                  <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                    <div className={styles.paramLabel}>{t('segmentEdit.voice')}</div>
                    <select className={styles.paramSelect} value={eff.voice_id || ''}
                      onChange={e => handleParamChange('voice_id', e.target.value)}>
                      {!isCustom && <option value="">🌐 {t('segmentEdit.followGlobal')}</option>}
                      {voices.filter(v => v.engine?.type === 'voxcpm').map(v => (
                          <option key={v.id} value={v.id}>⭐ {v.name || v.id}</option>
                        ))}
                    </select>
                  </div>
                </>
              )}

              {/* Instruction */}
              {(isCosyVoice || isMiMo || isVoxCPM) && (
                <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                  <div className={styles.paramLabel}>{t('segmentEdit.styleInstruction')}</div>
                  <StyleInstructionPicker
                    value={isMiMo ? (eff.mimo_instruction || '') : isVoxCPM ? (eff.voxcpm_style_control || '') : (eff.instruction || '')}
                    onChange={value => handleParamChange(isMiMo ? 'mimo_instruction' : isVoxCPM ? 'voxcpm_style_control' : 'instruction', value)}
                    label="" placeholder={t('segmentEdit.styleHint')} dense
                  />
                </div>
              )}
            </div>

            {/* Confirm custom button — always visible */}
            {onConfirmCustom && (
              <button
                className={styles.btnPrimary}
                style={{ marginTop: '0.75rem', width: '100%' }}
                onClick={() => onConfirmCustom(segment.id, localParams)}
              >
                {t('segmentEdit.confirmCustom')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
