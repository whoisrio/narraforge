import { useState } from 'react';
import { voiceApi } from '../../services/api';

interface AudioUploaderProps {
  onUploadComplete?: () => void;
}

export function AudioUploader({ onUploadComplete }: AudioUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.name.match(/\.(mp3|wav)$/i)) {
      alert('Please upload MP3 or WAV files only');
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

  return (
    <div
      className={`upload-zone ${dragOver ? 'drag-over' : ''} ${uploading ? 'uploading' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      style={{
        border: '2px dashed #ccc',
        borderRadius: '8px',
        padding: '40px',
        textAlign: 'center',
        cursor: 'pointer',
        background: dragOver ? '#f0f0f0' : 'white',
        transition: 'all 0.2s',
      }}
    >
      <input
        type="file"
        accept=".mp3,.wav"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        style={{ display: 'none' }}
        id="audio-upload"
        disabled={uploading}
      />
      <label htmlFor="audio-upload" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
        {uploading ? (
          <div>Uploading...</div>
        ) : (
          <div>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>📁</div>
            <div>Drag & drop audio file here</div>
            <div style={{ color: '#666', fontSize: '12px', marginTop: '4px' }}>or click to browse (MP3, WAV)</div>
          </div>
        )}
      </label>
    </div>
  );
}