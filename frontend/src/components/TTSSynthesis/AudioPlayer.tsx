import { useState, useMemo } from 'react';
import type { TTSResult } from '../../types';
import styles from './AudioPlayer.module.css';

interface AudioPlayerProps {
  result: TTSResult | null;
  isLoading: boolean;
}

/** 将 base64 转 Blob URL（用于音频播放） */
function base64ToBlobUrl(base64: string, format: string): string {
  const mimeType = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
  const byteChars = atob(base64);
  const byteNums = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNums[i] = byteChars.charCodeAt(i);
  }
  const byteArr = new Uint8Array(byteNums);
  return URL.createObjectURL(new Blob([byteArr], { type: mimeType }));
}

export function AudioPlayer({ result, isLoading }: AudioPlayerProps) {
  const [format, setFormat] = useState<'mp3' | 'wav'>('mp3');

  const audioSrc = useMemo(() => {
    if (!result) return '';
    if (result.audio_base64) {
      return base64ToBlobUrl(result.audio_base64, result.audio_format || 'mp3');
    }
    return result.audio_url || '';
  }, [result]);

  const handleDownload = async () => {
    if (!result) return;

    if (result.audio_base64) {
      const mimeType = result.audio_format === 'wav' ? 'audio/wav' : 'audio/mpeg';
      // 用 fetch data URI 解码 base64，比 atob 更高效可靠
      const dataUrl = `data:${mimeType};base64,${result.audio_base64}`;
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `voice_clone_${result.audio_id}.${format}`;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 1000);
      return;
    }

    const url = result.audio_url;
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = `voice_clone_${result.audio_id}.${format}`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => document.body.removeChild(link), 1000);
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
        <audio controls src={audioSrc} className={styles.audio} />
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
