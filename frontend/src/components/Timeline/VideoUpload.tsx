import { useRef } from 'react';
import { timelineApi } from '../../services/api';

interface VideoUploadProps {
  projectId: string;
  onUploadComplete?: () => void;
}

export function VideoUpload({ projectId, onUploadComplete }: VideoUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await timelineApi.uploadVideo(projectId, file);
      onUploadComplete?.();
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Video upload failed');
    }
  };

  return (
    <div>
      <input
        type="file"
        accept="video/*"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        style={{
          padding: '8px 16px',
          fontSize: '14px',
          background: '#1976d2',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        📹 Upload Video
      </button>
    </div>
  );
}