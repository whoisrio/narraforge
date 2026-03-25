import { useState } from 'react';
import { voiceApi } from '../../services/api';
import { Loading } from '../ui';

interface AudioUploaderProps {
  onUploadComplete?: () => void;
}

export function AudioUploader({ onUploadComplete }: AudioUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.name.match(/\.(mp3|wav|webm)$/i)) {
      alert('Please upload MP3, WAV, or WebM files only');
      return;
    }

    setUploading(true);
    try {
      await voiceApi.upload(file);
      onUploadComplete?.();
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
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
    cursor: uploading ? 'wait' : 'pointer',
    backgroundColor: dragOver ? 'rgba(25, 118, 210, 0.05)' : 'var(--color-surface)',
    transition: 'all var(--transition-fast)',
  };

  const iconStyle = {
    fontSize: '48px',
    marginBottom: 'var(--spacing-sm)',
  };

  const titleStyle = {
    fontSize: 'var(--font-size-base)',
    fontWeight: 'var(--font-weight-medium)',
    marginBottom: 'var(--spacing-xs)',
  };

  const subtitleStyle = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary)',
  };

  return (
    <div
      className={`upload-zone ${dragOver ? 'drag-over' : ''} ${uploading ? 'uploading' : ''}`}
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
        disabled={uploading}
      />
      <label htmlFor="audio-upload" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
        {uploading ? (
          <Loading message="Uploading..." />
        ) : (
          <div>
            <div style={iconStyle}>📁</div>
            <div style={titleStyle}>Drag & drop audio file here</div>
            <div style={subtitleStyle}>or click to browse (MP3, WAV, WebM)</div>
          </div>
        )}
      </label>
    </div>
  );
}
