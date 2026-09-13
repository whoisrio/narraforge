import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import { StyleInstructionPicker } from './StyleInstructionPicker';
import type { VoiceProfile } from '../../types';
import styles from './GlobalControlBar.module.css';

interface GlobalControlBarProps {
  voices: VoiceProfile[];
  selectedVoiceId: string;
  onVoiceSelect: (voiceId: string) => void;
  speed: number;
  volume: number;
  pitch: number;
  language: string;
  instruction?: string;
  enableSsml?: boolean;
  enableMarkdownFilter?: boolean;
  onSpeedChange: (v: number) => void;
  onVolumeChange: (v: number) => void;
  onPitchChange: (v: number) => void;
  onLanguageChange: (v: string) => void;
  onInstructionChange?: (v: string) => void;
  onSsmlToggle?: () => void;
  onMarkdownFilterToggle?: () => void;
  onNavigateToClone?: () => void;
}

export function GlobalControlBar({
  voices, selectedVoiceId, onVoiceSelect,
  speed, volume, pitch, language,
  instruction, enableSsml, enableMarkdownFilter,
  onSpeedChange, onVolumeChange, onPitchChange, onLanguageChange,
  onInstructionChange, onSsmlToggle, onMarkdownFilterToggle,
  onNavigateToClone,
}: GlobalControlBarProps) {
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto-select first voice
  useEffect(() => {
    if (voices.length > 0 && !selectedVoiceId) {
      const voiceKey = (voices[0].voice_params?.[voices[0].voice?.model || '']?.params as Record<string, unknown>)?.voice_id as string || voices[0].id;
      onVoiceSelect(voiceKey);
    }
  }, [voices, selectedVoiceId, onVoiceSelect]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowVoiceDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selectedVoice = voices.find(v => {
    const voiceId = (v.voice_params?.[v.voice?.model || '']?.params as Record<string, unknown>)?.voice_id as string | undefined;
    return (voiceId || v.id) === selectedVoiceId;
  });

  const handleVoicePick = useCallback((voiceId: string) => {
    onVoiceSelect(voiceId);
    setShowVoiceDropdown(false);
  }, [onVoiceSelect]);

  const { t } = useTranslation();

  return (
    <div className={styles.panel}>
      {/* Voice Selector */}
      <label className={styles.fieldLabel}>{t('tts.globalVoice')}</label>
      <div className={styles.voiceSelectWrap} ref={dropdownRef}>
        <button className={styles.voiceSelect} onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}>
          <VoiceAvatar name={selectedVoice?.name || '?'} size={24} />
          <span className={styles.voiceName}>
            {selectedVoice?.name || t('studio.voicePlaceholder')}
          </span>
          <span className={styles.arrow}>▾</span>
        </button>
        {showVoiceDropdown && (
          <div className={styles.voiceDropdown}>
            {voices.length === 0 && (
              onNavigateToClone ? (
                <button
                  className={styles.ctaCloneBtn}
                  onClick={(e) => { e.stopPropagation(); onNavigateToClone(); }}
                >
                  {t('tts.noVoicesGoClone')}
                </button>
              ) : (
                <div className={styles.dropdownEmpty}>{t('tts.noCloneVoices')}</div>
              )
            )}
            {voices.map(v => {
              const voiceKey = (v.voice_params?.[v.voice?.model || '']?.params as Record<string, unknown>)?.voice_id as string || v.id;
              const isSelected = voiceKey === selectedVoiceId;
              return (
                <button
                  key={v.id}
                  className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemSelected : ''}`}
                  onClick={() => handleVoicePick(voiceKey)}
                >
                  <VoiceAvatar name={v.name} size={28} />
                  <div className={styles.dropdownInfo}>
                    <span className={styles.dropdownName}>{v.name}</span>
                    <span className={styles.dropdownMeta}>{t('tts.cloneBadge')}</span>
                  </div>
                  {isSelected && <span className={styles.checkmark}>✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Speed */}
      <div className={styles.sliderRow}>
        <div className={styles.sliderHeader}>
          <span className={styles.fieldLabel}>{t('tts.speed')}</span>
          <span className={styles.paramValue}>{speed.toFixed(1)}×</span>
        </div>
        <input
          type="range" min={0.5} max={2.0} step={0.1} value={speed}
          className={styles.range}
          style={{ '--fill-pct': `${((speed - 0.5) / 1.5) * 100}%` } as React.CSSProperties}
          onChange={e => onSpeedChange(parseFloat(e.target.value))}
        />
      </div>

      {/* Volume */}
      <div className={styles.sliderRow}>
        <div className={styles.sliderHeader}>
          <span className={styles.fieldLabel}>{t('tts.volume')}</span>
          <span className={styles.paramValue}>{volume}</span>
        </div>
        <input
          type="range" min={0} max={100} step={1} value={volume}
          className={styles.range}
          style={{ '--fill-pct': `${volume}%` } as React.CSSProperties}
          onChange={e => onVolumeChange(parseInt(e.target.value))}
        />
      </div>

      {/* Pitch */}
      <div className={styles.sliderRow}>
        <div className={styles.sliderHeader}>
          <span className={styles.fieldLabel}>{t('tts.pitch')}</span>
          <span className={styles.paramValue}>{pitch.toFixed(1)}</span>
        </div>
        <input
          type="range" min={0.5} max={2.0} step={0.1} value={pitch}
          className={styles.range}
          style={{ '--fill-pct': `${((pitch - 0.5) / 1.5) * 100}%` } as React.CSSProperties}
          onChange={e => onPitchChange(parseFloat(e.target.value))}
        />
      </div>

      {/* Language */}
      <label className={styles.fieldLabel}>{t('tts.language')}</label>
      <select
        className={styles.langSelect}
        value={language}
        onChange={e => onLanguageChange(e.target.value)}
      >
        <option value="Chinese">{t('common.langZh')}</option>
        <option value="English">English</option>
        <option value="Japanese">{t('common.langJa')}</option>
        <option value="Korean">한국어</option>
      </select>

      {/* Advanced toggle */}
      {(onInstructionChange || onSsmlToggle || onMarkdownFilterToggle) && (
        <button className={styles.advancedToggle} onClick={() => setShowAdvanced(!showAdvanced)}>
          <span className={styles.advancedCaret}>{showAdvanced ? '▾' : '▸'}</span>
          {t('tts.advancedOptions')}
        </button>
      )}

      {/* Advanced params */}
      {showAdvanced && (
        <div className={styles.advancedSection}>
          {onInstructionChange && (
            <StyleInstructionPicker
              value={instruction || ''}
              onChange={onInstructionChange}
              label={t('voxcpm.styleInstruction')}
              placeholder={t("placeholders.presetOrInput")}
              dense
            />
          )}
          {(onSsmlToggle || onMarkdownFilterToggle) && (
            <div className={styles.toggleRow}>
              {onSsmlToggle && (
                <button
                  className={`${styles.toggleChip} ${enableSsml ? styles.toggleChipOn : ''}`}
                  onClick={onSsmlToggle}
                >
                  SSML {enableSsml ? t('common.on') : t('common.off')}
                </button>
              )}
              {onMarkdownFilterToggle && (
                <button
                  className={`${styles.toggleChip} ${enableMarkdownFilter ? styles.toggleChipOn : ''}`}
                  onClick={onMarkdownFilterToggle}
                >
                  {t('studio.markdownFilter')} {enableMarkdownFilter ? t('common.on') : t('common.off')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Hint */}
      <div className={styles.hint}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        {t('tts.onlyAffectsNewSegments')}
      </div>
    </div>
  );
}
