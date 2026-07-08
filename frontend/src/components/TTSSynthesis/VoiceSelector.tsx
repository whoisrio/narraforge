import { useState, useEffect } from 'react';
import { ttsApi } from '../../services/api';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
import type { VoiceProfile } from '../../types';
import { useTranslation } from '../../i18n';
import styles from './VoiceSelector.module.css';

interface VoiceSelectorProps {
  selectedVoiceId: string;
  onVoiceSelect: (voiceId: string) => void;
}

export function VoiceSelector({ selectedVoiceId, onVoiceSelect }: VoiceSelectorProps) {
  const { t } = useTranslation();
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
          const voiceKey = (data[0].voice_params?.cosyvoice?.params as Record<string, unknown>)?.voice_id as string || data[0].id;
          onVoiceSelect(voiceKey);
        }
      } catch (err) {
        setError(t('voiceSelector.loadVoicesFailed'));
        console.error('Failed to load voices:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadVoices();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshCounter]);

  if (isLoading) {
    return <div className={styles.loading}>{t('voiceSelector.loadingVoices')}</div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (voices.length === 0) {
    return <div className={styles.empty}>{t('voiceSelector.noCloneVoices')}</div>;
  }

  return (
    <div className={styles.container}>
      <label htmlFor="voice-select" className={styles.label}>{t('voiceSelector.selectVoice')}</label>
      <select
        id="voice-select"
        className={styles.select}
        value={selectedVoiceId || ''}
        onChange={(e) => onVoiceSelect(e.target.value)}
        data-testid="voice-select"
      >
        {!selectedVoiceId && (
          <option value="" disabled>{t('voiceSelector.pleaseSelectVoice')}</option>
        )}
        {voices.map(voice => {
          const voiceKey = (voice.voice_params?.cosyvoice?.params as Record<string, unknown>)?.voice_id as string || voice.id;
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