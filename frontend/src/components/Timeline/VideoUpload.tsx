import { useRef } from 'react';
import { timelineApi } from '../../services/api';
import { Button } from '../ui';

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
      <Button
        variant="primary"
        onClick={() => fileInputRef.current?.click()}
      >
        📹 Upload Video
      </Button>
    </div>
  );
}
