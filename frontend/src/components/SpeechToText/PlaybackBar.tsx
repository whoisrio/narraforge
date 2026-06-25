import { useRef, useState, useEffect } from 'react';
import styles from './PlaybackBar.module.css';

interface PlaybackBarProps {
  audioUrl: string | null;
}

export function PlaybackBar({ audioUrl }: PlaybackBarProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoaded = () => setDuration(audio.duration);
    const onEnded = () => setPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('ended', onEnded);
    };
  }, [audioUrl]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
    setPlaying(!playing);
  };

  const skip = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(duration, audioRef.current.currentTime + seconds));
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * duration;
  };

  const cycleSpeed = () => {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const idx = speeds.indexOf(speed);
    setSpeed(speeds[(idx + 1) % speeds.length]);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  if (!audioUrl) return null;

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={styles.bar}>
      <audio ref={audioRef} src={audioUrl} preload="metadata" />
      <div className={styles.controls}>
        <button className={styles.skipBtn} onClick={() => skip(-10)}>
          <span className="material-symbols-outlined">skip_previous</span>
        </button>
        <button className={styles.playBtn} onClick={togglePlay}>
          <span className="material-symbols-outlined">{playing ? 'pause' : 'play_arrow'}</span>
        </button>
        <button className={styles.skipBtn} onClick={() => skip(10)}>
          <span className="material-symbols-outlined">skip_next</span>
        </button>
      </div>
      <div className={styles.progressWrapper}>
        <span className={styles.time}>{formatTime(currentTime)}</span>
        <div className={styles.progressTrack} onClick={handleProgressClick}>
          <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
          <div className={styles.progressThumb} style={{ left: `${progressPct}%` }} />
        </div>
        <span className={styles.time}>{formatTime(duration)}</span>
      </div>
      <div className={styles.right}>
        <button className={styles.speedBtn} onClick={cycleSpeed}>{speed}x</button>
        <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--color-text-muted)' }}>volume_up</span>
      </div>
    </div>
  );
}
