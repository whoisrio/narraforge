import { useState } from 'react';
import { ttsApi } from '../../services/api';
import type { TTSRequest, TTSResult } from '../../types';

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