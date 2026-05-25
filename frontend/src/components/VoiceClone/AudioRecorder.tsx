import { useState, useRef } from 'react';
import { Button, Card } from '../ui';

interface AudioRecorderProps {
  /** 录制完成后回调，传递构建好的 File 对象 */
  onRecordComplete?: (file: File) => void;
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

      mediaRecorder.current.onstop = () => {
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

  /** 确认录制，构建 File 对象交给父组件处理 */
  const confirmRecording = () => {
    if (!audioBlob) return;
    const file = new File([audioBlob], 'recording.webm', { type: 'audio/webm' });
    onRecordComplete?.(file);
    setAudioBlob(null);
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
      <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>🎙️ 实时录制</h3>

      {!recording && !audioBlob && (
        <Button variant="danger" fullWidth onClick={startRecording}>
          开始录制
        </Button>
      )}

      {recording && (
        <div>
          <div style={recordingIndicatorStyle}>
            <span style={pulsingDotStyle} />
            录制中...
          </div>
          <Button variant="secondary" fullWidth onClick={stopRecording}>
            停止
          </Button>
        </div>
      )}

      {audioBlob && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <audio src={URL.createObjectURL(audioBlob)} controls style={{ width: '100%', margin: 0 }} />
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
            <Button variant="primary" onClick={confirmRecording}>
              确认
            </Button>
            <Button variant="ghost" onClick={() => setAudioBlob(null)}>
              丢弃
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}