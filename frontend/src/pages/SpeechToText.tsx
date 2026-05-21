import { useState, useRef, useCallback, useEffect } from 'react';
import { speechToTextApi } from '../services/api';
import type { TranscribeResult, TranscriptionRecord } from '../services/api';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Slider } from '../components/ui/Slider';
import { Loading } from '../components/ui/Loading';
import { TranscriptionHistory } from '../components/SpeechToText';
import styles from './SpeechToText.module.css';

const MODEL_OPTIONS = [
  { value: 'tiny', label: 'Tiny (fastest, least accurate)' },
  { value: 'base', label: 'Base' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large-v3', label: 'Large-v3 (slowest, most accurate)' },
];

export function SpeechToText() {
  const [file, setFile] = useState<File | null>(null);
  const [modelSize, setModelSize] = useState('large-v3');
  const [beamSize, setBeamSize] = useState(5);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((selectedFile: File) => {
    const ext = selectedFile.name.split('.').pop()?.toLowerCase();
    if (ext !== 'wav' && ext !== 'mp3') {
      setError('Only .wav and .mp3 files are supported');
      return;
    }
    setFile(selectedFile);
    setResult(null);
    setError(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(URL.createObjectURL(selectedFile));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) handleFileSelect(droppedFile);
    },
    [handleFileSelect],
  );

  const handleTranscribe = async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);
    try {
      const res = await speechToTextApi.transcribe(file, modelSize, beamSize);
      setResult(res);
      loadHistory();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Transcription failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result || !file) return;
    const stem = file.name.replace(/\.[^.]+$/, '');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `${stem}_${date}.srt`;
    const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const loadHistory = useCallback(async () => {
    try {
      const data = await speechToTextApi.getHistory();
      setHistory(data);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleDeleteRecord = useCallback(async (id: string) => {
    try {
      await speechToTextApi.deleteRecord(id);
      setHistory(prev => prev.filter(r => r.id !== id));
    } catch (error) {
      console.error('Failed to delete record:', error);
    }
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>语音转字幕</h1>
        <p>上传音频文件，使用 Whisper 模型识别语音并生成 SRT 字幕</p>
      </div>

      <div className={styles.content}>
        <div className={styles.inputSection}>
          <div className={styles.card}>
            <h2>上传音频</h2>
            <div
              className={`${styles.uploadZone} ${dragOver ? styles.dragOver : ''} ${file ? styles.hasFile : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {file ? (
                <>
                  <div className={styles.uploadIcon}>🎵</div>
                  <div className={styles.fileName}>{file.name}</div>
                  <div className={styles.uploadHint}>点击更换文件</div>
                </>
              ) : (
                <>
                  <div className={styles.uploadIcon}>📁</div>
                  <div className={styles.uploadText}>拖拽音频文件到此处，或点击选择</div>
                  <div className={styles.uploadHint}>支持 .wav, .mp3 格式</div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,.mp3"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
            />

            {audioUrl && (
              <div className={styles.audioPlayer}>
                <audio controls src={audioUrl} className={styles.audio} />
              </div>
            )}

            <div className={styles.params}>
              <Select
                label="模型大小"
                options={MODEL_OPTIONS}
                value={modelSize}
                onChange={(e) => setModelSize(e.target.value)}
              />
              <Slider
                label="Beam Size"
                value={beamSize}
                onChange={setBeamSize}
                min={1}
                max={10}
                step={1}
              />
            </div>

            <div className={styles.actionRow}>
              <Button
                variant="primary"
                fullWidth
                loading={processing}
                disabled={!file || processing}
                onClick={handleTranscribe}
              >
                {processing ? '识别中...' : '开始识别'}
              </Button>
            </div>
          </div>
        </div>

        <div className={styles.resultSection}>
          <div className={styles.card}>
            <h2>识别结果</h2>
            {processing && (
              <div className={styles.processing}>
                <Loading size="lg" />
                <div className={styles.processingText}>正在识别语音，请耐心等待...</div>
              </div>
            )}
            {error && <div style={{ color: 'var(--color-danger)' }}>{error}</div>}
            {result && !processing && (
              <>
                <div className={styles.resultHeader}>
                  <span className={styles.languageBadge}>
                    {result.language} ({(result.language_probability * 100).toFixed(1)}%)
                  </span>
                </div>
                <textarea
                  className={styles.srtPreview}
                  value={result.content}
                  readOnly
                />
                <div className={styles.downloadRow}>
                  <Button variant="primary" onClick={handleDownload}>
                    下载 SRT 文件
                  </Button>
                </div>
              </>
            )}
            {!result && !processing && !error && (
              <div style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
                上传音频并点击识别，结果将显示在这里
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.historySection}>
        <TranscriptionHistory records={history} onDelete={handleDeleteRecord} />
      </div>
    </div>
  );
}
