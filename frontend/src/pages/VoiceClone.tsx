import { useState } from 'react';
import { AudioRecorder } from '../components/VoiceClone/AudioRecorder';
import { AudioUploader } from '../components/VoiceClone/AudioUploader';
import { AudioPreview } from '../components/VoiceClone/AudioPreview';
import { VoiceList } from '../components/VoiceClone/VoiceList';
import styles from './VoiceClone.module.css';

export function VoiceClone() {
  /** 录制或上传后暂存的文件，用于预览和延迟确认 */
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>声音克隆</h1>
        <p>录制或上传音频，创建你自己的声音模型</p>
      </div>

      <div className={styles.content}>
        {/* Input Section */}
        <div className={styles.inputSection}>
          <div className={styles.card}>
            <h2>添加新声音</h2>

            <div className={styles.inputMethods}>
              {/* Recording */}
              <div className={styles.method}>
                <h3>录制音频</h3>
                <p>使用麦克风录制 10-30 秒的语音样本</p>
                <AudioRecorder onRecordComplete={setPendingFile} />
              </div>

              {/* Upload */}
              <div className={styles.method}>
                <h3>上传音频</h3>
                <p>上传 MP3、WAV、OGG 或 WebM 格式的音频文件</p>
                <AudioUploader onFileSelected={setPendingFile} />
              </div>
            </div>

            {/* 文件预览 + Clone 按钮 */}
            {pendingFile && (
              <AudioPreview
                file={pendingFile}
                onCloneSuccess={() => setPendingFile(null)}
                onCancel={() => setPendingFile(null)}
              />
            )}
          </div>
        </div>

        {/* Voice List Section */}
        <div className={styles.listSection}>
          <div className={styles.card}>
            <VoiceList />
          </div>
        </div>
      </div>
    </div>
  );
}