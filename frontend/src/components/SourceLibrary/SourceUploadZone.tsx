import { useState, useRef } from 'react';
import type { SourceDocument } from '../../types';
import styles from './SourceUploadZone.module.css';

interface SourceUploadZoneProps {
  onAdd: (sources: SourceDocument[]) => void;
  projectId: string;
}

type Tab = 'paste' | 'audio';

export function SourceUploadZone({ onAdd, projectId }: SourceUploadZoneProps) {
  const [tab, setTab] = useState<Tab>('paste');
  const [pastedText, setPastedText] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmitPaste = () => {
    const text = pastedText.trim();
    if (!text) return;
    const newSource: SourceDocument = {
      id: `s-${projectId}-${Date.now()}`,
      project_id: projectId,
      source_type: 'paste',
      title: text.slice(0, 30).replace(/\n/g, ' ') + (text.length > 30 ? '...' : ''),
      pasted_text: text,
      file_size: text.length,
      created_at: new Date().toISOString(),
    };
    onAdd([newSource]);
    setPastedText('');
  };

  const handleSubmitAudio = () => {
    if (!audioFile) return;
    // Mock: 实际应上传到 backend
    const newSource: SourceDocument = {
      id: `s-${projectId}-${Date.now()}`,
      project_id: projectId,
      source_type: 'audio',
      title: audioFile.name,
      audio_path: `/uploads/${audioFile.name}`,
      file_size: audioFile.size,
      duration_sec: 0, // 实际后端 probe
      created_at: new Date().toISOString(),
    };
    onAdd([newSource]);
    setAudioFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className={styles.zone}>
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'paste' ? styles.tabActive : ''}`}
          onClick={() => setTab('paste')}
        >
          📝 粘贴文本
        </button>
        <button
          className={`${styles.tab} ${tab === 'audio' ? styles.tabActive : ''}`}
          onClick={() => setTab('audio')}
        >
          🎵 上传音频
        </button>
      </div>

      {tab === 'paste' ? (
        <div className={styles.body}>
          <textarea
            className={styles.textarea}
            placeholder="把要变成语音的文本粘贴在这里…&#10;支持纯文本 / Markdown"
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
            rows={3}
          />
          <div className={styles.row}>
            <span className={styles.hint}>{pastedText.length} 字</span>
            <button
              className={styles.submitBtn}
              onClick={handleSubmitPaste}
              disabled={!pastedText.trim()}
            >
              + 添加为源
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav"
            onChange={e => setAudioFile(e.target.files?.[0] || null)}
            className={styles.fileInput}
          />
          {audioFile && (
            <div className={styles.fileInfo}>
              <span>🎵 {audioFile.name}</span>
              <span className={styles.fileSize}>{(audioFile.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
          )}
          <div className={styles.row}>
            <span className={styles.hint}>支持 .mp3 / .wav · 视频抽音待 P2.x</span>
            <button
              className={styles.submitBtn}
              onClick={handleSubmitAudio}
              disabled={!audioFile}
            >
              + 添加为源
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
