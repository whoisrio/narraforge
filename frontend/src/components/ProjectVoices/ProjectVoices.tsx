import { useEffect, useState, useCallback } from 'react';
import type { Role, RoleSnapshot, SegmentEngineParams, VoiceProfile } from '../../types';
import { ttsApi, voiceApi } from '../../services/api';
import { fetchVoiceRolePreview } from '../../services/voiceRolePreview';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
import { DEFAULT_EDGE_CAST_VOICE, DEFAULT_EDGE_NARRATOR_VOICE } from '../../services/voiceRoleDefaults';
import { isNarratorRole } from '../../services/voiceRoleKind';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import { ImageUploadZone } from '../ui/ImageUploadZone';
import { StyleInstructionPicker } from '../TTSSynthesis/StyleInstructionPicker';
import styles from './ProjectVoices.module.css';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ProjectVoicesProps {
  roles: Role[];
  defaultNarratorRoleId?: string | null;
  onSetDefaultNarrator: (roleId: string | null, roleSnapshot: RoleSnapshot | null) => void;
  onCreateDefaultNarrator?: () => void;
  onCreateCast?: () => void;
  onSaveRole?: (role: RoleSnapshot) => void | Promise<void>;
  onDeleteRole?: (roleId: string) => void;
  onPreviewRole: (role: RoleSnapshot, sampleText: string) => void;
  onManageRoles: () => void;
  defaultNarratorPreviewLabel?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const NARRATOR_SAMPLE = '这是一段默认旁白试听，用于确认叙述声音是否沉稳、清晰，并适合长时间解说。';
const CAST_SAMPLE = '你好，我是这个角色的声音。请确认语气、节奏和音色是否符合当前场景。';
const MIMO_PRESET_VOICES = ['冰糖', '星辰', '雪梨', '琥珀', '青云', '紫霞'];
const COMMON_EDGE_VOICES = [
  { short_name: DEFAULT_EDGE_NARRATOR_VOICE, display_name: 'Yunxi', gender: 'Male' },
  { short_name: DEFAULT_EDGE_CAST_VOICE, display_name: 'Yunyang', gender: 'Male' },
  { short_name: 'zh-CN-XiaoxiaoNeural', display_name: 'Xiaoxiao', gender: 'Female' },
];

type EngineKey = 'edge_tts' | 'cosyvoice' | 'mimo_tts' | 'voxcpm';

const ENGINE_META: Record<EngineKey, { label: string; avatarClass: string }> = {
  edge_tts: { label: 'Edge-TTS', avatarClass: styles.avatarEdge },
  cosyvoice: { label: 'CosyVoice', avatarClass: styles.avatarCosy },
  mimo_tts: { label: 'MiMo', avatarClass: styles.avatarMimo },
  voxcpm: { label: 'VoxCPM', avatarClass: styles.avatarVoxcpm },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function roleToSnapshot(role: Role): RoleSnapshot {
  return {
    id: role.id,
    name: role.name,
    avatar: role.avatar,
    description: role.description,
    default_engine: role.default_engine,
    default_voice: role.default_voice,
    default_engine_params: { ...role.default_engine_params },
    favorite_styles: [...role.favorite_styles],
  };
}

function engineLabel(role: Role): string {
  return ENGINE_META[role.default_engine as EngineKey]?.label ?? role.default_engine;
}

function isConfigured(role: Role): boolean {
  return !!(role.default_voice || role.default_engine_params.edge_voice || role.default_engine_params.voice_id || role.default_engine_params.mimo_preset_voice);
}

function createRoleDraft(kind: 'Narrator' | 'Cast'): RoleSnapshot {
  const edgeVoice = kind === 'Narrator' ? DEFAULT_EDGE_NARRATOR_VOICE : DEFAULT_EDGE_CAST_VOICE;
  return {
    id: `role-${kind.toLowerCase()}-${Date.now()}`,
    name: kind === 'Narrator' ? '默认旁白' : '新 Cast',
    avatar: '',
    description: kind,
    default_engine: 'edge_tts',
    default_voice: edgeVoice,
    default_engine_params: { engine: 'edge_tts', edge_voice: edgeVoice, edge_rate: '+0%', edge_volume: '+0%' },
    favorite_styles: [],
  };
}

function normalizeDraftForSave(draft: RoleSnapshot): RoleSnapshot {
  const params = { ...draft.default_engine_params, engine: draft.default_engine } as SegmentEngineParams;
  const defaultVoice = draft.default_engine === 'edge_tts'
    ? params.edge_voice ?? ''
    : draft.default_engine === 'cosyvoice'
      ? params.voice_id ?? ''
      : draft.default_engine === 'mimo_tts'
        ? params.mimo_clone_voice_id || params.mimo_preset_voice || params.mimo_voice_description || ''
        : params.voice_id || params.voxcpm_voice_description || '';
  return { ...draft, default_voice: defaultVoice, default_engine_params: params };
}

/* ------------------------------------------------------------------ */
/*  Voice source category types                                        */
/* ------------------------------------------------------------------ */

type VoiceSourceCategory = 'preset' | 'clone' | 'design';

const VOICE_SOURCE_TABS: { value: VoiceSourceCategory; label: string; desc: string }[] = [
  { value: 'preset', label: '模型预制音色', desc: 'Edge-TTS / MiMo 系统音色' },
  { value: 'clone', label: '克隆音色', desc: 'CosyVoice / MiMo / VoxCPM 克隆' },
  { value: 'design', label: '设计新音色', desc: 'MiMo / VoxCPM 文本描述设计' },
];

/** 判断当前 draft 属于哪个音色来源分类 */
function detectCategory(draft: RoleSnapshot): VoiceSourceCategory {
  const p = draft.default_engine_params;
  if (draft.default_engine === 'mimo_tts' && p.mimo_mode === 'voicedesign') return 'design';
  if (draft.default_engine === 'voxcpm' && p.voxcpm_mode === 'design') return 'design';
  if (draft.default_engine === 'edge_tts') return 'preset';
  if (draft.default_engine === 'mimo_tts' && (p.mimo_mode ?? 'preset') === 'preset') return 'preset';
  return 'clone';
}

/* ------------------------------------------------------------------ */
/*  VoiceRoleEditor (inline)                                           */
/* ------------------------------------------------------------------ */

function VoiceRoleEditor({
  draft,
  onChange,
  onCancel,
  onSave,
  onPreview,
  saving = false,
}: {
  draft: RoleSnapshot;
  onChange: (draft: RoleSnapshot) => void;
  onCancel: () => void;
  onSave: (draft: RoleSnapshot) => void;
  onPreview: (draft: RoleSnapshot, sampleText: string) => void;
  saving?: boolean;
}) {
  const params = draft.default_engine_params;
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [edgeVoices, setEdgeVoices] = useState<{ short_name: string; display_name: string; gender: string }[]>(COMMON_EDGE_VOICES);
  const { refreshCounter } = useVoiceRefresh();

  // 音色来源分类
  const [voiceCategory, setVoiceCategory] = useState<VoiceSourceCategory>(() => detectCategory(draft));

  // 克隆流程状态
  const [cloneSubEngine, setCloneSubEngine] = useState<'cosyvoice' | 'mimo' | 'voxcpm'>('mimo');
  const [voxcpmCloneMode, setVoxcpmCloneMode] = useState<'clone' | 'ultimate'>('clone');
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneStep, setCloneStep] = useState<'select' | 'input' | 'cloning'>('select');
  const [cloneError, setCloneError] = useState('');

  // 音色设计流程状态
  const [designSubEngine, setDesignSubEngine] = useState<'mimo' | 'voxcpm'>('mimo');
  const [designPhase, setDesignPhase] = useState<'idle' | 'previewing' | 'previewed' | 'saving'>('idle');
  const [designAudioBase64, setDesignAudioBase64] = useState('');
  const [designAudioSrc, setDesignAudioSrc] = useState('');
  const [designError, setDesignError] = useState('');

  const isDesignMode = voiceCategory === 'design';

  const voiceDescription = designSubEngine === 'mimo'
    ? (params.mimo_voice_description ?? '')
    : (params.voxcpm_voice_description ?? '');

  const setVoiceDescription = (desc: string) => {
    if (designSubEngine === 'mimo') {
      setParams({ mimo_voice_description: desc });
    } else {
      setParams({ voxcpm_voice_description: desc });
    }
  };

  const handleDesignPreview = useCallback(async () => {
    setDesignPhase('previewing');
    setDesignError('');
    try {
      const result = await fetchVoiceRolePreview(
        normalizeDraftForSave(draft),
        '这是一段角色试听文本，用来确认音色、节奏和情绪是否适合当前项目。',
      );
      if (result.audio_base64) {
        setDesignAudioBase64(result.audio_base64);
        setDesignAudioSrc(`data:audio/${result.audio_format || 'wav'};base64,${result.audio_base64}`);
        setDesignPhase('previewed');
      } else if (result.audio_url) {
        setDesignAudioBase64('');
        setDesignAudioSrc(result.audio_url);
        setDesignPhase('previewed');
      } else {
        setDesignError('未返回音频数据');
        setDesignPhase('idle');
      }
    } catch (err) {
      setDesignError(err instanceof Error ? err.message : '试听失败');
      setDesignPhase('idle');
    }
  }, [draft]);

  const handleDesignConfirmSave = useCallback(async () => {
    if (!designAudioBase64 && !designAudioSrc) {
      setDesignError('没有可保存的音频，请先试听');
      return;
    }
    setDesignPhase('saving');
    setDesignError('');
    try {
      let audioBase64 = designAudioBase64;
      if (!audioBase64 && designAudioSrc) {
        const resp = await fetch(designAudioSrc);
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
      const engine = designSubEngine === 'mimo' ? 'mimo' : 'voxcpm';
      const profile = await voiceApi.createFromDesign({
        audio_base64: audioBase64,
        engine,
        name: draft.name,
        description: voiceDescription,
      });
      // 设计完成 → 自动切换为克隆模式，绑定新声音
      const updatedParams: SegmentEngineParams = designSubEngine === 'mimo'
        ? { engine: 'mimo_tts', mimo_mode: 'voiceclone', mimo_clone_voice_id: profile.id, mimo_instruction: params.mimo_instruction || '' }
        : { engine: 'voxcpm', voxcpm_mode: 'clone', voice_id: profile.id, voxcpm_style_control: params.voxcpm_style_control || '', voxcpm_cfg_value: params.voxcpm_cfg_value ?? 2, voxcpm_inference_timesteps: params.voxcpm_inference_timesteps ?? 10 };
      onChange({ ...draft, default_engine: updatedParams.engine, default_engine_params: updatedParams });
      setDesignPhase('idle');
      setDesignAudioBase64('');
      setVoiceCategory('clone');
    } catch (err) {
      setDesignError(err instanceof Error ? err.message : '保存失败');
      setDesignPhase('previewed');
    }
  }, [draft, designAudioBase64, designSubEngine, voiceDescription, params, onChange]);

  // 加载 VoiceProfile 列表（CosyVoice 克隆声音 + 全部声音）
  useEffect(() => {
    ttsApi.getVoices().then(setVoices).catch(() => {});
  }, [refreshCounter]);

  useEffect(() => {
    ttsApi.getEdgeVoices('Chinese').then(setEdgeVoices).catch(() => {});
  }, []);

  // 按 clone_engine 过滤声音列表
  const cosyVoiceCloneVoices = voices.filter(v => v.clone_engine === 'qwen');
  const mimoCloneVoices = voices.filter(v => v.clone_engine === 'mimo');
  const voxcpmCloneVoices = voices.filter(v => v.clone_engine === 'voxcpm');
  // MiMo voiceclone 也可选 VoxCPM 设计的声音
  const mimoAvailableCloneVoices = voices.filter(v => v.clone_engine === 'mimo' || v.clone_engine === 'voxcpm');

  const setEngine = (engine: SegmentEngineParams['engine']) => {
    const nextParams: SegmentEngineParams = engine === 'edge_tts'
      ? { engine, edge_voice: params.edge_voice || DEFAULT_EDGE_CAST_VOICE, edge_rate: params.edge_rate || '+0%', edge_volume: params.edge_volume || '+0%' }
      : engine === 'cosyvoice'
        ? { engine, voice_id: params.voice_id || '', speed: params.speed ?? 1, volume: params.volume ?? 80, pitch: params.pitch ?? 1, language: params.language || 'Chinese', instruction: params.instruction || '' }
        : engine === 'mimo_tts'
          ? { engine, mimo_mode: params.mimo_mode || 'preset', mimo_preset_voice: params.mimo_preset_voice || '冰糖', mimo_instruction: params.mimo_instruction || '' }
          : { engine, voxcpm_mode: params.voxcpm_mode || 'clone', voice_id: params.voice_id || '', voxcpm_style_control: params.voxcpm_style_control || '', voxcpm_prompt_text: params.voxcpm_prompt_text || '', voxcpm_cfg_value: params.voxcpm_cfg_value ?? 2, voxcpm_inference_timesteps: params.voxcpm_inference_timesteps ?? 10 };
    onChange({ ...draft, default_engine: engine, default_engine_params: nextParams });
  };

  const setParams = (next: Partial<SegmentEngineParams>) => onChange({
    ...draft,
    default_engine_params: { ...draft.default_engine_params, ...next, engine: draft.default_engine } as SegmentEngineParams,
  });

  /** 切换音色来源分类时，重置引擎参数 */
  const switchCategory = (cat: VoiceSourceCategory) => {
    setVoiceCategory(cat);
    setDesignPhase('idle');
    setDesignAudioBase64('');
    setDesignError('');
    setCloneStep('select');
    setCloneError('');
    if (cat === 'preset') {
      setEngine('edge_tts');
    } else if (cat === 'clone') {
      setEngine('mimo_tts');
      setParams({ mimo_mode: 'voiceclone' });
    } else {
      // design
      setDesignSubEngine('mimo');
      setEngine('mimo_tts');
      setParams({ mimo_mode: 'voicedesign', mimo_voice_description: '' });
    }
  };

  return (
    <section className={styles.editorPanel} aria-label="声音角色编辑器">
      <div className={styles.editorBar}>
        <div>
          <span className={styles.kicker}>Voice Role</span>
          <h3>{draft.name || '声音角色配置'}</h3>
          <p>{draft.description === 'Narrator' ? '默认旁白声音' : 'Cast 对话角色'} · 选择音色来源和参数。</p>
        </div>
        <div className={styles.editorActions}>
          <button type="button" className={styles.ghostButton} onClick={onCancel}>取消</button>
          <button type="button" className={styles.primaryButton} disabled={saving} onClick={() => onSave(normalizeDraftForSave(draft))}>{saving ? '保存中...' : '保存角色'}</button>
        </div>
      </div>

      <div className={styles.editorGrid}>
        <div className={styles.editorMain}>
          {/* Role Identity */}
          <section className={styles.configCard}>
            <h4>Role Identity</h4>
            <div className={styles.identityRow}>
              <ImageUploadZone
                value={draft.avatar ?? null}
                onChange={(dataUrl) => onChange({ ...draft, avatar: dataUrl })}
                size="md"
              />
              <div className={styles.identityFields}>
                <label>角色名
                  <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
                </label>
                <label>角色类型
                  <select value={draft.description ?? 'Cast'} onChange={(event) => onChange({ ...draft, description: event.target.value })}>
                    <option value="Narrator">Narrator</option>
                    <option value="Cast">Cast</option>
                  </select>
                </label>
              </div>
            </div>
          </section>

          {/* 音色来源分类 */}
          <section className={styles.configCard}>
            <h4>音色来源</h4>
            <div className={styles.engineRow}>
              <div className={styles.enginePills}>
                {VOICE_SOURCE_TABS.map(tab => (
                  <button
                    type="button"
                    key={tab.value}
                    role="radio"
                    aria-checked={voiceCategory === tab.value}
                    className={`${styles.enginePill} ${voiceCategory === tab.value ? styles.enginePillActive : ''}`}
                    onClick={() => switchCategory(tab.value)}
                    title={tab.desc}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.paramsGrid}>
              {/* ========== 模型预制音色 ========== */}
              {voiceCategory === 'preset' && (
                <>
                  <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                    <div className={styles.enginePills} style={{ marginBottom: '0.5rem' }}>
                      <button type="button" className={`${styles.enginePill} ${draft.default_engine === 'edge_tts' ? styles.enginePillActive : ''}`} onClick={() => setEngine('edge_tts')}>Edge-TTS</button>
                      <button type="button" className={`${styles.enginePill} ${draft.default_engine === 'mimo_tts' ? styles.enginePillActive : ''}`} onClick={() => { setEngine('mimo_tts'); setParams({ mimo_mode: 'preset' }); }}>MiMo</button>
                    </div>
                  </div>

                  {/* Edge-TTS 预制 */}
                  {draft.default_engine === 'edge_tts' && (
                    <>
                      <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>音色
                        <select className={styles.paramSelect} value={params.edge_voice ?? ''} onChange={(event) => setParams({ edge_voice: event.target.value })}>
                          {params.edge_voice && <option value={params.edge_voice}>{params.edge_voice}</option>}
                          {edgeVoices.map(voice => (
                            <option key={voice.short_name} value={voice.short_name}>
                              {voice.display_name} ({voice.gender === 'Female' ? '女' : '男'})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.paramField}>语速
                        <input className={styles.paramInput} value={params.edge_rate ?? '+0%'} onChange={(event) => setParams({ edge_rate: event.target.value })} />
                      </label>
                      <label className={styles.paramField}>音量
                        <input className={styles.paramInput} value={params.edge_volume ?? '+0%'} onChange={(event) => setParams({ edge_volume: event.target.value })} />
                      </label>
                    </>
                  )}

                  {/* MiMo 预制 */}
                  {draft.default_engine === 'mimo_tts' && (
                    <>
                      <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>预置音色
                        <select className={styles.paramSelect} value={params.mimo_preset_voice ?? ''} onChange={(event) => setParams({ mimo_preset_voice: event.target.value })}>
                          {MIMO_PRESET_VOICES.map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                      </label>
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <StyleInstructionPicker value={params.mimo_instruction ?? ''} onChange={(value) => setParams({ mimo_instruction: value })} label="风格指令" placeholder="选择预设或直接输入..." dense />
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ========== 克隆音色 ========== */}
              {voiceCategory === 'clone' && (
                <>
                  <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                    <div className={styles.enginePills} style={{ marginBottom: '0.5rem' }}>
                      <button type="button" className={`${styles.enginePill} ${cloneSubEngine === 'cosyvoice' ? styles.enginePillActive : ''}`} onClick={() => { setCloneSubEngine('cosyvoice'); setEngine('cosyvoice'); }}>CosyVoice</button>
                      <button type="button" className={`${styles.enginePill} ${cloneSubEngine === 'mimo' ? styles.enginePillActive : ''}`} onClick={() => { setCloneSubEngine('mimo'); setEngine('mimo_tts'); setParams({ mimo_mode: 'voiceclone' }); }}>MiMo</button>
                      <button type="button" className={`${styles.enginePill} ${cloneSubEngine === 'voxcpm' ? styles.enginePillActive : ''}`} onClick={() => { setCloneSubEngine('voxcpm'); setEngine('voxcpm'); setParams({ voxcpm_mode: 'clone' }); }}>VoxCPM</button>
                    </div>
                  </div>

                  {/* CosyVoice 克隆 */}
                  {cloneSubEngine === 'cosyvoice' && (
                    <>
                      <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>已有 CosyVoice 克隆声音
                        <select className={styles.paramSelect} value={params.voice_id ?? ''} onChange={(event) => setParams({ voice_id: event.target.value })}>
                          <option value="">-- 选择已克隆的声音 --</option>
                          {cosyVoiceCloneVoices.map(v => {
                            const key = v.qwen_voice_id || v.id;
                            return <option key={v.id} value={key}>{v.description || v.name}</option>;
                          })}
                        </select>
                      </label>
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <span className={styles.paramLabel}>或输入公网音频 URL 克隆</span>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                          <input className={styles.paramInput} value={cloneUrl} onChange={(e) => setCloneUrl(e.target.value)} placeholder="https://example.com/audio.wav" style={{ flex: 1 }} />
                          <button type="button" className={styles.ghostButton} disabled={!cloneUrl.trim()} onClick={async () => {
                            setCloneStep('cloning');
                            setCloneError('');
                            try {
                              const uploaded = await voiceApi.uploadFromUrl(cloneUrl.trim(), draft.name);
                              await voiceApi.createClone(uploaded.id, draft.name);
                              setParams({ voice_id: uploaded.qwen_voice_id || uploaded.id });
                              setCloneStep('select');
                              setCloneUrl('');
                            } catch (err) {
                              setCloneError(err instanceof Error ? err.message : '克隆失败');
                              setCloneStep('select');
                            }
                          }}>提交克隆</button>
                        </div>
                        {cloneStep === 'cloning' && <span className={styles.configHint}>克隆中...</span>}
                        {cloneError && <span style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.8rem' }}>{cloneError}</span>}
                      </div>
                      <label className={styles.paramField}>语速
                        <input className={styles.range} aria-label="语速" type="range" min={0.5} max={2} step={0.01} value={params.speed ?? 1} onChange={(event) => setParams({ speed: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{(params.speed ?? 1).toFixed(2)}×</span>
                      </label>
                      <label className={styles.paramField}>音量
                        <input className={styles.range} aria-label="音量" type="range" min={0} max={100} value={params.volume ?? 80} onChange={(event) => setParams({ volume: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{params.volume ?? 80}</span>
                      </label>
                      <label className={styles.paramField}>音高
                        <input className={styles.range} aria-label="音高" type="range" min={0.5} max={2} step={0.01} value={params.pitch ?? 1} onChange={(event) => setParams({ pitch: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{(params.pitch ?? 1).toFixed(2)}</span>
                      </label>
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <StyleInstructionPicker value={params.instruction ?? ''} onChange={(value) => setParams({ instruction: value })} label="风格指令" placeholder="选择预设或直接输入..." dense />
                      </div>
                    </>
                  )}

                  {/* MiMo 克隆 */}
                  {cloneSubEngine === 'mimo' && (
                    <>
                      <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>已有 MiMo 克隆声音
                        <select className={styles.paramSelect} value={params.mimo_clone_voice_id ?? ''} onChange={(event) => setParams({ mimo_clone_voice_id: event.target.value })}>
                          <option value="">-- 选择已克隆的声音 --</option>
                          {mimoAvailableCloneVoices.map(v => (
                            <option key={v.id} value={v.id}>{v.name} {v.clone_engine === 'voxcpm' ? '(VoxCPM)' : ''}</option>
                          ))}
                        </select>
                      </label>
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <StyleInstructionPicker value={params.mimo_instruction ?? ''} onChange={(value) => setParams({ mimo_instruction: value })} label="风格指令" placeholder="选择预设或直接输入..." dense />
                      </div>
                    </>
                  )}

                  {/* VoxCPM 克隆 */}
                  {cloneSubEngine === 'voxcpm' && (
                    <>
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <div className={styles.enginePills} style={{ marginBottom: '0.5rem' }}>
                          <button type="button" className={`${styles.enginePill} ${voxcpmCloneMode === 'clone' ? styles.enginePillActive : ''}`} onClick={() => { setVoxcpmCloneMode('clone'); setParams({ voxcpm_mode: 'clone' }); }}>声音克隆</button>
                          <button type="button" className={`${styles.enginePill} ${voxcpmCloneMode === 'ultimate' ? styles.enginePillActive : ''}`} onClick={() => { setVoxcpmCloneMode('ultimate'); setParams({ voxcpm_mode: 'ultimate' }); }}>极致克隆</button>
                        </div>
                      </div>
                      <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>参考音频
                        <select className={styles.paramSelect} value={params.voice_id ?? ''} onChange={(event) => setParams({ voice_id: event.target.value })}>
                          <option value="">-- 选择已克隆的声音 --</option>
                          {voxcpmCloneVoices.map(v => (
                            <option key={v.id} value={v.id}>{v.name}</option>
                          ))}
                        </select>
                      </label>
                      {voxcpmCloneMode === 'clone' && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <StyleInstructionPicker value={params.voxcpm_style_control ?? ''} onChange={(value) => setParams({ voxcpm_style_control: value })} label="风格指令" placeholder="选择预设或直接输入..." dense />
                        </div>
                      )}
                      {voxcpmCloneMode === 'ultimate' && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <span className={styles.paramLabel}>参考音频文本</span>
                          {(() => {
                            const selectedVoice = voxcpmCloneVoices.find(v => v.id === params.voice_id);
                            if (selectedVoice?.prompt_text) {
                              return <span className={styles.configHint} style={{ display: 'block', marginTop: '0.25rem' }}>{selectedVoice.prompt_text}</span>;
                            }
                            return <span style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.8rem', display: 'block', marginTop: '0.25rem' }}>⚠ 该声音未填写参考音频文本，极致克隆无法使用</span>;
                          })()}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ========== 设计新音色 ========== */}
              {voiceCategory === 'design' && (
                <>
                  <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                    <div className={styles.enginePills} style={{ marginBottom: '0.5rem' }}>
                      <button type="button" className={`${styles.enginePill} ${designSubEngine === 'mimo' ? styles.enginePillActive : ''}`} onClick={() => {
                        setDesignSubEngine('mimo');
                        setEngine('mimo_tts');
                        setParams({ mimo_mode: 'voicedesign', mimo_voice_description: params.mimo_voice_description || '' });
                      }}>MiMo</button>
                      <button type="button" className={`${styles.enginePill} ${designSubEngine === 'voxcpm' ? styles.enginePillActive : ''}`} onClick={() => {
                        setDesignSubEngine('voxcpm');
                        setEngine('voxcpm');
                        setParams({ voxcpm_mode: 'design', voxcpm_voice_description: params.voxcpm_voice_description || '' });
                      }}>VoxCPM</button>
                    </div>
                  </div>
                  <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>音色描述
                    <textarea
                      className={styles.paramTextarea}
                      value={voiceDescription}
                      onChange={(event) => setVoiceDescription(event.target.value)}
                      placeholder="描述你想要的音色，如：年轻女性，温柔甜美，语速适中..."
                      rows={3}
                    />
                  </label>
                  <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                    <span className={styles.paramLabel}>试听文本</span>
                    <p style={{ margin: '0.25rem 0 0', padding: '0.5rem 0.75rem', background: 'var(--color-bg-secondary, #f7f7f8)', borderRadius: '6px', fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--color-text-secondary, #6b7280)' }}>
                      这是一段角色试听文本，用来确认音色、节奏和情绪是否适合当前项目。
                    </p>
                    <span className={styles.configHint}>试听文本由系统提供，确保音色描述准确即可。</span>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        <aside className={styles.previewCard}>
          <span className={styles.kicker}>Real-time Preview</span>
          <h4>Studio Playback</h4>
          <p>"这是一段角色试听文本，用来确认音色、节奏和情绪是否适合当前项目。"</p>
          <div className={styles.waveform} aria-hidden="true"><i /><i /><i /><i /><i /></div>

          {isDesignMode ? (
            <div className={styles.designFlow}>
              {designError && <p className={styles.designError}>{designError}</p>}
              {designPhase === 'idle' && (
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={handleDesignPreview}
                  disabled={!voiceDescription.trim()}
                >
                  试听音色
                </button>
              )}
              {designPhase === 'previewing' && (
                <button type="button" className={styles.ghostButton} disabled>生成中...</button>
              )}
              {designPhase === 'previewed' && (
                <>
                  <p className={styles.designHint}>已试听 · 满意后点击「确认保存」</p>
                  <div className={styles.designActions}>
                    <button type="button" className={styles.ghostButton} onClick={handleDesignPreview}>重新生成</button>
                    <button type="button" className={styles.primaryButton} onClick={handleDesignConfirmSave}>确认保存音色</button>
                  </div>
                </>
              )}
              {designPhase === 'saving' && (
                <button type="button" className={styles.ghostButton} disabled>保存中...</button>
              )}
              {designAudioSrc && designPhase === 'previewed' && (
                <audio controls className={styles.designAudioPlayer} src={designAudioSrc} />
              )}
            </div>
          ) : (
            <button type="button" className={styles.ghostButton} onClick={() => onPreview(normalizeDraftForSave(draft), '这是一段角色试听文本，用来确认音色、节奏和情绪是否适合当前项目。')}>生成试听</button>
          )}
        </aside>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  CharacterCard                                                      */
/* ------------------------------------------------------------------ */

function CharacterCard({
  role,
  isDefault,
  kind,
  onEdit,
  onPreview,
  onDelete,
}: {
  role: Role;
  isDefault: boolean;
  kind: 'narrator' | 'cast';
  onEdit: () => void;
  onPreview: () => void;
  onDelete?: () => void;
}) {
  const configured = isConfigured(role);
  const cardClass = [
    styles.charCard,
    isDefault ? styles.charCardDefault : '',
    kind === 'narrator' ? styles.charCardNarrator : '',
  ].filter(Boolean).join(' ');

  return (
    <article
      className={cardClass}
      tabIndex={0}
      role="button"
      aria-label={`编辑 ${role.name}`}
      onClick={onEdit}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); } }}
    >
      <VoiceAvatar
        avatar={role.avatar}
        name={role.name}
        engine={role.default_engine}
        size={36}
      />

      <div className={styles.cardBody}>
        <strong className={styles.charName}>
          {role.name}
          {isDefault && <span className={styles.defaultBadge}>默认</span>}
        </strong>
        <div className={styles.chipRow}>
          <span className={`${styles.chip} ${kind === 'narrator' ? styles.chipNarrator : styles.chipCast}`}>
            {kind === 'narrator' ? '旁白' : '角色'}
          </span>
          <span className={`${styles.chip} ${styles.chipEngine}`}>{engineLabel(role)}</span>
          <span className={`${styles.chip} ${styles.chipEngine}`}>{role.default_voice || '未设置'}</span>
          <span className={styles.chip} title={configured ? '已配置音色' : '待配置'}>
            <span className={`${styles.statusDot} ${configured ? styles.statusReady : styles.statusDraft}`} />
          </span>
        </div>
      </div>

      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
        >试听</button>
        {onDelete && (
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`删除 ${role.name}`}
            title="删除角色"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >✕</button>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/*  ProjectVoices (main export)                                        */
/* ------------------------------------------------------------------ */

type EngineFilter = 'all' | EngineKey;

export function ProjectVoices({
  roles,
  defaultNarratorRoleId,
  onSaveRole,
  onDeleteRole,
  onPreviewRole,
  onManageRoles,
}: ProjectVoicesProps) {
  const [editingRole, setEditingRole] = useState<RoleSnapshot | null>(null);
  const [engineFilter, setEngineFilter] = useState<EngineFilter>('all');

  const filterByEngine = (list: Role[]) =>
    engineFilter === 'all' ? list : list.filter(r => r.default_engine === engineFilter);

  const narratorRoles = filterByEngine(roles.filter(r => isNarratorRole(r, defaultNarratorRoleId)));
  const castRoles = filterByEngine(roles.filter(r => !isNarratorRole(r, defaultNarratorRoleId)));

  const [saving, setSaving] = useState(false);

  const saveEditingRole = async (draft: RoleSnapshot) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSaveRole?.(draft);
      setEditingRole(null);
    } catch {
      // onSaveRole handles its own error toasts; keep editor open
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.root}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerText}>
          <span className={styles.kicker}>Characters</span>
          <h2>角色管理</h2>
          <p className={styles.headerDesc}>管理项目中的旁白与对话角色，配置音色、引擎和参数。</p>
        </div>
        <div className={styles.filterBar}>
          <select
            className={styles.filterSelect}
            value={engineFilter}
            onChange={(e) => setEngineFilter(e.target.value as EngineFilter)}
          >
            <option value="all">全部引擎</option>
            <option value="edge_tts">Edge-TTS</option>
            <option value="cosyvoice">CosyVoice</option>
            <option value="mimo_tts">MiMo</option>
            <option value="voxcpm">VoxCPM</option>
          </select>
          <button type="button" className={styles.ghostButton} onClick={onManageRoles}>角色库</button>
        </div>
      </header>

      {/* Editor (expanded when editing) */}
      {editingRole && (
        <VoiceRoleEditor
          draft={editingRole}
          onChange={setEditingRole}
          onCancel={() => setEditingRole(null)}
          onSave={saveEditingRole}
          onPreview={onPreviewRole}
          saving={saving}
        />
      )}

      {/* Narrator Group */}
      <section className={styles.roleGroup}>
        <div className={styles.roleGroupHeader}>
          <span className={styles.kicker}>Narrator</span>
          <h3>旁白</h3>
        </div>
        <div className={styles.cardGrid} data-testid="narrator-list">
          {narratorRoles.length === 0 && (
            <div className={styles.emptyState}>
              <strong>还没有旁白角色</strong>
              <p>创建一个旁白角色，用于所有叙述段落。</p>
            </div>
          )}
          {narratorRoles.map(role => (
            <CharacterCard
              key={role.id}
              role={role}
              isDefault={role.id === defaultNarratorRoleId}
              kind="narrator"
              onEdit={() => setEditingRole(roleToSnapshot(role))}
              onPreview={() => onPreviewRole(roleToSnapshot(role), NARRATOR_SAMPLE)}
              onDelete={narratorRoles.length > 1 ? () => onDeleteRole?.(role.id) : undefined}
            />
          ))}
          <button
            type="button"
            className={styles.placeholderCard}
            onClick={() => setEditingRole(createRoleDraft('Narrator'))}
          >
            <span className={styles.placeholderIcon}>+</span>
            <span className={styles.placeholderLabel}>新增旁白</span>
          </button>
        </div>
      </section>

      {/* Cast Group */}
      <section className={styles.roleGroup}>
        <div className={styles.roleGroupHeader}>
          <span className={styles.kicker}>Cast</span>
          <h3>角色</h3>
        </div>
        <div className={styles.cardGrid} data-testid="cast-list">
          {castRoles.length === 0 && (
            <div className={styles.emptyState}>
              <strong>还没有对话角色</strong>
              <p>创建对话/剧本角色，用于台词段落。</p>
            </div>
          )}
          {castRoles.map(role => (
            <CharacterCard
              key={role.id}
              role={role}
              isDefault={false}
              kind="cast"
              onEdit={() => setEditingRole(roleToSnapshot(role))}
              onPreview={() => onPreviewRole(roleToSnapshot(role), CAST_SAMPLE)}
              onDelete={() => onDeleteRole?.(role.id)}
            />
          ))}
          <button
            type="button"
            className={styles.placeholderCard}
            onClick={() => setEditingRole(createRoleDraft('Cast'))}
          >
            <span className={styles.placeholderIcon}>+</span>
            <span className={styles.placeholderLabel}>新增角色</span>
          </button>
        </div>
      </section>
    </section>
  );
}
