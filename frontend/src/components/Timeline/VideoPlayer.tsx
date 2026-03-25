import { useRef, useState, useEffect } from 'react';
import { Card, EmptyState } from '../ui';

interface VideoPlayerProps {
  url?: string;
  onTimeUpdate?: (time: number) => void;
  onDuration?: (duration: number) => void;
  playing?: boolean;
}

export function VideoPlayer({ url, onTimeUpdate, onDuration, playing = false }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      onTimeUpdate?.(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      onDuration?.(video.duration);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [onTimeUpdate, onDuration]);

  useEffect(() => {
    if (videoRef.current) {
      if (playing) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    }
  }, [playing]);

  const videoStyle = {
    width: '100%',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden' as const,
    background: 'var(--color-background)',
  };

  const timeInfoStyle = {
    marginTop: 'var(--spacing-sm)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-secondary)',
  };

  if (!url) {
    return (
      <Card>
        <EmptyState
          icon="🎬"
          title="No Video"
          description="Upload a video to get started."
        />
      </Card>
    );
  }

  return (
    <div>
      <video
        ref={videoRef}
        src={url}
        controls
        style={videoStyle}
      />
      <div style={timeInfoStyle}>
        Current: {currentTime.toFixed(1)}s / Duration: {duration.toFixed(1)}s
      </div>
    </div>
  );
}
