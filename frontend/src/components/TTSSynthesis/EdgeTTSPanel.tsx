import { useState, useEffect, useCallback } from 'react';
import { ttsApi } from '../../services/api';
import type { EdgeVoice } from '../../types';
import styles from './EdgeTTSPanel.module.css';

interface EdgeTTSPanelProps {
  selectedVoice: string;
  onVoiceSelect: (voice: string) => void;
  rate?: number;
  volume?: number;
  onRateChange?: (v: number) => void;
  onVolumeChange?: (v: number) => void;
}

const GENDER_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'Female', label: '女声' },
  { value: 'Male', label: '男声' },
] as const;

export function EdgeTTSPanel({ selectedVoice, onVoiceSelect, rate, volume, onRateChange, onVolumeChange }: EdgeTTSPanelProps) {
  const [languages, setLanguages] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('Chinese');
  const [selectedGender, setSelectedGender] = useState('');
  const [voices, setVoices] = useState<EdgeVoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    ttsApi.getEdgeLanguages().then(setLanguages).catch(() => {});
  }, []);

  const loadVoices = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await ttsApi.getEdgeVoices(selectedLanguage || undefined, selectedGender || undefined);
      setVoices(data);
      if (data.length > 0 && !data.some(v => v.short_name === selectedVoice)) {
        onVoiceSelect(data[0].short_name);
      }
    } catch (err) { console.error('Failed to load edge voices:', err); }
    finally { setIsLoading(false); }
  }, [selectedLanguage, selectedGender, selectedVoice, onVoiceSelect]);

  useEffect(() => { loadVoices(); }, [loadVoices]);

  return (
    <div className={styles.bar}>
      {/* Language */}
      <div className={styles.section}>
        <span className={styles.label}>语言</span>
        <select className={styles.select} value={selectedLanguage} onChange={e => setSelectedLanguage(e.target.value)}>
          {languages.map(lang => <option key={lang} value={lang}>{lang}</option>)}
        </select>
      </div>

      <div className={styles.divider} />

      {/* Gender */}
      <div className={styles.section}>
        <span className={styles.label}>性别</span>
        <div className={styles.pillGroup}>
          {GENDER_OPTIONS.map(opt => (
            <button key={opt.value} className={`${styles.pill} ${selectedGender === opt.value ? styles.pillActive : ''}`}
              onClick={() => setSelectedGender(opt.value)}>{opt.label}</button>
          ))}
        </div>
      </div>

      <div className={styles.divider} />

      {/* Voice */}
      <div className={styles.section}>
        <span className={styles.label}>音色</span>
        {isLoading ? (
          <span className={styles.loadingText}>加载中...</span>
        ) : (
          <select className={styles.select} value={selectedVoice || ''} onChange={e => onVoiceSelect(e.target.value)}>
            {voices.map(v => (
              <option key={v.short_name} value={v.short_name}>
                {v.display_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Rate + Volume (if provided) */}
      {onRateChange && (
        <>
          <div className={styles.divider} />
          <div className={styles.section}>
            <span className={styles.label}>语速</span>
            <div className={styles.sliderWrap}>
              <input type="range" min={-50} max={50} step={5} value={rate ?? 0}
                className={styles.range} onChange={e => onRateChange(parseInt(e.target.value))} />
            </div>
            <span className={styles.paramValue}>{rate ?? 0}%</span>
          </div>
        </>
      )}
      {onVolumeChange && (
        <>
          <div className={styles.section}>
            <span className={styles.label}>音量</span>
            <div className={styles.sliderWrap}>
              <input type="range" min={-50} max={50} step={5} value={volume ?? 0}
                className={styles.range} onChange={e => onVolumeChange(parseInt(e.target.value))} />
            </div>
            <span className={styles.paramValue}>{volume ?? 0}%</span>
          </div>
        </>
      )}
    </div>
  );
}
