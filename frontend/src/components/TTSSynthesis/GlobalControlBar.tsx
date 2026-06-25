import { useState, useEffect, useCallback, useRef } from 'react';
import { ttsApi } from '../../services/api';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import { StyleInstructionPicker } from './StyleInstructionPicker';
import type { VoiceProfile } from '../../types';
import styles from './GlobalControlBar.module.css';

interface GlobalControlBarProps {
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
  selectedVoiceId, onVoiceSelect,
  speed, volume, pitch, language,
  instruction, enableSsml, enableMarkdownFilter,
  onSpeedChange, onVolumeChange, onPitchChange, onLanguageChange,
  onInstructionChange, onSsmlToggle, onMarkdownFilterToggle,
  onNavigateToClone,
}: GlobalControlBarProps) {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [showVoiceDropdown, setShowVoiceDropdown] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { refreshCounter } = useVoiceRefresh();

  useEffect(() => {
    ttsApi.getVoices().then(setVoices).catch(() => {});
  }, [refreshCounter]);

  // Auto-select first voice
  useEffect(() => {
    if (voices.length > 0 && !selectedVoiceId) {
      onVoiceSelect(voices[0].qwen_voice_id || voices[0].id);
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

  const selectedVoice = voices.find(v => (v.qwen_voice_id || v.id) === selectedVoiceId);

  const handleVoicePick = useCallback((voiceId: string) => {
    onVoiceSelect(voiceId);
    setShowVoiceDropdown(false);
  }, [onVoiceSelect]);

  return (
    <div className={styles.panel}>
      {/* Voice Selector */}
      <label className={styles.fieldLabel}>全局音色</label>
      <div className={styles.voiceSelectWrap} ref={dropdownRef}>
        <button className={styles.voiceSelect} onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}>
          <VoiceAvatar name={selectedVoice?.description || selectedVoice?.name || '?'} size={24} />
          <span className={styles.voiceName}>
            {selectedVoice?.description || selectedVoice?.name || '请选择声音'}
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
                  暂无音色，去复刻
                </button>
              ) : (
                <div className={styles.dropdownEmpty}>暂无克隆声音</div>
              )
            )}
            {voices.map(v => {
              const voiceKey = v.qwen_voice_id || v.id;
              const isSelected = voiceKey === selectedVoiceId;
              return (
                <button
                  key={v.id}
                  className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemSelected : ''}`}
                  onClick={() => handleVoicePick(voiceKey)}
                >
                  <VoiceAvatar name={v.description || v.name} size={28} />
                  <div className={styles.dropdownInfo}>
                    <span className={styles.dropdownName}>{v.description || v.name}</span>
                    <span className={styles.dropdownMeta}>克隆</span>
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
          <span className={styles.fieldLabel}>语速</span>
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
          <span className={styles.fieldLabel}>音量</span>
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
          <span className={styles.fieldLabel}>语调</span>
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
      <label className={styles.fieldLabel}>语言</label>
      <select
        className={styles.langSelect}
        value={language}
        onChange={e => onLanguageChange(e.target.value)}
      >
        <option value="Chinese">中文</option>
        <option value="English">English</option>
        <option value="Japanese">日本語</option>
        <option value="Korean">한국어</option>
      </select>

      {/* Advanced toggle */}
      {(onInstructionChange || onSsmlToggle || onMarkdownFilterToggle) && (
        <button className={styles.advancedToggle} onClick={() => setShowAdvanced(!showAdvanced)}>
          <span className={styles.advancedCaret}>{showAdvanced ? '▾' : '▸'}</span>
          高级选项
        </button>
      )}

      {/* Advanced params */}
      {showAdvanced && (
        <div className={styles.advancedSection}>
          {onInstructionChange && (
            <StyleInstructionPicker
              value={instruction || ''}
              onChange={onInstructionChange}
              label="风格指令"
              placeholder="选择预设，或直接输入..."
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
                  SSML {enableSsml ? '开' : '关'}
                </button>
              )}
              {onMarkdownFilterToggle && (
                <button
                  className={`${styles.toggleChip} ${enableMarkdownFilter ? styles.toggleChipOn : ''}`}
                  onClick={onMarkdownFilterToggle}
                >
                  MD过滤 {enableMarkdownFilter ? '开' : '关'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Hint */}
      <div className={styles.hint}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        仅影响新段落
      </div>
    </div>
  );
}
