import { useState, useCallback, useEffect } from 'react';
import { VoiceSelector } from '../components/TTSSynthesis/VoiceSelector';
import { ParameterControls } from '../components/TTSSynthesis/ParameterControls';
import { AudioPlayer } from '../components/TTSSynthesis/AudioPlayer';
import { SynthesisHistory } from '../components/TTSSynthesis/SynthesisHistory';
import { EdgeTTSPanel } from '../components/TTSSynthesis/EdgeTTSPanel';
import { ttsApi, voiceApi } from '../services/api';
import type { TTSRequest, TTSResult, TTSResultRecord } from '../types';
import styles from './TTSSynthesis.module.css';

type Engine = 'cosyvoice' | 'edge_tts';

export function TTSSynthesis() {
  const [engine, setEngine] = useState<Engine>('cosyvoice');
  const [text, setText] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('');
  const [params, setParams] = useState<Partial<TTSRequest>>({
    language: 'Chinese',
    speed: 1.0,
    volume: 80,
    pitch: 0,
    emotion: undefined,
  });

  // Edge-TTS state
  const [edgeVoice, setEdgeVoice] = useState('');
  const [edgeParams, setEdgeParams] = useState({ edge_rate: '+0%', edge_volume: '+0%' });

  const [result, setResult] = useState<TTSResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<TTSResultRecord[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await ttsApi.getHistory();
      setHistory(data);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleSynthesize = useCallback(async () => {
    if (!text.trim()) {
      alert('请输入要合成的文本');
      return;
    }

    if (engine === 'cosyvoice' && !selectedVoiceId) {
      alert('请选择一个声音');
      return;
    }

    if (engine === 'edge_tts' && !edgeVoice) {
      alert('请选择一个音色');
      return;
    }

    try {
      setIsLoading(true);
      setResult(null);

      if (engine === 'edge_tts') {
        const response = await ttsApi.synthesize({
          text,
          engine: 'edge_tts',
          voice_id: '',
          edge_voice: edgeVoice,
          edge_rate: edgeParams.edge_rate,
          edge_volume: edgeParams.edge_volume,
          format: 'mp3',
        });
        setResult(response);
      } else {
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
      }

      loadHistory();
    } catch (error) {
      console.error('TTS synthesis failed:', error);
      alert('生成语音失败，请重试');
    } finally {
      setIsLoading(false);
    }
  }, [text, engine, selectedVoiceId, edgeVoice, edgeParams, params, loadHistory]);

  const handleDeleteResult = useCallback(async (id: string) => {
    try {
      await ttsApi.deleteResult(id);
      setHistory(prev => prev.filter(r => r.id !== id));
    } catch (error) {
      console.error('Failed to delete result:', error);
      alert('删除失败');
    }
  }, []);

  const handlePlayResult = useCallback((record: TTSResultRecord) => {
    setResult({
      audio_id: record.id,
      audio_url: record.audio_url,
      text: record.text,
      params: {
        voice_id: record.voice_id,
        speed: record.speed,
        volume: record.volume,
        pitch: record.pitch,
        language: record.language,
        emotion: record.emotion,
      },
    });
  }, []);

  const handleDeleteVoice = useCallback(async (profileId: string) => {
    try {
      await voiceApi.delete(profileId);
      setSelectedVoiceId('');
    } catch (error) {
      console.error('Failed to delete voice:', error);
      alert('删除声音失败');
    }
  }, []);

  const canSynthesize = engine === 'edge_tts'
    ? text.trim() && edgeVoice
    : text.trim() && selectedVoiceId;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>文字转语音</h1>
        <p>使用克隆的声音生成语音</p>
      </div>

      {/* Engine Selector */}
      <div className={styles.engineTabs}>
        <button
          className={`${styles.engineTab} ${engine === 'cosyvoice' ? styles.active : ''}`}
          onClick={() => setEngine('cosyvoice')}
        >
          CosyVoice
        </button>
        <button
          className={`${styles.engineTab} ${engine === 'edge_tts' ? styles.active : ''}`}
          onClick={() => setEngine('edge_tts')}
        >
          Edge-TTS
        </button>
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

          {/* Voice Selection - engine dependent */}
          {engine === 'cosyvoice' ? (
            <VoiceSelector
              selectedVoiceId={selectedVoiceId}
              onVoiceSelect={setSelectedVoiceId}
              onDelete={handleDeleteVoice}
            />
          ) : (
            <EdgeTTSPanel
              selectedVoice={edgeVoice}
              onVoiceSelect={setEdgeVoice}
              onParamsChange={setEdgeParams}
            />
          )}
        </div>

        {/* Right Column: Params & Player & History */}
        <div className={styles.rightColumn}>
          {/* Parameter Controls (CosyVoice only) */}
          {engine === 'cosyvoice' && (
            <ParameterControls
              params={params}
              onParamChange={setParams}
            />
          )}

          {/* Generate Button */}
          <button
            onClick={handleSynthesize}
            disabled={isLoading || !canSynthesize}
            className={styles.generateButton}
          >
            {isLoading ? '生成中...' : '生成语音'}
          </button>

          {/* Audio Player */}
          <AudioPlayer result={result} isLoading={isLoading} />

          {/* Synthesis History */}
          <SynthesisHistory
            results={history}
            onDelete={handleDeleteResult}
            onPlay={handlePlayResult}
          />
        </div>
      </div>
    </div>
  );
}
