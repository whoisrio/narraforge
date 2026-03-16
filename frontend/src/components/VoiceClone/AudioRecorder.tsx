import { useState, useRef } from 'react';
import { voiceApi } from '../../services/api';

interface AudioRecorderProps {
  onRecordComplete?: () => void;
}

export function AudioRecorder({ onRecordComplete }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      chunks.current = [];

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.current.push(e.data);
        }
      };

      mediaRecorder.current.onstop = async () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.current.start();
      setRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
      alert('Failed to access microphone');
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    setRecording(false);
  };

  const uploadRecording = async () => {
    if (!audioBlob) return;

    const file = new File([audioBlob], 'recording.webm', { type: 'audio/webm' });
    try {
      await voiceApi.upload(file);
      setAudioBlob(null);
      onRecordComplete?.();
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Upload failed');
    }
  };

  return (
    <div style={{ padding: '16px', border: '1px solid #eee', borderRadius: '8px' }}>
      <h3>🎙️ Real-time Recording</h3>

      {!recording && !audioBlob && (
        <button
          onClick={startRecording}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            background: '#e53935',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Start Recording
        </button>
      )}

      {recording && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'red', animation: 'pulse 1s infinite' }} />
            Recording...
          </div>
          <button
            onClick={stopRecording}
            style={{
              padding: '12px 24px',
              fontSize: '16px',
              background: '#666',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Stop
          </button>
        </div>
      )}

      {audioBlob && (
        <div>
          <audio src={URL.createObjectURL(audioBlob)} controls style={{ width: '100%', margin: '12px 0' }} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={uploadRecording}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                background: '#4caf50',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Upload
            </button>
            <button
              onClick={() => setAudioBlob(null)}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                background: '#666',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}