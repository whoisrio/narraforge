import { useState, useEffect, useCallback, useRef } from 'react';
import { ttsApi } from '../../services/api';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
import { VoiceAvatar } from '../ui/VoiceAvatar';
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
    <div className={styles.bar}>
      {/* Voice Selector */}
      <div className={styles.section}>
        <span className={styles.label}>全局音色</span>
        <div className={styles.voiceSelectWrap} ref={dropdownRef}>
          <button className={styles.voiceSelect} onClick={() => setShowVoiceDropdown(!showVoiceDropdown)}>
            <VoiceAvatar name={selectedVoice?.description || selectedVoice?.name || '?'} size={28} />
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
                    <VoiceAvatar name={v.description || v.name} size={32} />
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
      </div>

      <div className={styles.divider} />

      {/* Speed */}
      <div className={styles.section}>
        <div className={styles.param}>
          <span className={styles.paramLabel}>语速</span>
          <div className={styles.sliderWrap}>
            <input
              type="range" min={0.5} max={2.0} step={0.1} value={speed}
              className={styles.range}
              onChange={e => onSpeedChange(parseFloat(e.target.value))}
            />
          </div>
          <span className={styles.paramValue}>{speed.toFixed(1)}×</span>
        </div>
      </div>

      {/* Volume */}
      <div className={styles.section}>
        <div className={styles.param}>
          <span className={styles.paramLabel}>音量</span>
          <div className={styles.sliderWrap}>
            <input
              type="range" min={0} max={100} step={1} value={volume}
              className={styles.range}
              onChange={e => onVolumeChange(parseInt(e.target.value))}
            />
          </div>
          <span className={styles.paramValue}>{volume}</span>
        </div>
      </div>

      {/* Pitch */}
      <div className={styles.section}>
        <div className={styles.param}>
          <span className={styles.paramLabel}>语调</span>
          <div className={styles.sliderWrap}>
            <input
              type="range" min={0.5} max={2.0} step={0.1} value={pitch}
              className={styles.range}
              onChange={e => onPitchChange(parseFloat(e.target.value))}
            />
          </div>
          <span className={styles.paramValue}>{pitch.toFixed(1)}</span>
        </div>
      </div>

      <div className={styles.divider} />

      {/* Language */}
      <div className={styles.section}>
        <span className={styles.paramLabel}>语言</span>
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
      </div>

      {/* Advanced params toggle */}
      {(onInstructionChange || onSsmlToggle || onMarkdownFilterToggle) && (
        <>
          <div className={styles.divider} />
          <button className={styles.advancedToggle} onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? '收起' : '更多'}
          </button>
        </>
      )}

      {/* Hint */}
      <div className={styles.hint}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        仅影响新段落
      </div>

      {/* Advanced params row */}
      {showAdvanced && (
        <div className={styles.advancedRow}>
          {onInstructionChange && (
            <div className={styles.advancedSection}>
              <span className={styles.paramLabel}>复刻指令</span>
              <input
                type="text"
                className={styles.instructionInput}
                value={instruction || ''}
                maxLength={50}
                placeholder="输入复刻指令..."
                onChange={e => onInstructionChange(e.target.value)}
              />
            </div>
          )}
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
  );
}
