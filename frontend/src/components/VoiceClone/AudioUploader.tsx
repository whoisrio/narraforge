import { useState } from 'react';

interface AudioUploaderProps {
  /** 文件选择后回调，传递选中的 File 对象（不自动上传） */
  onFileSelected?: (file: File) => void;
}

export function AudioUploader({ onFileSelected }: AudioUploaderProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (file: File) => {
    if (!file.name.match(/\.(mp3|wav|webm)$/i)) {
      alert('请上传 MP3、WAV 或 WebM 格式的文件');
      return;
    }
    onFileSelected?.(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const uploadZoneStyle = {
    border: `2px dashed ${dragOver ? 'var(--color-primary)' : 'var(--color-border)'}`,
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--spacing-2xl)',
    textAlign: 'center' as const,
    cursor: 'pointer',
    backgroundColor: dragOver ? 'var(--glow-primary)' : 'var(--color-surface)',
    transition: 'all var(--transition-fast)',
  };

  return (
    <div
      className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={uploadZoneStyle}
    >
      <input
        type="file"
        accept=".mp3,.wav,.webm"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        style={{ display: 'none' }}
        id="audio-upload"
      />
      <label htmlFor="audio-upload" style={{ cursor: 'pointer' }}>
        <div>
          <div style={{ fontSize: '48px', marginBottom: 'var(--spacing-sm)' }}>📁</div>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--spacing-xs)' }}>
            拖拽音频文件到此处
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            或点击浏览（支持 MP3、WAV、WebM）
          </div>
        </div>
      </label>
    </div>
  );
}