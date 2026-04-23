import { useState, useEffect } from 'react';
import { ttsApi } from '../../services/api';
import type { VoiceProfile } from '../../types';
import styles from './VoiceSelector.module.css';

interface VoiceSelectorProps {
  selectedVoiceId: string;
  onVoiceSelect: (voiceId: string) => void;
  onDelete?: (voiceId: string) => void;
}

export function VoiceSelector({ selectedVoiceId, onVoiceSelect, onDelete }: VoiceSelectorProps) {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadVoices = async () => {
      try {
        const data = await ttsApi.getVoices();
        setVoices(data);
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
  }, []);

  if (isLoading) {
    return <div className={styles.loading}>加载声音列表...</div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (voices.length === 0) {
    return <div className={styles.empty}>暂无克隆声音，请先在"声音克隆"页面上传音频</div>;
  }

  return (
    <div className={styles.container}>
      <h3>选择声音</h3>
      <div className={styles.voiceList}>
        {voices.map(voice => {
          const voiceKey = voice.qwen_voice_id || voice.id;
          return (
            <button
              key={voice.id}
              data-testid={`voice-${voice.id}`}
              className={`${styles.voice} ${selectedVoiceId === voiceKey ? styles.active : ''}`}
              onClick={() => onVoiceSelect(voiceKey)}
            >
              <span className={styles.name}>{voice.name}</span>
              <span className={styles.tag}>克隆</span>
              {onDelete && (
                <span
                  className={styles.deleteBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('确定删除这个声音？')) onDelete(voice.id);
                  }}
                >
                  ×
                </span>
              )}
              {onDelete && (
                <span
                  className={styles.deleteBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('确定删除这个声音？')) onDelete(voice.profileId);
                  }}
                >
                  ×
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
