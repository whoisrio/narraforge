import { useState } from 'react';
import { AudioRecorder } from '../components/VoiceClone/AudioRecorder';
import { AudioUploader } from '../components/VoiceClone/AudioUploader';
import { AudioPreview } from '../components/VoiceClone/AudioPreview';
import { UrlInput } from '../components/VoiceClone/UrlInput';
import { VoiceList } from '../components/VoiceClone/VoiceList';
import { useVoiceRefresh } from '../hooks/useVoiceRefresh';
import { playVoiceDesignPreview, type VoiceDesignEngine } from '../services/voiceDesignPreview';
import { t } from '../i18n';
import type { TTSResult, VoiceProfile } from '../types';
import styles from './VoiceClone.module.css';

/** 克隆引擎类型 */
type CloneEngine = 'qwen' | 'mimo' | 'voxcpm';

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
  const [designBrief, setDesignBrief] = useState('温暖、清晰、有纪录片感的中文旁白音色');
  const [designIntensity, setDesignIntensity] = useState(72);
  const [designStability, setDesignStability] = useState(68);
  const [designPreview, setDesignPreview] = useState<TTSResult | null>(null);
  const [designProfiles, setDesignProfiles] = useState<VoiceProfile[]>([]);
  const [designStatus, setDesignStatus] = useState<string | null>(null);
  const [designError, setDesignError] = useState<string | null>(null);
  const [designPreviewing, setDesignPreviewing] = useState(false);

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

  const handleDesignPreview = async () => {
    setDesignPreviewing(true);
    setDesignError(null);
    setDesignStatus(null);
    try {
      const preview = await playVoiceDesignPreview({
        engine: designEngine as VoiceDesignEngine,
        voiceDescription: designBrief,
        sampleText: '这是一段试听文本，用来确认这个 Voice Profile 是否适合项目旁白。',
        intensity: designIntensity,
        stability: designStability,
      });
      setDesignPreview(preview);
      setDesignStatus(`${t('voiceDesign.previewGenerated')} · ${preview.audio_format || (designEngine === 'voxcpm' ? 'wav' : 'mp3')}`);
    } catch (error) {
      console.error('[voice-design] preview failed:', error);
      setDesignError(error instanceof Error ? error.message : '后端试听失败，请检查模型配置');
    } finally {
      setDesignPreviewing(false);
    }
  };

  const handleSaveDesignProfile = () => {
    const id = designPreview?.audio_id || `design-${Date.now()}`;
    const engineLabel = designEngine === 'mimo' ? 'mimo' : designEngine === 'voxcpm' ? 'voxcpm' : 'qwen';
    const profile: VoiceProfile = {
      id,
      name: designBrief.trim() || 'Untitled Voice Profile',
      audio_url: designPreview?.audio_url || '',
      description: designBrief,
      clone_engine: engineLabel,
      is_cloned: false,
      created_at: new Date().toISOString(),
    };
    setDesignProfiles(prev => [profile, ...prev.filter(item => item.id !== id)]);
    setDesignStatus('已保存为 Voice Profile，可绑定到项目 Voice Role');
  };

  // ---- 步骤 1: 方法选择 ----
  const renderMethodSelector = () => (
    <div className={styles.methodSelector}>
      <h2>选择声音来源</h2>
      <p className={styles.methodSelectorHint}>
        {engine === 'mimo'
          ? '录制或上传音频，MiMo 会即时复刻音色'
          : engine === 'voxcpm'
          ? '录制或上传音频，VoxCPM 会在本地 GPU 上克隆音色'
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

        {/* MiMo 和 VoxCPM 不需要公网地址，它们直接读取本地音频 */}
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
        <button
          className={`${styles.engineOption} ${designEngine === 'voxcpm' ? styles.active : ''}`}
          onClick={() => setDesignEngine('voxcpm')}
        >
          VoxCPM (本地)
        </button>
      </div>

      <div className={styles.designWorkspace}>
        <section className={styles.profileLibraryPanel}>
          <span className={styles.kicker}>{t('voiceDesign.profileLibrary')}</span>
          <h3>{t('voiceDesign.profileLibrary')}</h3>
          <p>把克隆、设计、调参后的 Voice Profile 作为全局资产管理，再交给项目内 Voice Role 绑定。</p>
          <div className={styles.profileCards}>
            {designProfiles.map(profile => (
              <article key={profile.id}>
                <strong>{profile.name}</strong>
                <span>{profile.clone_engine === 'mimo' ? 'MiMo' : profile.clone_engine === 'voxcpm' ? 'VoxCPM' : 'CosyVoice'} · design</span>
                <em>{t('voiceDesign.projectRoleReady')}</em>
              </article>
            ))}
            <article>
              <strong>Documentary Narrator</strong>
              <span>MiMo · design</span>
              <em>可绑定到项目 Voice Role</em>
            </article>
            <article>
              <strong>Warm Cast Voice</strong>
              <span>VoxCPM · tune</span>
              <em>Project Role Ready</em>
            </article>
          </div>
        </section>

        <section className={styles.designBriefPanel}>
          <span className={styles.kicker}>{t('voiceDesign.designBrief')}</span>
          <h3>{t('voiceDesign.designBrief')}</h3>
          <label>
            音色描述
            <textarea
              aria-label="音色描述"
              value={designBrief}
              onChange={(event) => setDesignBrief(event.target.value)}
              placeholder="例如：温暖、沉稳、有纪录片感的中文男声"
            />
          </label>
          <div className={styles.previewPrompt}>
            <strong>当前 Brief</strong>
            <p>{designBrief}</p>
          </div>
        </section>

        <section className={styles.tuneLabPanel}>
          <span className={styles.kicker}>{t('voiceDesign.tuneLab')}</span>
          <h3>{t('voiceDesign.tuneLab')}</h3>
          <label>
            表现强度
            <input aria-label="表现强度" type="range" min="0" max="100" value={designIntensity} onChange={(event) => setDesignIntensity(Number(event.target.value))} />
          </label>
          <label>
            稳定性
            <input aria-label="稳定性" type="range" min="0" max="100" value={designStability} onChange={(event) => setDesignStability(Number(event.target.value))} />
          </label>
          <button type="button" className={styles.backendPreviewBtn} onClick={handleDesignPreview} disabled={designPreviewing || !designBrief.trim()}>
            {designPreviewing ? '后端试听中...' : t('voiceDesign.backendPreview')}
          </button>
          <button type="button" className={styles.saveProfileBtn} onClick={handleSaveDesignProfile} disabled={!designPreview}>
            {t('voiceDesign.saveProfile')}
          </button>
          {designStatus && <div className={styles.designStatus}>{designStatus}</div>}
          {designError && <div className={styles.designError}>{designError}</div>}
        </section>
      </div>
    </>
  );

  return (
    <div className={styles.container}>
      <section className={styles.hero} data-visual="thin-global-header">
        <div>
          <span className={styles.kicker}>Voice Design</span>
          <h1>音色设计</h1>
          <p>管理可复用 Voice Profile，支持克隆、设计、调参，并交给项目 Voice Role 使用。</p>
        </div>
        <div className={styles.heroPills} aria-label="voice design workflow">
          <span>Voice Profile Library</span>
          <span>Clone / Design / Tune</span>
          <span>Project Role Ready</span>
        </div>
      </section>

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
                  <button
                    className={`${styles.engineOption} ${engine === 'voxcpm' ? styles.active : ''}`}
                    onClick={() => setEngine('voxcpm')}
                  >
                    VoxCPM (本地)
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
