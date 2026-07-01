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
  const model = profile.voice?.model;
  if (model === 'mimo_tts') return 'MiMo';
  if (model === 'voxcpm') return 'VoxCPM';
  if (model === 'cosyvoice') return 'CosyVoice';
  if (model === 'edge_tts') return 'Edge-TTS';
  return 'Unknown';
}

/** 音色描述标签 */
function voiceDescriptionLabel(profile: VoiceProfile): string {
  const model = profile.voice?.model || '';
  const params = (profile.voice_params?.[model]?.params || {}) as Record<string, unknown>;
  return (params.voice_description as string) || '';
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
  const [designSampleText, setDesignSampleText] = useState('');
  useEffect(() => {
    setDesignSampleText(t('voiceDesign.defaultSampleText'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);
  const [designIntensity, setDesignIntensity] = useState(72);
  const [designStability, setDesignStability] = useState(68);

  // ---- 编辑/删除状态 ----
  const [editingVoice, setEditingVoice] = useState<VoiceProfile | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  // ---- CosyVoice 同步云端音色 ----
  const handleSyncQwen = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await voiceApi.syncFromQwen();
      setSyncMessage({ type: 'success', text: result.message || t('voiceClone.syncComplete') });
      loadVoices();
      triggerRefresh();
    } catch (err) {
      setSyncMessage({ type: 'error', text: err instanceof Error ? err.message : t('voiceClone.syncFailed') });
    } finally {
      setSyncing(false);
    }
  };

  // ---- 编辑/删除 ----
  const handleStartEdit = (voice: VoiceProfile) => {
    setEditingVoice(voice);
    const model = voice.voice?.model;
    if (model === 'mimo_tts') setCloneEngine('mimo');
    else if (model === 'voxcpm') setCloneEngine('voxcpm');
    else if (model === 'cosyvoice') setCloneEngine('qwen');
    else setCloneEngine('qwen');
    setActivePanel('clone');
    setCloneStep('choose-method');
    setCloneMethod(null);
    setPendingFile(null);
    setUrlVoice(null);
  };

  const handleCloneSuccess = async () => {
    // 编辑模式：克隆成功后删除旧声音
    if (editingVoice) {
      try { await voiceApi.delete(editingVoice.id); } catch { /* ignore */ }
    }
    setEditingVoice(null);
    triggerRefresh();
    resetClone();
    setActivePanel(null);
  };

  const handleDelete = async (voiceId: string) => {
    setDeletingId(voiceId);
    try {
      await voiceApi.delete(voiceId);
      setVoices(prev => prev.filter(v => v.id !== voiceId));
      triggerRefresh();
    } catch (err) {
      console.error('Failed to delete voice:', err);
    } finally {
      setDeletingId(null);
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
        sampleText: designSampleText || t('voiceDesign.defaultSampleText'),
        intensity: designIntensity,
        stability: designStability,
      });
      setDesignPreview(preview);
      setDesignPhase('previewed');
      setDesignStatus(`${t('voiceDesign.previewGenerated')} · ${preview.audio_format || (designEngine === 'voxcpm' ? 'wav' : 'mp3')}`);
    } catch (error) {
      console.error('[voice-design] preview failed:', error);
      setDesignError(error instanceof Error ? error.message : t('voiceDesign.previewFailed'));
      setDesignPhase('idle');
    }
  };

  const handleDesignSave = async () => {
    if (!designPreview?.audio_base64 && !designPreview?.audio_url) {
      setDesignError(t('voiceDesign.noAudioToSave'));
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
        setDesignError(t('voiceDesign.cannotGetAudio'));
        setDesignPhase('previewed');
        return;
      }
      const saved = await voiceApi.createFromDesign({
        audio_base64: audioBase64,
        engine: designEngine,
        name: designName.trim() || designBrief.trim().slice(0, 50) || 'Untitled Voice Profile',
        description: designBrief,
        avatar: designAvatar || undefined,
        preview_text: designSampleText || 'This is a preview text.',
        original_prompt_text: designBrief,
      });
      setVoices(prev => [saved, ...prev.filter(v => v.id !== saved.id)]);
      setDesignStatus(t('voiceDesign.savedAsProfile'));
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
      setDesignError(err instanceof Error ? err.message : t('voiceDesign.saveFailed'));
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
          <h1>{t('voiceDesign.title')}</h1>
          <p>{t('voiceDesign.description')}</p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => { setActivePanel('design'); setDesignPhase('idle'); }}
          >
            {t('voiceDesign.designNew')}
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => { setActivePanel('clone'); resetClone(); }}
          >
            {t('voiceDesign.cloneSound')}
          </button>
        </div>
      </section>

      {/* 内联面板：设计流程 */}
      {activePanel === 'design' && (
        <section className={styles.inlinePanel}>
          <div className={styles.inlinePanelHeader}>
            <h3>{t('voiceDesign.designNewTitle')}</h3>
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
                {t('voiceDesign.voiceName')}
                <input
                  className={styles.designInput}
                  value={designName}
                  onChange={e => setDesignName(e.target.value)}
                  placeholder={t('voiceDesign.voiceNamePlaceholder')}
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
            {t('voiceDesign.voiceDescription')}
            <textarea
              className={styles.designTextarea}
              value={designBrief}
              onChange={e => setDesignBrief(e.target.value)}
              placeholder={t('voiceDesign.voiceDescriptionPlaceholder')}
              rows={3}
            />
          </label>

          {/* 试听文本 */}
          <label className={styles.designLabel}>
            {t('voiceDesign.sampleText')}
            <textarea
              className={styles.designTextarea}
              value={designSampleText}
              onChange={e => setDesignSampleText(e.target.value)}
              placeholder={t('voiceDesign.sampleTextPlaceholder')}
              rows={2}
            />
          </label>

          {/* 高级参数（折叠） */}
          <div className={styles.advancedToggle} onClick={() => setShowAdvanced(!showAdvanced)}>
            <span>{showAdvanced ? '▼' : '▶'} {t('voxcpm.advancedParams')}</span>
          </div>
          {showAdvanced && (
            <div className={styles.advancedPanel}>
              <label className={styles.sliderLabel}>
                {t('voiceDesign.intensity')}
                <input type="range" min={0} max={100} value={designIntensity} onChange={e => setDesignIntensity(Number(e.target.value))} />
                <span>{designIntensity}</span>
              </label>
              <label className={styles.sliderLabel}>
                {t('voiceDesign.stability')}
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
                  {t('voiceDesign.previewVoice')}
                </button>
            )}
            {designPhase === 'previewing' && (
              <button type="button" className={styles.primaryBtn} disabled>{t('voiceDesign.generating')}</button>
            )}
            {designPhase === 'previewed' && (
              <>
                <button type="button" className={styles.ghostBtn} onClick={handleDesignPreview}>{t('voiceDesign.regenerate')}</button>
                <button type="button" className={styles.primaryBtn} onClick={handleDesignSave}>{t('voiceDesign.confirmSave')}</button>
              </>
            )}
            {designPhase === 'saving' && (
              <button type="button" className={styles.primaryBtn} disabled>{t('voiceDesign.saving')}</button>
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

          {designStatus && <div className={styles.statusMsg}>{t(designStatus)}</div>}
          {designError && <div className={styles.errorMsg}>{t(designError)}</div>}
        </section>
      )}

      {/* 内联面板：克隆流程 */}
      {activePanel === 'clone' && (
        <section className={styles.inlinePanel}>
          <div className={styles.inlinePanelHeader}>
            <h3>{editingVoice ? t('voiceDesign.editTitle') : t('voiceDesign.cloneSound')}</h3>
            <button type="button" className={styles.closeBtn} onClick={() => { setActivePanel(null); setEditingVoice(null); resetClone(); }}>✕</button>
          </div>
          {editingVoice && (
            <div style={{ padding: '0.5rem 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              {t('voiceDesign.replaceNotice', { name: editingVoice.name || editingVoice.description || t('common.unknown') })}
            </div>
          )}

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
                {syncing ? t('common.loading') : t('voiceClone.syncCloud')}
              </button>
              {syncMessage && (
                <div className={syncMessage.type === 'success' ? styles.statusMsg : styles.errorMsg}>
                  {syncMessage.text}
                </div>
              )}
            </div>
          )}

          {/* 编辑模式：展示已有音频 + 重新操作 */}
          {editingVoice && cloneStep === 'choose-method' && (
            <div className={styles.inputStep}>
              {editingVoice.source_audio_url && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '0.25rem' }}>{t('voiceDesign.originalAudio')}</div>
                  <audio controls style={{ width: '100%' }} src={editingVoice.source_audio_url} />
                </div>
              )}
              {editingVoice.preview_audio_url && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '0.25rem' }}>{t('voiceDesign.clonePreview')}</div>
                  <audio controls style={{ width: '100%' }} src={editingVoice.preview_audio_url} />
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className={styles.ghostBtn} onClick={() => { setCloneMethod('record'); setCloneStep('input'); }}>{t('voiceClone.reRecord')}</button>
                <button type="button" className={styles.ghostBtn} onClick={() => { setCloneMethod('upload'); setCloneStep('input'); }}>{t('voiceClone.reUpload')}</button>
                {cloneEngine === 'qwen' && (
                  <button type="button" className={styles.ghostBtn} onClick={() => { setCloneMethod('url'); setCloneStep('input'); }}>{t('voiceClone.reInputUrl')}</button>
                )}
              </div>
            </div>
          )}

          {/* 克隆步骤：新建 或 编辑模式点击重新操作后 */}
          {cloneStep === 'choose-method' && !editingVoice && (
            <div className={styles.methodCards}>
              <button className={styles.methodCard} onClick={() => { setCloneMethod('record'); setCloneStep('input'); }}>
                <span className={styles.methodTitle}>{t('voiceClone.newVoice')}</span>
                <span className={styles.methodDesc}>{t('voiceClone.newVoiceDesc')}</span>
              </button>
              <button className={styles.methodCard} onClick={() => { setCloneMethod('upload'); setCloneStep('input'); }}>
                <span className={styles.methodTitle}>{t('voiceClone.uploadFile')}</span>
                <span className={styles.methodDesc}>{t('voiceClone.uploadFileDesc')}</span>
              </button>
              {cloneEngine === 'qwen' && (
                <button className={styles.methodCard} onClick={() => { setCloneMethod('url'); setCloneStep('input'); }}>
                  <span className={styles.methodTitle}>{t('voiceClone.publicUrl')}</span>
                  <span className={styles.methodDesc}>{t('voiceClone.publicUrlDesc')}</span>
                </button>
              )}
            </div>
          )}

          {cloneStep === 'input' && (
            <div className={styles.inputStep}>
              <button className={styles.backButton} onClick={() => { setCloneStep('choose-method'); setCloneMethod(null); }}>
                ← {t('voiceClone.backToMethod')}
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
              <button className={styles.backButton} onClick={resetClone}>← {t('voiceClone.backToMethod')}</button>
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
          <h2>{t('voiceDesign.voiceProfile')}</h2>
          <span className={styles.voiceCount}>{t('voiceClone.voiceCount', { count: voices.length })}</span>
        </div>

        {voicesLoading ? (
          <div className={styles.loading}>{t('common.loading')}</div>
        ) : voices.length === 0 ? (
          <div className={styles.emptyState}>
            <p>{t('voiceClone.noVoices')}</p>
          </div>
        ) : (
          <div className={styles.voiceGrid}>
            {voices.map(v => (
              <article key={v.id} className={styles.voiceCard}>
                <VoiceAvatar
                  avatar={v.avatar ?? null}
                  name={v.name}
                  engine={v.voice?.model || 'edge_tts'}
                  size={40}
                />
                <div className={styles.voiceCardBody}>
                  <strong className={styles.voiceCardName}>{v.name || v.description || t('common.unnamed')}</strong>
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
                  >{t('common.listen')}</button>
                  <button
                    type="button"
                    className={styles.previewBtn}
                    onClick={(e) => { e.stopPropagation(); handleStartEdit(v); }}
                    style={{ color: 'var(--color-text-secondary)' }}
                  >{t('common.edit')}</button>
                  <button
                    type="button"
                    className={styles.previewBtn}
                    onClick={(e) => { e.stopPropagation(); handleDelete(v.id); }}
                    disabled={deletingId === v.id}
                    style={{ color: 'var(--color-danger, #ef4444)' }}
                  >{deletingId === v.id ? t('voiceClone.deleting') : t('common.delete')}</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
