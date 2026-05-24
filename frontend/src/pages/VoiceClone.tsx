import { useState } from 'react';
import { AudioRecorder } from '../components/VoiceClone/AudioRecorder';
import { AudioUploader } from '../components/VoiceClone/AudioUploader';
import { AudioPreview } from '../components/VoiceClone/AudioPreview';
import { UrlInput } from '../components/VoiceClone/UrlInput';
import { VoiceList } from '../components/VoiceClone/VoiceList';
import { useVoiceRefresh } from '../hooks/useVoiceRefresh';
import type { VoiceProfile } from '../types';
import styles from './VoiceClone.module.css';

/** 克隆流程的三个步骤 */
type CloneStep = 'choose-method' | 'input' | 'preview-clone';

/** 用户选择的输入方式 */
type InputMethod = 'record' | 'upload' | 'url' | null;

export function VoiceClone() {
  const [step, setStep] = useState<CloneStep>('choose-method');
  const [method, setMethod] = useState<InputMethod>(null);

  /** 录制或上传后得到的 File 对象 */
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  /** URL 模式确认后返回的声音信息 */
  const [urlVoice, setUrlVoice] = useState<VoiceProfile | null>(null);

  const { triggerRefresh } = useVoiceRefresh();

  /** 克隆成功或取消后，回到方法选择步骤 */
  const resetToChooseMethod = () => {
    setStep('choose-method');
    setMethod(null);
    setPendingFile(null);
    setUrlVoice(null);
  };

  /** 克隆成功后需要刷新 VoiceList 和 TTS 声音列表 */
  const handleCloneSuccess = () => {
    triggerRefresh();
    resetToChooseMethod();
  };

  // ---- 步骤 1: 方法选择 ----
  const renderMethodSelector = () => (
    <div className={styles.methodSelector}>
      <h2>选择声音来源</h2>
      <p className={styles.methodSelectorHint}>请选择一种方式提供声音样本</p>

      <div className={styles.methodCards}>
        <button
          className={styles.methodCard}
          onClick={() => { setMethod('record'); setStep('input'); }}
        >
          <span className={styles.methodIcon}>🎙️</span>
          <span className={styles.methodTitle}>实时录制</span>
          <span className={styles.methodDesc}>使用麦克风录制语音样本</span>
        </button>

        <button
          className={styles.methodCard}
          onClick={() => { setMethod('upload'); setStep('input'); }}
        >
          <span className={styles.methodIcon}>📁</span>
          <span className={styles.methodTitle}>上传文件</span>
          <span className={styles.methodDesc}>上传 MP3、WAV、WebM 音频文件</span>
        </button>

        <button
          className={styles.methodCard}
          onClick={() => { setMethod('url'); setStep('input'); }}
        >
          <span className={styles.methodIcon}>🌐</span>
          <span className={styles.methodTitle}>公网地址</span>
          <span className={styles.methodDesc}>提供已有音频文件的公网 URL</span>
        </button>
      </div>
    </div>
  );

  // ---- 步骤 2: 输入音频 ----
  const renderInput = () => (
    <div className={styles.inputStep}>
      <button
        className={styles.backButton}
        onClick={() => { setStep('choose-method'); setMethod(null); }}
      >
        ← 返回选择方式
      </button>

      <div className={styles.methodPanel}>
        <h3>
          {method === 'record' && '🎙️ 实时录制'}
          {method === 'upload' && '📁 上传音频文件'}
          {method === 'url' && '🌐 公网音频地址'}
        </h3>

        {method === 'record' && (
          <AudioRecorder onRecordComplete={(file) => { setPendingFile(file); setStep('preview-clone'); }} />
        )}
        {method === 'upload' && (
          <AudioUploader onFileSelected={(file) => { setPendingFile(file); setStep('preview-clone'); }} />
        )}
        {method === 'url' && (
          <UrlInput
            onUrlConfirmed={(voice) => { setUrlVoice(voice); setStep('preview-clone'); }}
            onBack={() => { setStep('choose-method'); setMethod(null); }}
          />
        )}
      </div>
    </div>
  );

  // ---- 步骤 3: 预览并克隆 ----
  const renderPreview = () => (
    <div className={styles.previewStep}>
      <button
        className={styles.backButton}
        onClick={resetToChooseMethod}
      >
        ← 返回选择方式
      </button>

      {pendingFile && (
        <AudioPreview
          file={pendingFile}
          onCloneSuccess={handleCloneSuccess}
          onCancel={resetToChooseMethod}
        />
      )}

      {urlVoice && (
        <AudioPreview
          voiceId={urlVoice.id}
          audioUrl={urlVoice.audio_url}
          onCloneSuccess={handleCloneSuccess}
          onCancel={resetToChooseMethod}
        />
      )}
    </div>
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>声音复刻</h1>
        <p>完美复刻你的声音</p>
      </div>

      <div className={styles.content}>
        {/* 左侧：方法选择 / 输入 / 预览（根据步骤切换） */}
        <div className={styles.inputSection}>
          <div className={styles.card}>
            {step === 'choose-method' && renderMethodSelector()}
            {step === 'input' && renderInput()}
            {step === 'preview-clone' && renderPreview()}
          </div>
        </div>

        {/* 右侧：声音列表（始终显示） */}
        <div className={styles.listSection}>
          <div className={styles.card}>
            <VoiceList />
          </div>
        </div>
      </div>
    </div>
  );
}