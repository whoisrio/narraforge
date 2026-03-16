import { useRef, useState, useEffect } from 'react';

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

  if (!url) {
    return (
      <div style={{
        width: '100%',
        height: '300px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5',
        borderRadius: '8px',
        color: '#666',
      }}>
        No video uploaded
      </div>
    );
  }

  return (
    <div>
      <video
        ref={videoRef}
        src={url}
        controls
        style={{ width: '100%', borderRadius: '8px', overflow: 'hidden' }}
      />
      <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
        Current: {currentTime.toFixed(1)}s / Duration: {duration.toFixed(1)}s
      </div>
    </div>
  );
}