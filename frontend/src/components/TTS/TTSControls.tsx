import { useState, useEffect } from 'react';
import { ttsApi, voiceApi } from '../../services/api';
import type { TTSRequest, TTSResult, VoiceProfile } from '../../types';
import { Button, Input, Select, Slider, Card, Alert } from '../ui';

interface TTSControlsProps {
  onSynthesize?: (result: TTSResult) => void;
}

interface Tab {
  id: 'standard' | 'cloned';
  label: string;
  icon: string;
}

export function TTSControls({ onSynthesize }: TTSControlsProps) {
  const [text, setText] = useState('');
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(80);
  const [pitch, setPitch] = useState(0);
  const [emotion, setEmotion] = useState('neutral');
  const [synthesizing, setSynthesizing] = useState(false);
  const [result, setResult] = useState<TTSResult | null>(null);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('xiaoyun');
  const [useClonedVoice, setUseClonedVoice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVoices = async () => {
    try {
      const list = await voiceApi.list();
      setVoices(list);
      const clonedVoice = list.find(v => v.is_cloned && v.qwen_voice_id);
      if (clonedVoice) {
        setSelectedVoiceId(clonedVoice.qwen_voice_id!);
        setUseClonedVoice(true);
      }
    } catch (err) {
      console.error('Failed to load voices:', err);
    }
  };

  useEffect(() => {
    loadVoices();
  }, []);

  const handleSynthesize = async () => {
    if (!text.trim()) return;

    setSynthesizing(true);
    setError(null);
    try {
      const request: TTSRequest = {
        text,
        speed,
        volume,
        pitch,
        emotion,
        voice_id: selectedVoiceId,
      };
      const res = await ttsApi.synthesize(request);
      setResult(res);
      onSynthesize?.(res);
    } catch (err) {
      console.error('Synthesis failed:', err);
      setError('Synthesis failed');
    } finally {
      setSynthesizing(false);
    }
  };

  const tabs: Tab[] = [
    { id: 'standard', label: 'Standard Voices', icon: '📢' },
    { id: 'cloned', label: 'Cloned Voices', icon: '🎤' },
  ];

  const handleTabChange = (tabId: string) => {
    if (tabId === 'standard') {
      setUseClonedVoice(false);
      setSelectedVoiceId('xiaoyun');
    } else {
      const clonedVoice = voices.find(v => v.is_cloned && v.qwen_voice_id);
      if (clonedVoice) {
        setUseClonedVoice(true);
        setSelectedVoiceId(clonedVoice.qwen_voice_id!);
      }
    }
  };

  const standardVoices = [
    { value: 'xiaoyun', label: '云溪 (Xiaoyun) - Female' },
    { value: 'xiaoyuan', label: '晓晓 (Xiaoyuan) - Female' },
    { value: 'ruoxi', label: '若曦 (Ruoxi) - Female' },
    { value: 'xiaogang', label: '小刚 (Xiaogang) - Male' },
    { value: 'yunjian', label: '云健 (Yunjian) - Male' },
  ];

  const clonedVoiceOptions = voices
    .filter(v => v.is_cloned && v.qwen_voice_id)
    .map(voice => ({ value: voice.qwen_voice_id!, label: `${voice.name} (Cloned)` }));

  const currentVoiceOptions = useClonedVoice ? clonedVoiceOptions : standardVoices;

  const emotionOptions = [
    { value: 'neutral', label: 'Neutral' },
    { value: 'happy', label: 'Happy' },
    { value: 'sad', label: 'Sad' },
    { value: 'excited', label: 'Excited' },
  ];

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--spacing-md)',
  };

  const h3Style: React.CSSProperties = {
    margin: 0,
    fontSize: 'var(--font-size-lg)',
    fontWeight: 'var(--font-weight-semibold)',
  };

  const tabsContainerStyle: React.CSSProperties = {
    marginBottom: 'var(--spacing-md)',
  };

  const textareaContainerStyle: React.CSSProperties = {
    marginBottom: 'var(--spacing-md)',
  };

  const controlsContainerStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 'var(--spacing-md)',
    marginBottom: 'var(--spacing-md)',
  };

  const resultStyle: React.CSSProperties = {
    marginTop: 'var(--spacing-md)',
  };

  return (
    <Card>
      <div style={headerStyle}>
        <h3 style={h3Style}>🔊 Text to Speech</h3>
      </div>

      <div style={tabsContainerStyle}>
        <Tabs
          tabs={tabs}
          activeTab={useClonedVoice ? 'cloned' : 'standard'}
          onChange={handleTabChange}
        />
      </div>

      <Select
        label="Voice Selection"
        options={currentVoiceOptions}
        value={selectedVoiceId}
        onChange={(e) => setSelectedVoiceId(e.target.value as string)}
        disabled={useClonedVoice && clonedVoiceOptions.length === 0}
      />

      {useClonedVoice && clonedVoiceOptions.length === 0 && (
        <Alert variant="warning">
          ⚠️ No cloned voices available. Please clone a voice first in the Voice Clone tab.
        </Alert>
      )}

      <div style={textareaContainerStyle}>
        <Input
          label="Text"
          type="textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter text to convert to speech..."
        />
      </div>

      <div style={controlsContainerStyle}>
        <Slider
          label="Speed"
          value={speed}
          onChange={setSpeed}
          min={0.5}
          max={2}
          step={0.1}
        />

        <Slider
          label="Volume"
          value={volume}
          onChange={setVolume}
          min={0}
          max={100}
          step={5}
        />

        <Slider
          label="Pitch"
          value={pitch}
          onChange={(val) => setPitch(val as number)}
          min={-12}
          max={12}
          step={1}
        />

        <Select
          label="Emotion"
          options={emotionOptions}
          value={emotion}
          onChange={(e) => setEmotion(e.target.value as string)}
        />
      </div>

      <Button
        variant="primary"
        fullWidth
        onClick={handleSynthesize}
        loading={synthesizing}
        disabled={!text.trim()}
      >
        {synthesizing ? 'Synthesizing...' : 'Generate Speech'}
      </Button>

      {error && (
        <Alert variant="error" style={{ marginTop: 'var(--spacing-md)' }}>
          {error}
        </Alert>
      )}

      {result && (
        <div style={resultStyle}>
          <audio src={result.audio_url} controls style={{ width: '100%' }} />
          <div style={{ marginTop: 'var(--spacing-sm)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            Params: speed={result.params.speed}, volume={result.params.volume}, pitch={result.params.pitch}, emotion={result.params.emotion}
          </div>
        </div>
      )}
    </Card>
  );
}
