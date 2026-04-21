import { useState, useCallback } from 'react';
import { VoiceSelector } from '../components/TTSSynthesis/VoiceSelector';
import { ParameterControls } from '../components/TTSSynthesis/ParameterControls';
import { AudioPlayer } from '../components/TTSSynthesis/AudioPlayer';
import { ttsApi } from '../services/api';
import type { TTSRequest, TTSResult } from '../types';
import styles from './TTSSynthesis.module.css';

export function TTSSynthesis() {
  const [text, setText] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('xiaoyun');
  const [isClonedVoice, setIsClonedVoice] = useState(false);
  const [params, setParams] = useState<Partial<TTSRequest>>({
    language: 'Chinese',
    speed: 1.0,
    volume: 80,
    pitch: 0,
    emotion: undefined,
  });
  const [result, setResult] = useState<TTSResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleVoiceSelect = useCallback((voiceId: string, cloned: boolean) => {
    setSelectedVoiceId(voiceId);
    setIsClonedVoice(cloned);
  }, []);

  const handleSynthesize = useCallback(async () => {
    if (!text.trim()) {
      alert('请输入要合成的文本');
      return;
    }

    if (!selectedVoiceId) {
      alert('请选择一个声音');
      return;
    }

    try {
      setIsLoading(true);
      setResult(null);

      const response = await ttsApi.synthesize({
        text,
        voice_id: selectedVoiceId,
        language: params.language || 'Chinese',
        speed: params.speed ?? 1.0,
        volume: params.volume ?? 80,
        pitch: params.pitch ?? 0,
        emotion: params.emotion,
        format: 'mp3',
      });

      setResult(response);
    } catch (error) {
      console.error('TTS synthesis failed:', error);
      alert('生成语音失败，请重试');
    } finally {
      setIsLoading(false);
    }
  }, [text, selectedVoiceId, params]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>文字转语音</h1>
        <p>使用你克隆的声音或默认声音生成语音</p>
      </div>

      <div className={styles.content}>
        {/* Left Column: Input & Voice */}
        <div className={styles.leftColumn}>
          {/* Text Input */}
          <div className={styles.textSection}>
            <textarea
              className={styles.textarea}
              placeholder="输入要合成的文字..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
            />
            <div className={styles.textInfo}>
              <span>{text.length} 字符</span>
              <button
                onClick={() => setText('')}
                disabled={!text}
                className={styles.clearButton}
              >
                清空
              </button>
            </div>
          </div>

          {/* Voice Selector */}
          <VoiceSelector
            selectedVoiceId={selectedVoiceId}
            onVoiceSelect={handleVoiceSelect}
          />
        </div>

        {/* Right Column: Params & Player */}
        <div className={styles.rightColumn}>
          {/* Parameter Controls */}
          <ParameterControls
            params={params}
            onParamChange={setParams}
          />

          {/* Generate Button */}
          <button
            onClick={handleSynthesize}
            disabled={isLoading || !text.trim()}
            className={styles.generateButton}
          >
            {isLoading ? '生成中...' : '生成语音'}
          </button>

          {/* Audio Player */}
          <AudioPlayer result={result} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}
