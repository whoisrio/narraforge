import { useState, useRef, useCallback } from 'react';
import { Button, Card } from '../ui';

interface AudioRecorderProps {
  onRecordComplete?: (file: File) => void;
}

export function AudioRecorder({ onRecordComplete }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [recordTime, setRecordTime] = useState(0);

  // 用普通变量存引用，避免闭包问题
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const draw = useCallback(() => {
    const a = analyserRef.current;
    const c = canvasRef.current;
    if (!a || !c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    // 动态设置 canvas 分辨率
    const rect = c.getBoundingClientRect();
    if (c.width !== Math.floor(rect.width * 2)) {
      c.width = Math.floor(rect.width * 2);
      c.height = 100;
    }

    const data = new Uint8Array(a.frequencyBinCount);
    a.getByteFrequencyData(data);

    // 音量
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    setVolumeLevel(Math.min(100, Math.round(rms / 1.28)));

    // 画频谱
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    const bars = 30, gap = 3;
    const bw = (w - gap * (bars - 1)) / bars;
    const step = Math.floor(data.length / bars);
    for (let i = 0; i < bars; i++) {
      const v = data[i * step];
      const bh = Math.max(3, (v / 255) * h);
      ctx.fillStyle = `hsl(${150 + (v / 255) * 70}, 75%, ${45 + (v / 255) * 25}%)`;
      ctx.fillRect(i * (bw + gap), h - bh, bw, bh);
    }

    animRef.current = requestAnimationFrame(draw);
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 音频分析
      const actx = new AudioContext();
      audioCtxRef.current = actx;
      const src = actx.createMediaStreamSource(stream);
      const ana = actx.createAnalyser();
      ana.fftSize = 256;
      ana.smoothingTimeConstant = 0.8;
      src.connect(ana);
      analyserRef.current = ana;

      // MediaRecorder — 关键: start(100) 每100ms产生数据
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      recorderRef.current = rec;
      chunksRef.current = []; // 清空

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      rec.onstop = () => {
        // 立刻取快照，不要在闭包里引用 chunksRef
        const allChunks = [...chunksRef.current];
        const blob = new Blob(allChunks, { type: 'audio/webm' });
        setAudioBlob(blob);
        console.log(`[AudioRecorder] stopped, chunks=${allChunks.length}, blob=${blob.size} bytes`);
        stopAll();
      };

      rec.onerror = (e) => {
        console.error('[AudioRecorder] recorder error:', e);
        stopAll();
      };

      rec.start(100); // 每100ms触发ondataavailable
      setRecording(true);
      setRecordTime(0);

      timerRef.current = setInterval(() => setRecordTime(t => t + 1), 1000);
      animRef.current = requestAnimationFrame(draw);

    } catch (err) {
      console.error('Failed to start recording:', err);
      alert('无法访问麦克风，请检查浏览器权限');
    }
  };

  const stopAll = () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    analyserRef.current = null;
    setVolumeLevel(0);
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const confirmRecording = () => {
    if (!audioBlob || audioBlob.size === 0) return;
    const file = new File([audioBlob], 'recording.webm', { type: 'audio/webm' });
    onRecordComplete?.(file);
    setAudioBlob(null);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <Card>
      <h3 style={{ margin: 0, marginBottom: 16, fontSize: 18, fontWeight: 600 }}>🎙️ 实时录制</h3>

      {!recording && !audioBlob && (
        <Button variant="danger" fullWidth onClick={startRecording}>● 开始录制</Button>
      )}

      {recording && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#ef4444', fontWeight: 500, fontSize: 14 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s infinite' }} />
            录制中 {fmt(recordTime)}
            <span style={{ marginLeft: 'auto', color: volumeLevel > 5 ? '#22c55e' : '#9ca3af', fontSize: 13 }}>
              🔊 {volumeLevel}%
            </span>
          </div>
          <div style={{ background: '#0f172a', borderRadius: 8, padding: 8, marginBottom: 12 }}>
            <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 50 }} />
          </div>
          <Button variant="secondary" fullWidth onClick={stopRecording}>⏹ 停止录制</Button>
        </div>
      )}

      {audioBlob && !recording && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <audio src={URL.createObjectURL(audioBlob)} controls style={{ width: '100%' }} />
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            大小: {(audioBlob.size / 1024).toFixed(0)} KB
          </div>
          {audioBlob.size === 0 && (
            <div style={{ fontSize: 13, color: '#ef4444' }}>⚠️ 录制数据为空，请检查麦克风</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" onClick={confirmRecording} disabled={audioBlob.size === 0}>✓ 确认使用</Button>
            <Button variant="ghost" onClick={() => setAudioBlob(null)}>✕ 丢弃重录</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
