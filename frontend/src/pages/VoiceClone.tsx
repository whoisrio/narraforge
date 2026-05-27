import { useState } from 'react';
import { AudioRecorder } from '../components/VoiceClone/AudioRecorder';
import { AudioUploader } from '../components/VoiceClone/AudioUploader';
import { AudioPreview } from '../components/VoiceClone/AudioPreview';
import { UrlInput } from '../components/VoiceClone/UrlInput';
import { VoiceList } from '../components/VoiceClone/VoiceList';
import { useVoiceRefresh } from '../hooks/useVoiceRefresh';
import type { VoiceProfile } from '../types';
import styles from './VoiceClone.module.css';

/** 克隆引擎类型 */
type CloneEngine = 'qwen' | 'mimo';

/** 克隆流程的三个步骤 */
type CloneStep = 'choose-method' | 'input' | 'preview-clone';

/** 用户选择的输入方式 */
type InputMethod = 'record' | 'upload' | 'url' | null;

/** 顶层功能区 */
type Section = 'clone' | 'design';

export function VoiceClone() {
  const [section, setSection] = useState<Section>('clone');
  const [step, setStep] = useState<CloneStep>('choose-method');
  const [method, setMethod] = useState<InputMethod>(null);
  const [engine, setEngine] = useState<CloneEngine>('qwen');
  const [designEngine, setDesignEngine] = useState<CloneEngine>('mimo');

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
      <p className={styles.methodSelectorHint}>
        {engine === 'mimo'
          ? '录制或上传音频，MiMo 会即时复刻音色'
          : '请选择一种方式提供声音样本'}
      </p>

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

        {/* MiMo 不需要公网地址，它直接读取本地音频转 base64 */}
        {engine === 'qwen' && (
          <button
            className={styles.methodCard}
            onClick={() => { setMethod('url'); setStep('input'); }}
          >
            <span className={styles.methodIcon}>🌐</span>
            <span className={styles.methodTitle}>公网地址</span>
            <span className={styles.methodDesc}>提供已有音频文件的公网 URL</span>
          </button>
        )}
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
          engine={engine}
          onCloneSuccess={handleCloneSuccess}
          onCancel={resetToChooseMethod}
        />
      )}

      {urlVoice && (
        <AudioPreview
          voiceId={urlVoice.id}
          audioUrl={urlVoice.audio_url}
          engine={engine}
          onCloneSuccess={handleCloneSuccess}
          onCancel={resetToChooseMethod}
        />
      )}
    </div>
  );

  // ---- 音色设计区（占位） ----
  const renderDesignSection = () => (
    <>
      {/* 设计引擎选择 */}
      <div className={styles.engineSwitch}>
        <button
          className={`${styles.engineOption} ${designEngine === 'qwen' ? styles.active : ''}`}
          onClick={() => setDesignEngine('qwen')}
        >
          CosyVoice (Qwen)
        </button>
        <button
          className={`${styles.engineOption} ${designEngine === 'mimo' ? styles.active : ''}`}
          onClick={() => setDesignEngine('mimo')}
        >
          MiMo-TTS
        </button>
      </div>

      <div className={styles.placeholderSection}>
        <div className={styles.placeholderIcon}>🎨</div>
        <h3>音色设计</h3>
        <p className={styles.placeholderDesc}>
          通过文本描述设计全新音色，或对已有声音进行风格调整。
        </p>
        <div className={styles.placeholderFeatures}>
          {designEngine === 'mimo' ? (
            <>
              <div className={styles.placeholderFeature}>
                <span className={styles.featureIcon}>✍️</span>
                <div>
                  <div className={styles.featureTitle}>文本描述定制</div>
                  <div className={styles.featureDesc}>用自然语言描述想要的音色特征，MiMo 即时生成</div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className={styles.placeholderFeature}>
                <span className={styles.featureIcon}>🎭</span>
                <div>
                  <div className={styles.featureTitle}>风格迁移</div>
                  <div className={styles.featureDesc}>将已有声音转换为不同风格（温柔、激昂、播音腔等）</div>
                </div>
              </div>
              <div className={styles.placeholderFeature}>
                <span className={styles.featureIcon}>🔀</span>
                <div>
                  <div className={styles.featureTitle}>声音混合</div>
                  <div className={styles.featureDesc}>混合多个声音特征，创造独特音色</div>
                </div>
              </div>
            </>
          )}
        </div>
        <div className={styles.placeholderBadge}>即将推出</div>
      </div>
    </>
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>音色设计</h1>
        <p>创建和管理你的专属音色</p>
      </div>

      {/* 顶层功能区切换 */}
      <div className={styles.sectionTabs}>
        <button
          className={`${styles.sectionTab} ${section === 'clone' ? styles.active : ''}`}
          onClick={() => setSection('clone')}
        >
          🎙️ 声音克隆
        </button>
        <button
          className={`${styles.sectionTab} ${section === 'design' ? styles.active : ''}`}
          onClick={() => setSection('design')}
        >
          🎨 音色设计
        </button>
      </div>

      <div className={styles.content}>
        {/* 左侧：功能区 */}
        <div className={styles.inputSection}>
          <div className={styles.card}>
            {section === 'clone' ? (
              <>
                {/* 克隆引擎选择 */}
                <div className={styles.engineSwitch}>
                  <button
                    className={`${styles.engineOption} ${engine === 'qwen' ? styles.active : ''}`}
                    onClick={() => setEngine('qwen')}
                  >
                    CosyVoice (Qwen)
                  </button>
                  <button
                    className={`${styles.engineOption} ${engine === 'mimo' ? styles.active : ''}`}
                    onClick={() => setEngine('mimo')}
                  >
                    MiMo-TTS
                  </button>
                </div>

                {step === 'choose-method' && renderMethodSelector()}
                {step === 'input' && renderInput()}
                {step === 'preview-clone' && renderPreview()}
              </>
            ) : (
              renderDesignSection()
            )}
          </div>
        </div>

        {/* 右侧：声音列表（仅声音克隆时显示） */}
        {section === 'clone' && (
          <div className={styles.listSection}>
            <div className={styles.card}>
              <VoiceList engine={engine} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
