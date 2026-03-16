import { useState, useEffect } from 'react';
import { ttsApi, voiceApi } from '../../services/api';
import type { TTSRequest, TTSResult, VoiceProfile } from '../../types';

interface TTSControlsProps {
  onSynthesize?: (result: TTSResult) => void;
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

  // 加载可用的克隆声音列表
  useEffect(() => {
    const loadVoices = async () => {
      try {
        const list = await voiceApi.list();
        setVoices(list);
        // 如果有已克隆的声音，默认选择第一个
        const clonedVoice = list.find(v => v.is_cloned && v.qwen_voice_id);
        if (clonedVoice) {
          setSelectedVoiceId(clonedVoice.qwen_voice_id!);
          setUseClonedVoice(true);
        }
      } catch (err) {
        console.error('Failed to load voices:', err);
      }
    };
    loadVoices();
  }, []);

  const handleSynthesize = async () => {
    if (!text.trim()) return;

    setSynthesizing(true);
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
      alert('Synthesis failed');
    } finally {
      setSynthesizing(false);
    }
  };

  return (
    <div style={{ padding: '16px', border: '1px solid #eee', borderRadius: '8px' }}>
      <h3>🔊 Text to Speech</h3>

      {/* 音色选择器 */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
          🔉 Voice Selection
        </label>
        
        {/* 音色类型切换 */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <button
            onClick={() => {
              setUseClonedVoice(false);
              setSelectedVoiceId('xiaoyun');
            }}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              background: !useClonedVoice ? '#1976d2' : 'white',
              color: !useClonedVoice ? 'white' : '#666',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            📢 Standard Voices
          </button>
          <button
            onClick={() => {
              const clonedVoice = voices.find(v => v.is_cloned && v.qwen_voice_id);
              if (clonedVoice) {
                setUseClonedVoice(true);
                setSelectedVoiceId(clonedVoice.qwen_voice_id!);
              }
            }}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              background: useClonedVoice ? '#1976d2' : 'white',
              color: useClonedVoice ? 'white' : '#666',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
              opacity: voices.some(v => v.is_cloned && v.qwen_voice_id) ? 1 : 0.5,
            }}
            disabled={!voices.some(v => v.is_cloned && v.qwen_voice_id)}
          >
            🎤 Cloned Voices
          </button>
        </div>

        {/* 音色下拉选择 */}
        <select
          value={selectedVoiceId}
          onChange={(e) => setSelectedVoiceId(e.target.value)}
          style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ddd', fontSize: '14px' }}
        >
          {!useClonedVoice ? (
            <>
              <option value="xiaoyun">云溪 (Xiaoyun) - Female</option>
              <option value="xiaoyuan">晓晓 (Xiaoyuan) - Female</option>
              <option value="ruoxi">若曦 (Ruoxi) - Female</option>
              <option value="xiaogang">小刚 (Xiaogang) - Male</option>
              <option value="yunjian">云健 (Yunjian) - Male</option>
            </>
          ) : (
            voices.filter(v => v.is_cloned && v.qwen_voice_id).map((voice) => (
              <option key={voice.id} value={voice.qwen_voice_id}>
                {voice.name} (Cloned)
              </option>
            ))
          )}
        </select>
        
        {useClonedVoice && voices.filter(v => v.is_cloned && v.qwen_voice_id).length === 0 && (
          <div style={{ marginTop: '8px', padding: '8px', background: '#fff3cd', borderRadius: '4px', fontSize: '13px', color: '#856404' }}>
            ⚠️ No cloned voices available. Please clone a voice first in the Voice Clone tab.
          </div>
        )}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Enter text to convert to speech..."
        rows={4}
        style={{
          width: '100%',
          padding: '12px',
          border: '1px solid #ddd',
          borderRadius: '4px',
          fontSize: '14px',
          resize: 'vertical',
          marginBottom: '16px',
        }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
            Speed: {speed}
          </label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
            Volume: {volume}
          </label>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
            Pitch: {pitch}
          </label>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            value={pitch}
            onChange={(e) => setPitch(parseInt(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
            Emotion
          </label>
          <select
            value={emotion}
            onChange={(e) => setEmotion(e.target.value)}
            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
          >
            <option value="neutral">Neutral</option>
            <option value="happy">Happy</option>
            <option value="sad">Sad</option>
            <option value="excited">Excited</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleSynthesize}
        disabled={synthesizing || !text.trim()}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: '16px',
          background: synthesizing ? '#ccc' : '#1976d2',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: synthesizing ? 'wait' : 'pointer',
        }}
      >
        {synthesizing ? 'Synthesizing...' : 'Generate Speech'}
      </button>

      {result && (
        <div style={{ marginTop: '16px', padding: '12px', background: '#f5f5f5', borderRadius: '4px' }}>
          <audio src={result.audio_url} controls style={{ width: '100%' }} />
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
            Params: speed={result.params.speed}, volume={result.params.volume}, pitch={result.params.pitch}, emotion={result.params.emotion}
          </div>
        </div>
      )}
    </div>
  );
}