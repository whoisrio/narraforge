import { useState, useEffect, useCallback } from 'react';
import { AudioRecorder } from '../components/VoiceClone/AudioRecorder';
import { AudioUploader } from '../components/VoiceClone/AudioUploader';
import { AudioPreview } from '../components/VoiceClone/AudioPreview';
import { UrlInput } from '../components/VoiceClone/UrlInput';
import { ImageUploadZone } from '../components/ui/ImageUploadZone';
import { useVoiceRefresh } from '../hooks/useVoiceRefresh';
import { playVoiceDesignPreview, type VoiceDesignEngine } from '../services/voiceDesignPreview';
import { voiceApi } from '../services/api';
import { VoiceAvatar } from '../components/ui/VoiceAvatar';
import { t } from '../i18n';
import type { TTSResult, VoiceProfile } from '../types';
import styles from './VoiceClone.module.css';

/** 克隆引擎类型 */
type CloneEngine = 'qwen' | 'mimo' | 'voxcpm';

/** 克隆流程步骤 */
type CloneStep = 'choose-method' | 'input' | 'preview-clone';

/** 输入方式 */
type InputMethod = 'record' | 'upload' | 'url' | null;

/** 活跃面板 */
type ActivePanel = null | 'design' | 'clone';

/** 设计流程阶段 */
type DesignPhase = 'idle' | 'previewing' | 'previewed' | 'saving';

/** 引擎标签 */
function engineLabel(profile: VoiceProfile): string {
  if (profile.clone_engine === 'mimo') return 'MiMo';
  if (profile.clone_engine === 'voxcpm') return 'VoxCPM';
  if (profile.clone_engine === 'qwen') return 'CosyVoice';
  return 'Unknown';
}

