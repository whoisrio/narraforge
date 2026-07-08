import { useState } from 'react';
import { useTranslation } from '../../i18n';

interface AudioUploaderProps {
  /** 文件选择后回调，传递选中的 File 对象（不自动上传） */
  onFileSelected?: (file: File) => void;
}

export function AudioUploader({ onFileSelected }: AudioUploaderProps) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (file: File) => {
    if (!file.name.match(/\.(mp3|wav|webm)$/i)) {
      alert(t('audioUploader.invalidFormat'));
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
            {t('audioUploader.dragHere')}
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            {t('audioUploader.clickToBrowse')}
          </div>
        </div>
      </label>
    </div>
  );
}