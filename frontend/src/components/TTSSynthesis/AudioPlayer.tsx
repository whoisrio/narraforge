import { useState } from 'react';
import type { TTSResult } from '../../types';
import styles from './AudioPlayer.module.css';

interface AudioPlayerProps {
  result: TTSResult | null;
  isLoading: boolean;
}

export function AudioPlayer({ result, isLoading }: AudioPlayerProps) {
  const [format, setFormat] = useState<'mp3' | 'wav'>('mp3');

  const handleDownload = () => {
    if (!result) return;

    const url = result.audio_url;
    const link = document.createElement('a');
    link.href = url;
    link.download = `voice_clone_${result.audio_id}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>正在生成语音...</span>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <p>输入文字并点击"生成语音"开始</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h3>生成结果</h3>

      <div className={styles.player}>
        <audio controls src={result.audio_url} className={styles.audio} />
      </div>

      <div className={styles.downloadSection}>
        <span>下载格式：</span>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as 'mp3' | 'wav')}
        >
          <option value="mp3">MP3</option>
          <option value="wav">WAV</option>
        </select>
        <button onClick={handleDownload} className={styles.downloadButton}>
          下载音频
        </button>
      </div>

      <div className={styles.info}>
        <p>文本长度: {result.text.length} 字符</p>
        <p>参数: 语速 {result.params.speed}x, 音量 {result.params.volume}, 语调 {result.params.pitch}</p>
      </div>
    </div>
  );
}