export function VoiceClone() {
  // ---- 声音列表 ----
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const { refreshCounter, triggerRefresh } = useVoiceRefresh();

  // ---- 活跃面板 ----
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  // ---- 克隆流程状态 ----
  const [cloneStep, setCloneStep] = useState<CloneStep>('choose-method');
  const [cloneMethod, setCloneMethod] = useState<InputMethod>(null);
  const [cloneEngine, setCloneEngine] = useState<CloneEngine>('qwen');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [urlVoice, setUrlVoice] = useState<VoiceProfile | null>(null);

  // ---- 设计流程状态 ----
  const [designEngine, setDesignEngine] = useState<'mimo' | 'voxcpm'>('mimo');
  const [designName, setDesignName] = useState('');
  const [designAvatar, setDesignAvatar] = useState<string | null>(null);
  const [designBrief, setDesignBrief] = useState('');
  const [designPhase, setDesignPhase] = useState<DesignPhase>('idle');
  const [designPreview, setDesignPreview] = useState<TTSResult | null>(null);
  const [designError, setDesignError] = useState('');
  const [designStatus, setDesignStatus] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [designSampleText, setDesignSampleText] = useState('这是一段试听文本，用来确认这个音色是否适合你的项目。');
  const [designIntensity, setDesignIntensity] = useState(72);
  const [designStability, setDesignStability] = useState(68);

  // ---- CosyVoice 同步状态 ----
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ---- 加载声音列表 ----
  const loadVoices = useCallback(async () => {
    setVoicesLoading(true);
    try {
      const all = await voiceApi.list();
      setVoices(all.filter(v => v.audio_url));
    } catch (err) {
      console.error('加载声音列表失败:', err);
    } finally {
      setVoicesLoading(false);
    }
  }, []);

  useEffect(() => { loadVoices(); }, [loadVoices, refreshCounter]);

  // ---- 克隆流程 ----
  const resetClone = () => {
    setCloneStep('choose-method');
    setCloneMethod(null);
    setPendingFile(null);
    setUrlVoice(null);
  };

  const handleCloneSuccess = () => {
    triggerRefresh();
    resetClone();
    setActivePanel(null);
  };

  // ---- CosyVoice 同步云端音色 ----
  const handleSyncQwen = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await voiceApi.syncFromQwen();
      setSyncMessage({ type: 'success', text: result.message || '同步完成' });
      loadVoices();
      triggerRefresh();
    } catch (err) {
      setSyncMessage({ type: 'error', text: err instanceof Error ? err.message : '同步失败' });
    } finally {
      setSyncing(false);
    }
  };

  // ---- 设计流程 ----
  const handleDesignPreview = async () => {
    setDesignPhase('previewing');
    setDesignError('');
    setDesignStatus('');
    try {
      const preview = await playVoiceDesignPreview({
        engine: designEngine as VoiceDesignEngine,
        voiceDescription: designBrief,
        sampleText: designSampleText || '这是一段试听文本。',
        intensity: designIntensity,
        stability: designStability,
      });
      setDesignPreview(preview);
      setDesignPhase('previewed');
      setDesignStatus(`${t('voiceDesign.previewGenerated')} · ${preview.audio_format || (designEngine === 'voxcpm' ? 'wav' : 'mp3')}`);
    } catch (error) {
      console.error('[voice-design] preview failed:', error);
      setDesignError(error instanceof Error ? error.message : '后端试听失败，请检查模型配置');
      setDesignPhase('idle');
    }
  };

  const handleDesignSave = async () => {
    if (!designPreview?.audio_base64 && !designPreview?.audio_url) {
      setDesignError('没有可保存的音频，请先试听');
      return;
    }
    setDesignPhase('saving');
    setDesignError('');
    try {
      // 如果只有 audio_url 没有 audio_base64，先获取并转换
      let audioBase64 = designPreview.audio_base64 || '';
      if (!audioBase64 && designPreview.audio_url) {
        const resp = await fetch(designPreview.audio_url);
        const blob = await resp.blob();
        const reader = new FileReader();
        audioBase64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1] || '');
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      if (!audioBase64) {
        setDesignError('无法获取音频数据');
        setDesignPhase('previewed');
        return;
      }
      const saved = await voiceApi.createFromDesign({
        audio_base64: audioBase64,
        engine: designEngine,
        name: designName.trim() || designBrief.trim().slice(0, 50) || 'Untitled Voice Profile',
        description: designBrief,
        avatar: designAvatar || undefined,
      });
      setVoices(prev => [saved, ...prev.filter(v => v.id !== saved.id)]);
      setDesignStatus('已保存为 Voice Profile');
      triggerRefresh();
      // 关闭面板
      setTimeout(() => {
        setActivePanel(null);
        setDesignPhase('idle');
        setDesignName('');
        setDesignAvatar(null);
        setDesignBrief('');
        setDesignPreview(null);
        setDesignStatus('');
      }, 1200);
    } catch (err) {
      setDesignError(err instanceof Error ? err.message : '保存失败');
      setDesignPhase('previewed');
    }
  };

  const resetDesign = () => {
    setActivePanel(null);
    setDesignPhase('idle');
    setDesignName('');
    setDesignAvatar(null);
    setDesignBrief('');
    setDesignPreview(null);
    setDesignError('');
    setDesignStatus('');
  };

  // ============================================================
  //  Render
  // ============================================================

  return (
    <div className={styles.container}>
      {/* Header */}
      <section className={styles.headerBar}>
        <div className={styles.headerText}>
          <h1>音色设计</h1>
          <p>管理可复用的全局音色资产，支持克隆和文本描述设计，可绑定到项目角色。</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => { setActivePanel('design'); setDesignPhase('idle'); }}
          >
            设计新音色
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => { setActivePanel('clone'); resetClone(); }}
          >
            克隆声音
          </button>
        </div>
      </section>

      {/* 内联面板：设计流程 */}
      {activePanel === 'design' && (
        <section className={styles.inlinePanel}>
          <div className={styles.inlinePanelHeader}>
            <h3>设计新音色</h3>
            <button type="button" className={styles.closeBtn} onClick={resetDesign}>✕</button>
          </div>

          {/* 音色身份：头像 + 名称 */}
          <div className={styles.identityRow}>
            <ImageUploadZone
              value={designAvatar}
              onChange={(dataUrl) => setDesignAvatar(dataUrl)}
              size="md"
            />
            <div className={styles.identityFields}>
              <label className={styles.designLabel}>
                音色名称
                <input
                  className={styles.designInput}
                  value={designName}
                  onChange={e => setDesignName(e.target.value)}
                  placeholder="如：纪录片旁白、温柔女声..."
                />
              </label>
            </div>
          </div>

          {/* 引擎选择 */}
          <div className={styles.engineSwitch}>
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

          {/* 音色描述 */}
          <label className={styles.designLabel}>
            音色描述
            <textarea
              className={styles.designTextarea}
              value={designBrief}
              onChange={e => setDesignBrief(e.target.value)}
              placeholder="描述你想要的音色，如：年轻女性，温柔甜美，语速适中..."
              rows={3}
            />
          </label>

          {/* 试听文本 */}
          <label className={styles.designLabel}>
            试听文本
            <textarea
              className={styles.designTextarea}
              value={designSampleText}
              onChange={e => setDesignSampleText(e.target.value)}
              placeholder="输入用于试听的文本内容..."
              rows={2}
            />
          </label>

          {/* 高级参数（折叠） */}
          <div className={styles.advancedToggle} onClick={() => setShowAdvanced(!showAdvanced)}>
            <span>{showAdvanced ? '▼' : '▶'} 高级参数</span>
          </div>
          {showAdvanced && (
            <div className={styles.advancedPanel}>
              <label className={styles.sliderLabel}>
                表现强度
                <input type="range" min={0} max={100} value={designIntensity} onChange={e => setDesignIntensity(Number(e.target.value))} />
                <span>{designIntensity}</span>
              </label>
              <label className={styles.sliderLabel}>
                稳定性
                <input type="range" min={0} max={100} value={designStability} onChange={e => setDesignStability(Number(e.target.value))} />
                <span>{designStability}</span>
              </label>
            </div>
          )}

          {/* 操作按钮 */}
          <div className={styles.designActions}>
            {designPhase === 'idle' && (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handleDesignPreview}
                disabled={!designBrief.trim()}
              >
                试听音色
              </button>
            )}
            {designPhase === 'previewing' && (
              <button type="button" className={styles.primaryBtn} disabled>生成中...</button>
            )}
            {designPhase === 'previewed' && (
              <>
                <button type="button" className={styles.ghostBtn} onClick={handleDesignPreview}>重新生成</button>
                <button type="button" className={styles.primaryBtn} onClick={handleDesignSave}>确认保存</button>
              </>
            )}
            {designPhase === 'saving' && (
              <button type="button" className={styles.primaryBtn} disabled>保存中...</button>
            )}
          </div>

          {/* 试听音频播放器（可重复播放） */}
          {(designPreview?.audio_base64 || designPreview?.audio_url) && (
            <audio
              controls
              className={styles.designAudioPlayer}
              src={designPreview.audio_base64
                ? `data:audio/${designPreview.audio_format || (designEngine === 'voxcpm' ? 'wav' : 'mp3')};base64,${designPreview.audio_base64}`
                : designPreview.audio_url!}
            />
          )}

          {designStatus && <div className={styles.statusMsg}>{designStatus}</div>}
          {designError && <div className={styles.errorMsg}>{designError}</div>}
        </section>
      )}

      {/* 内联面板：克隆流程 */}
      {activePanel === 'clone' && (
        <section className={styles.inlinePanel}>
          <div className={styles.inlinePanelHeader}>
            <h3>克隆声音</h3>
            <button type="button" className={styles.closeBtn} onClick={() => { setActivePanel(null); resetClone(); }}>✕</button>
          </div>

          {/* 引擎选择 */}
          <div className={styles.engineSwitch}>
            {(['qwen', 'mimo', 'voxcpm'] as CloneEngine[]).map(e => (
              <button
                key={e}
                className={`${styles.engineOption} ${cloneEngine === e ? styles.active : ''}`}
                onClick={() => setCloneEngine(e)}
              >
                {e === 'qwen' ? 'CosyVoice' : e === 'mimo' ? 'MiMo-TTS' : 'VoxCPM'}
              </button>
            ))}
          </div>

          {/* CosyVoice 同步云端音色 */}
          {cloneEngine === 'qwen' && (
            <div className={styles.syncSection}>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={handleSyncQwen}
                disabled={syncing}
              >
                {syncing ? '同步中...' : '同步云端音色'}
              </button>
              {syncMessage && (
                <div className={syncMessage.type === 'success' ? styles.statusMsg : styles.errorMsg}>
                  {syncMessage.text}
                </div>
              )}
            </div>
          )}

          {/* 克隆步骤 */}
          {cloneStep === 'choose-method' && (
            <div className={styles.methodCards}>
              <button className={styles.methodCard} onClick={() => { setCloneMethod('record'); setCloneStep('input'); }}>
                <span className={styles.methodTitle}>新建声音</span>
                <span className={styles.methodDesc}>录制或上传音频，创建新的克隆声音</span>
              </button>
              <button className={styles.methodCard} onClick={() => { setCloneMethod('upload'); setCloneStep('input'); }}>
                <span className={styles.methodTitle}>上传文件</span>
                <span className={styles.methodDesc}>上传 MP3、WAV、WebM 音频文件</span>
              </button>
              {cloneEngine === 'qwen' && (
                <button className={styles.methodCard} onClick={() => { setCloneMethod('url'); setCloneStep('input'); }}>
                  <span className={styles.methodTitle}>公网地址</span>
                  <span className={styles.methodDesc}>提供已有音频文件的公网 URL</span>
                </button>
              )}
            </div>
          )}

          {cloneStep === 'input' && (
            <div className={styles.inputStep}>
              <button className={styles.backButton} onClick={() => { setCloneStep('choose-method'); setCloneMethod(null); }}>
                ← 返回选择方式
              </button>
              {cloneMethod === 'record' && (
                <AudioRecorder onRecordComplete={file => { setPendingFile(file); setCloneStep('preview-clone'); }} />
              )}
              {cloneMethod === 'upload' && (
                <AudioUploader onFileSelected={file => { setPendingFile(file); setCloneStep('preview-clone'); }} />
              )}
              {cloneMethod === 'url' && (
                <UrlInput
                  onUrlConfirmed={voice => { setUrlVoice(voice); setCloneStep('preview-clone'); }}
                  onBack={() => { setCloneStep('choose-method'); setCloneMethod(null); }}
                />
              )}
            </div>
          )}

          {cloneStep === 'preview-clone' && (
            <div className={styles.inputStep}>
              <button className={styles.backButton} onClick={resetClone}>← 返回选择方式</button>
              {pendingFile && (
                <AudioPreview file={pendingFile} engine={cloneEngine} onCloneSuccess={handleCloneSuccess} onCancel={resetClone} />
              )}
              {urlVoice && (
                <AudioPreview voiceId={urlVoice.id} audioUrl={urlVoice.audio_url} engine={cloneEngine} onCloneSuccess={handleCloneSuccess} onCancel={resetClone} />
              )}
            </div>
          )}
        </section>
      )}

      {/* 声音卡片网格 */}
      <section className={styles.voiceSection}>
        <div className={styles.sectionHeader}>
          <h2>Voice Profiles</h2>
          <span className={styles.voiceCount}>{voices.length} 个音色</span>
        </div>

        {voicesLoading ? (
          <div className={styles.loading}>加载中...</div>
        ) : voices.length === 0 ? (
          <div className={styles.emptyState}>
            <p>还没有音色，点击上方按钮设计或克隆第一个音色。</p>
          </div>
        ) : (
          <div className={styles.voiceGrid}>
            {voices.map(v => (
              <article key={v.id} className={styles.voiceCard}>
                <VoiceAvatar
                  avatar={v.avatar ?? null}
                  name={v.name}
                  engine={v.clone_engine || 'edge_tts'}
                  size={40}
                />
                <div className={styles.voiceCardBody}>
                  <strong className={styles.voiceCardName}>{v.name || v.description || '未命名'}</strong>
                  <div className={styles.voiceCardChips}>
                    <span className={styles.chipEngine}>{engineLabel(v)}</span>
                    {v.description && v.description !== v.name && (
                      <span className={styles.chipDesc}>{v.description.slice(0, 30)}</span>
                    )}
                  </div>
                </div>
                <div className={styles.voiceCardActions}>
                  <button
                    type="button"
                    className={styles.previewBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      const audio = new Audio(v.audio_url);
                      audio.play().catch(() => {});
                    }}
                  >试听</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
