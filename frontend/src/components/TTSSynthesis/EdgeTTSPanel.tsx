import { useState, useEffect, useCallback } from 'react';
import { ttsApi } from '../../services/api';
import type { EdgeVoice } from '../../types';
import styles from './EdgeTTSPanel.module.css';

interface EdgeTTSPanelProps {
  selectedVoice: string;
  onVoiceSelect: (voice: string) => void;
}

/** 性别筛选选项，空字符串表示全部 */
const GENDER_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'Female', label: '女声' },
  { value: 'Male', label: '男声' },
] as const;

export function EdgeTTSPanel({ selectedVoice, onVoiceSelect }: EdgeTTSPanelProps) {
  const [languages, setLanguages] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('Chinese');
  const [selectedGender, setSelectedGender] = useState('');
  const [voices, setVoices] = useState<EdgeVoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

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
      // 当前选项不在新列表时自动选第一个
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

  return (
    <div className={styles.container}>
      {/* 筛选条件：语言 + 性别 */}
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

      {/* 声音下拉选择 */}
      <div className={styles.voiceSelect}>
        <label>选择音色</label>
        {isLoading ? (
          <div className={styles.loading}>加载音色列表...</div>
        ) : error ? (
          <div className={styles.error}>{error}</div>
        ) : voices.length === 0 ? (
          <div className={styles.empty}>未找到音色</div>
        ) : (
          <select
            className={styles.select}
            value={selectedVoice || ''}
            onChange={(e) => onVoiceSelect(e.target.value)}
            data-testid="edge-voice-select"
          >
            {!selectedVoice && (
              <option value="" disabled>请选择音色...</option>
            )}
            {voices.map(voice => (
              <option key={voice.short_name} value={voice.short_name}>
                {voice.display_name} ({voice.locale} · {voice.gender === 'Female' ? '女' : '男'})
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}