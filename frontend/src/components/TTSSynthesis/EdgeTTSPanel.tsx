import { useState, useEffect, useCallback } from 'react';
import { ttsApi } from '../../services/api';
import type { EdgeVoice } from '../../types';
import styles from './EdgeTTSPanel.module.css';

interface EdgeTTSPanelProps {
  onVoiceSelect: (voice: string) => void;
  onParamsChange: (params: { edge_rate: string; edge_volume: string }) => void;
  selectedVoice: string;
}

const GENDER_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'Female', label: '女声' },
  { value: 'Male', label: '男声' },
] as const;

export function EdgeTTSPanel({ onVoiceSelect, onParamsChange, selectedVoice }: EdgeTTSPanelProps) {
  const [languages, setLanguages] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('Chinese');
  const [selectedGender, setSelectedGender] = useState('');
  const [voices, setVoices] = useState<EdgeVoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [rate, setRate] = useState(0);
  const [volume, setVolume] = useState(0);

  useEffect(() => {
    const loadLanguages = async () => {
      try {
        const langs = await ttsApi.getEdgeLanguages();
        setLanguages(langs);
      } catch (err) {
        console.error('Failed to load edge-tts languages:', err);
      }
    };
    loadLanguages();
  }, []);

  const loadVoices = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await ttsApi.getEdgeVoices(
        selectedLanguage || undefined,
        selectedGender || undefined,
      );
      setVoices(data);
      if (data.length > 0 && !data.some(v => v.short_name === selectedVoice)) {
        onVoiceSelect(data[0].short_name);
      }
    } catch (err) {
      setError('加载音色列表失败');
      console.error('Failed to load edge voices:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedLanguage, selectedGender, selectedVoice, onVoiceSelect]);

  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  const toEdgeFormat = (value: number) => value >= 0 ? `+${value}%` : `${value}%`;

  const handleRateChange = (newRate: number) => {
    setRate(newRate);
    onParamsChange({ edge_rate: toEdgeFormat(newRate), edge_volume: toEdgeFormat(volume) });
  };

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    onParamsChange({ edge_rate: toEdgeFormat(rate), edge_volume: toEdgeFormat(newVolume) });
  };

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <h3>选择音色</h3>

        <div className={styles.filters}>
          <div className={styles.filter}>
            <label>语言</label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
            >
              {languages.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>

          <div className={styles.filter}>
            <label>性别</label>
            <select
              value={selectedGender}
              onChange={(e) => setSelectedGender(e.target.value)}
            >
              {GENDER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className={styles.loading}>加载音色列表...</div>
        ) : error ? (
          <div className={styles.error}>{error}</div>
        ) : voices.length === 0 ? (
          <div className={styles.empty}>未找到音色</div>
        ) : (
          <div className={styles.voiceGrid}>
            {voices.map(voice => (
              <button
                key={voice.short_name}
                className={`${styles.voiceCard} ${selectedVoice === voice.short_name ? styles.active : ''}`}
                onClick={() => onVoiceSelect(voice.short_name)}
              >
                <span className={styles.voiceName}>{voice.display_name}</span>
                <span className={styles.voiceLocale}>{voice.locale}</span>
                <span className={styles.voiceGender}>{voice.gender === 'Female' ? '女' : '男'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h3>参数设置</h3>
        <div className={styles.params}>
          <div className={styles.param}>
            <label>语速: {toEdgeFormat(rate)}</label>
            <input
              type="range"
              min={-50}
              max={100}
              step={5}
              value={rate}
              onChange={(e) => handleRateChange(parseInt(e.target.value))}
            />
          </div>
          <div className={styles.param}>
            <label>音量: {toEdgeFormat(volume)}</label>
            <input
              type="range"
              min={-50}
              max={100}
              step={5}
              value={volume}
              onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
