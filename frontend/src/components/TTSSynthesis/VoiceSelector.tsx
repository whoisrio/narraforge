import { useState, useEffect } from 'react';
import { ttsApi } from '../../services/api';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
import type { VoiceProfile } from '../../types';
import styles from './VoiceSelector.module.css';

interface VoiceSelectorProps {
  selectedVoiceId: string;
  onVoiceSelect: (voiceId: string) => void;
}

export function VoiceSelector({ selectedVoiceId, onVoiceSelect }: VoiceSelectorProps) {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const { refreshCounter } = useVoiceRefresh();

  // refreshCounter 变化时重新拉取，确保 clone/delete/update description 后列表同步
  useEffect(() => {
    const loadVoices = async () => {
      try {
        const data = await ttsApi.getVoices();
        setVoices(data);
        // 未选择声音时，自动选中第一个
        if (data.length > 0 && !selectedVoiceId) {
          onVoiceSelect(data[0].qwen_voice_id || data[0].id);
        }
      } catch (err) {
        setError('加载声音列表失败');
        console.error('Failed to load voices:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadVoices();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshCounter]);

  if (isLoading) {
    return <div className={styles.loading}>加载声音列表...</div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (voices.length === 0) {
    return <div className={styles.empty}>暂无克隆声音，请先在"声音复刻"页面上传音频</div>;
  }

  return (
    <div className={styles.container}>
      <label htmlFor="voice-select" className={styles.label}>选择声音</label>
      <select
        id="voice-select"
        className={styles.select}
        value={selectedVoiceId || ''}
        onChange={(e) => onVoiceSelect(e.target.value)}
        data-testid="voice-select"
      >
        {!selectedVoiceId && (
          <option value="" disabled>请选择声音...</option>
        )}
        {voices.map(voice => {
          const voiceKey = voice.qwen_voice_id || voice.id;
          return (
            <option key={voice.id} value={voiceKey}>
              {voice.name} · 克隆
            </option>
          );
        })}
      </select>
    </div>
  );
}