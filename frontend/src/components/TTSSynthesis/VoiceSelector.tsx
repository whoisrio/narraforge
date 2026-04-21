import { useState, useEffect } from 'react';
import { ttsApi } from '../../services/api';
import type { DefaultVoice } from '../../types';
import styles from './VoiceSelector.module.css';

interface VoiceSelectorProps {
  selectedVoiceId: string;
  onVoiceSelect: (voiceId: string, isCloned: boolean) => void;
}

export function VoiceSelector({ selectedVoiceId, onVoiceSelect }: VoiceSelectorProps) {
  const [defaultVoices, setDefaultVoices] = useState<DefaultVoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadVoices = async () => {
      try {
        const { default: defaultVoicesData } = await ttsApi.getVoices();
        setDefaultVoices(defaultVoicesData);
      } catch (error) {
        console.error('Failed to load voices:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadVoices();
  }, []);

  if (isLoading) {
    return <div className={styles.loading}>加载声音列表...</div>;
  }

  return (
    <div className={styles.container}>
      <h3>选择声音</h3>
      <div className={styles.group}>
        <h4>默认声音</h4>
        <div className={styles.voiceList}>
          {defaultVoices.map(voice => (
            <button
              key={voice.id}
              data-testid={`voice-${voice.id}`}
              className={`${styles.voice} ${selectedVoiceId === voice.id ? styles.active : ''}`}
              onClick={() => onVoiceSelect(voice.id, false)}
            >
              <span className={styles.name}>{voice.name}</span>
              <span className={styles.gender}>{voice.gender === 'male' ? '男' : '女'}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
