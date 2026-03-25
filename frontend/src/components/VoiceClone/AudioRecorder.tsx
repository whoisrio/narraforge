import { useState, useRef } from 'react';
import { voiceApi } from '../../services/api';
import { Button, Card } from '../ui';

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

  const recordingIndicatorStyle = {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 'var(--spacing-sm)',
    marginBottom: 'var(--spacing-md)',
    color: 'var(--color-danger)',
    fontWeight: 'var(--font-weight-medium)',
  };

  const pulsingDotStyle = {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    backgroundColor: 'var(--color-danger)',
    animation: 'pulse 1s infinite',
  };

  return (
    <Card>
      <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)' }}>🎙️ Real-time Recording</h3>

      {!recording && !audioBlob && (
        <Button variant="danger" fullWidth onClick={startRecording}>
          Start Recording
        </Button>
      )}

      {recording && (
        <div>
          <div style={recordingIndicatorStyle}>
            <span style={pulsingDotStyle} />
            Recording...
          </div>
          <Button variant="secondary" fullWidth onClick={stopRecording}>
            Stop
          </Button>
        </div>
      )}

      {audioBlob && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <audio src={URL.createObjectURL(audioBlob)} controls style={{ width: '100%', margin: 0 }} />
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
            <Button variant="primary" onClick={uploadRecording}>
              Upload
            </Button>
            <Button variant="ghost" onClick={() => setAudioBlob(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
