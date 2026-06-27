import { useEffect, useState, useCallback, useRef } from 'react';
import type { Role, RoleSnapshot, SegmentEngineParams, VoiceProfile } from '../../types';
import { ttsApi, voiceApi } from '../../services/api';
import { fetchVoiceRolePreview } from '../../services/voiceRolePreview';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
import { DEFAULT_EDGE_CAST_VOICE, DEFAULT_EDGE_NARRATOR_VOICE } from '../../services/voiceRoleDefaults';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import { ImageUploadZone } from '../ui/ImageUploadZone';
import { StyleInstructionPicker } from '../TTSSynthesis/StyleInstructionPicker';
import styles from './ProjectVoices.module.css';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ProjectVoicesProps {
  roles: Role[];
  projectId?: string;
  onCreateRole?: () => void;
  onSaveRole?: (role: RoleSnapshot) => void | Promise<void>;
  onDeleteRole?: (roleId: string) => void;
  onPreviewRole: (role: RoleSnapshot, sampleText: string) => void;
  onManageRoles: () => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const ROLE_SAMPLE = '你好，我是这个角色的声音。请确认语气、节奏和音色是否符合当前场景。';
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
  return !!(role.default_voice
    || role.default_engine_params.edge_voice
    || role.default_engine_params.voice_id
    || role.default_engine_params.mimo_preset_voice
    || role.default_engine_params.mimo_clone_voice_id);
}

function createRoleDraft(): RoleSnapshot {
  return {
    id: `role-cast-${Date.now()}`,
    name: '新角色',
    avatar: '',
    description: 'Cast',
    default_engine: 'edge_tts',
    default_voice: DEFAULT_EDGE_CAST_VOICE,
    default_engine_params: { engine: 'edge_tts', edge_voice: DEFAULT_EDGE_CAST_VOICE, edge_rate: '+0%', edge_volume: '+0%' },
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
  projectId,
}: {
  draft: RoleSnapshot;
  onChange: (draft: RoleSnapshot) => void;
  onCancel: () => void;
  onSave: (draft: RoleSnapshot) => void;
  onPreview: (draft: RoleSnapshot, sampleText: string) => void;
  saving?: boolean;
  projectId?: string;
}) {
  const params = draft.default_engine_params;
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [edgeVoices, setEdgeVoices] = useState<{ short_name: string; display_name: string; gender: string }[]>(COMMON_EDGE_VOICES);
  const { refreshCounter, triggerRefresh } = useVoiceRefresh();

  // 音色来源分类
  const [voiceCategory, setVoiceCategory] = useState<VoiceSourceCategory>(() => detectCategory(draft));

  // 克隆流程状态
  const initCloneSubEngine = (): 'cosyvoice' | 'mimo' | 'voxcpm' => {
    if (draft.default_engine === 'cosyvoice') return 'cosyvoice';
    if (draft.default_engine === 'voxcpm') return 'voxcpm';
    return 'mimo';
  };
  const [cloneSubEngine, setCloneSubEngine] = useState<'cosyvoice' | 'mimo' | 'voxcpm'>(initCloneSubEngine);
  const [voxcpmCloneMode, setVoxcpmCloneMode] = useState<'clone' | 'ultimate'>(() =>
    draft.default_engine === 'voxcpm' && draft.default_engine_params.voxcpm_mode === 'ultimate' ? 'ultimate' : 'clone',
  );
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneStep, setCloneStep] = useState<'select' | 'input' | 'cloning'>('select');
  const [cloneError, setCloneError] = useState('');

  // 音色设计流程状态
  const [designSubEngine, setDesignSubEngine] = useState<'mimo' | 'voxcpm'>(
    draft.default_engine === 'voxcpm' ? 'voxcpm' : 'mimo',
  );
  const [designPhase, setDesignPhase] = useState<'idle' | 'previewing' | 'previewed' | 'saving' | 'confirmed'>('idle');
  const [designAudioBase64, setDesignAudioBase64] = useState('');
  const [designAudioSrc, setDesignAudioSrc] = useState('');
  const [designError, setDesignError] = useState('');
  const [designProfileId, setDesignProfileId] = useState('');

  // 已保存的设计音色预览（从 VoiceProfile 加载）
  const [clonePreviewAudioSrc, setClonePreviewAudioSrc] = useState('');
  const [cloneVoiceDescription, setCloneVoiceDescription] = useState('');

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

  /** 确认保存音色：将试听音频持久化为 VoiceProfile，但保持设计界面不变。返回 profile ID 或 null。 */
  const handleDesignConfirmSave = useCallback(async (): Promise<string | null> => {
    if (!designAudioBase64 && !designAudioSrc) {
      setDesignError('没有可保存的音频，请先试听');
      return null;
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
        return null;
      }
      const engine = designSubEngine === 'mimo' ? 'mimo' : 'voxcpm';
      const instruction = designSubEngine === 'mimo'
        ? (params.mimo_instruction ?? '')
        : (params.voxcpm_style_control ?? '');
      const profile = await voiceApi.createFromDesign({
        audio_base64: audioBase64,
        engine,
        name: draft.name,
        description: voiceDescription,
        project_id: projectId,
        voice_description: voiceDescription,
        instruction,
      });
      setDesignProfileId(profile.id);
      setDesignPhase('confirmed');
      triggerRefresh();
      return profile.id;
    } catch (err) {
      setDesignError(err instanceof Error ? err.message : '保存失败');
      setDesignPhase('previewed');
      return null;
    }
  }, [draft, designAudioBase64, designAudioSrc, designSubEngine, voiceDescription, projectId]);

  useEffect(() => {
    ttsApi.getEdgeVoices('Chinese').then(setEdgeVoices).catch(() => {});
  }, []);

  // 当已保存的角色有 clone voice id 时，按 ID 查询对应的 VoiceProfile
  // 从 voices_engine 还原 UI 状态（音色来源分类、引擎、参数）
  const voiceEngineAppliedRef = useRef(false);
  useEffect(() => {
    const voiceId = params.mimo_clone_voice_id || params.voice_id || '';
    if (!voiceId) { setClonePreviewAudioSrc(''); setCloneVoiceDescription(''); return; }
    let cancelled = false;
    ttsApi.getVoices({ voice_id: voiceId }).then(list => {
      if (cancelled) return;
      const profile = list[0];
      if (!profile) { setClonePreviewAudioSrc(''); setCloneVoiceDescription(''); return; }
      setClonePreviewAudioSrc(profile.audio_url ?? '');
      setCloneVoiceDescription(profile.description ?? '');

      const ve = profile.voices_engine;
      if (!ve || voiceEngineAppliedRef.current) return;
      voiceEngineAppliedRef.current = true;

      // 根据 voices_engine 还原音色来源分类和引擎选择
      if (ve.type === 'design' && ve.engine) {
        setVoiceCategory('design');
        const desc = (ve.parameters.voice_description as string) ?? profile.description ?? '';
        const instr = (ve.parameters.instruction as string) ?? '';
        if (ve.engine.sub_type?.startsWith('mimo')) {
          setDesignSubEngine('mimo');
          setParams({ mimo_voice_description: desc, mimo_instruction: instr });
        } else if (ve.engine.sub_type?.startsWith('voxcpm')) {
          setDesignSubEngine('voxcpm');
          setParams({ voxcpm_voice_description: desc, voxcpm_style_control: instr });
        }
        setDesignPhase('confirmed');
        setDesignProfileId(profile.id);
      } else if (ve.type === 'clone' && ve.engine) {
        setVoiceCategory('clone');
        if (ve.engine.type === 'CosyVoice') setCloneSubEngine('cosyvoice');
        else if (ve.engine.type === 'VoxCpm') setCloneSubEngine('voxcpm');
        else setCloneSubEngine('mimo');
        if (ve.engine.sub_type === 'voxcpm-ultimate') setVoxcpmCloneMode('ultimate');
        setCloneStep('select');
      }
    }).catch(() => {
      if (!cancelled) { setClonePreviewAudioSrc(''); setCloneVoiceDescription(''); }
    });
    return () => { cancelled = true; };
  }, [params.mimo_clone_voice_id, params.voice_id]);

  // 按 clone_engine 过滤声音列表
  const cosyVoiceCloneVoices = voices.filter(v => v.clone_engine === 'qwen');
  const mimoCloneVoices = voices.filter(v => v.clone_engine === 'mimo');
  const voxcpmCloneVoices = voices.filter(v => v.clone_engine === 'voxcpm');
  // MiMo voiceclone 也可选 VoxCPM 设计的声音
  const mimoAvailableCloneVoices = voices.filter(v => v.clone_engine === 'mimo' || v.clone_engine === 'voxcpm');

  const setEngine = (engine: SegmentEngineParams['engine']) => {
    const base = draft.default_engine_params;
    const nextParams: SegmentEngineParams = engine === 'edge_tts'
      ? { ...base, engine, edge_voice: base.edge_voice || DEFAULT_EDGE_CAST_VOICE, edge_rate: base.edge_rate || '+0%', edge_volume: base.edge_volume || '+0%' }
      : engine === 'cosyvoice'
        ? { ...base, engine, voice_id: base.voice_id || '', speed: base.speed ?? 1, volume: base.volume ?? 80, pitch: base.pitch ?? 1, language: base.language || 'Chinese', instruction: base.instruction || '' }
        : engine === 'mimo_tts'
          ? { ...base, engine, mimo_mode: base.mimo_mode || 'preset', mimo_preset_voice: base.mimo_preset_voice || '冰糖' }
          : { ...base, engine, voxcpm_mode: base.voxcpm_mode || 'clone', voice_id: base.voice_id || '' };
    onChange({ ...draft, default_engine: engine, default_engine_params: nextParams });
  };

  const setParams = (next: Partial<SegmentEngineParams>) => onChange({
    ...draft,
    default_engine_params: { ...draft.default_engine_params, ...next, engine: draft.default_engine } as SegmentEngineParams,
  });

  /** 切换音色来源分类时，保留已有参数，只切换引擎模式 */
  const switchCategory = (cat: VoiceSourceCategory) => {
    setVoiceCategory(cat);
    setDesignError('');
    setCloneError('');
    if (cat === 'preset') {
      setEngine('edge_tts');
    } else if (cat === 'clone') {
      setCloneStep('select');
      // 保留已有的 mimo_instruction 等参数
      onChange({
        ...draft,
        default_engine: 'mimo_tts',
        default_engine_params: {
          ...draft.default_engine_params,
          engine: 'mimo_tts',
          mimo_mode: 'voiceclone',
        } as SegmentEngineParams,
      });
    } else {
      // design — 保留已有的 voice_description，更新引擎为设计模式
      const subEngine = draft.default_engine === 'voxcpm' ? 'voxcpm' : 'mimo';
      setDesignSubEngine(subEngine);
      const designEngine = subEngine === 'mimo' ? 'mimo_tts' : 'voxcpm';
      onChange({
        ...draft,
        default_engine: designEngine,
        default_engine_params: {
          ...draft.default_engine_params,
          engine: designEngine,
          ...(subEngine === 'mimo'
            ? { mimo_mode: 'voicedesign' as const, mimo_voice_description: params.mimo_voice_description || '' }
            : { voxcpm_mode: 'design' as const, voxcpm_voice_description: params.voxcpm_voice_description || '' }),
        } as SegmentEngineParams,
      });
      if (!clonePreviewAudioSrc) {
        setDesignPhase('idle');
        setDesignAudioBase64('');
        setDesignProfileId('');
      }
    }
  };

  return (
    <section className={styles.editorPanel} aria-label="声音角色编辑器">
      <div className={styles.editorBar}>
        <div>
          <span className={styles.kicker}>Voice Role</span>
          <h3>{draft.name || '声音角色配置'}</h3>
          <p>选择音色来源和参数。</p>
        </div>
        <div className={styles.editorActions}>
          <button type="button" className={styles.ghostButton} onClick={onCancel}>取消</button>
          <button type="button" className={styles.primaryButton} disabled={saving || designPhase === 'saving'} onClick={async () => {
            if (isDesignMode) {
              // 如果还没确认过音色，先自动确认
              let profileId = designProfileId;
              if (!profileId) {
                if (!designAudioBase64 && !designAudioSrc) {
                  setDesignError('请先试听音色，再保存角色');
                  return;
                }
                profileId = await handleDesignConfirmSave();
                if (!profileId) return;
              }
              // 将 VoiceProfile 绑定到角色参数，切换为克隆模式后保存
              // 保留设计阶段的描述等参数，方便再次打开时回显
              const updatedParams: SegmentEngineParams = designSubEngine === 'mimo'
                ? { engine: 'mimo_tts', mimo_mode: 'voiceclone', mimo_clone_voice_id: profileId, mimo_voice_description: params.mimo_voice_description || voiceDescription, mimo_instruction: params.mimo_instruction || '' }
                : { engine: 'voxcpm', voxcpm_mode: 'clone', voice_id: profileId, voxcpm_voice_description: params.voxcpm_voice_description || voiceDescription, voxcpm_style_control: params.voxcpm_style_control || '', voxcpm_cfg_value: params.voxcpm_cfg_value ?? 2, voxcpm_inference_timesteps: params.voxcpm_inference_timesteps ?? 10 };
              const updatedDraft = { ...draft, default_engine: updatedParams.engine, default_engine_params: updatedParams };
              onSave(normalizeDraftForSave(updatedDraft));
              return;
            }
            onSave(normalizeDraftForSave(draft));
          }}>{saving ? '保存中...' : '保存角色'}</button>
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
                      <button type="button" className={`${styles.enginePill} ${draft.default_engine === 'mimo_tts' ? styles.enginePillActive : ''}`} onClick={() => {
                        onChange({
                          ...draft,
                          default_engine: 'mimo_tts',
                          default_engine_params: { ...draft.default_engine_params, engine: 'mimo_tts', mimo_mode: 'preset', mimo_preset_voice: params.mimo_preset_voice || '冰糖' } as SegmentEngineParams,
                        });
                      }}>MiMo</button>
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
                        <select className={styles.paramSelect} value={params.edge_rate ?? '+0%'} onChange={(event) => setParams({ edge_rate: event.target.value })}>
                          {['-50%', '-30%', '-20%', '-10%', '+0%', '+10%', '+20%', '+30%', '+50%', '+80%', '+100%'].map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </label>
                      <label className={styles.paramField}>音量
                        <select className={styles.paramSelect} value={params.edge_volume ?? '+0%'} onChange={(event) => setParams({ edge_volume: event.target.value })}>
                          {['-50%', '-30%', '-20%', '-10%', '+0%', '+10%', '+20%', '+30%', '+50%', '+80%', '+100%'].map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
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
                      <button type="button" className={`${styles.enginePill} ${cloneSubEngine === 'mimo' ? styles.enginePillActive : ''}`} onClick={() => {
                        setCloneSubEngine('mimo');
                        onChange({
                          ...draft,
                          default_engine: 'mimo_tts',
                          default_engine_params: { ...draft.default_engine_params, engine: 'mimo_tts', mimo_mode: 'voiceclone' } as SegmentEngineParams,
                        });
                      }}>MiMo</button>
                      <button type="button" className={`${styles.enginePill} ${cloneSubEngine === 'voxcpm' ? styles.enginePillActive : ''}`} onClick={() => {
                        setCloneSubEngine('voxcpm');
                        onChange({
                          ...draft,
                          default_engine: 'voxcpm',
                          default_engine_params: { ...draft.default_engine_params, engine: 'voxcpm', voxcpm_mode: 'clone' } as SegmentEngineParams,
                        });
                      }}>VoxCPM</button>
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
                      <label className={styles.paramField}>语言
                        <select className={styles.paramSelect} value={params.language || 'Chinese'} onChange={(event) => setParams({ language: event.target.value as SegmentEngineParams['language'] })}>
                          <option value="Chinese">中文</option>
                          <option value="English">English</option>
                          <option value="Japanese">日本語</option>
                          <option value="Korean">한국어</option>
                        </select>
                      </label>
                      <label className={styles.paramField}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <input type="checkbox" checked={params.enable_ssml ?? false} onChange={(event) => setParams({ enable_ssml: event.target.checked })} />
                          SSML
                        </span>
                      </label>
                      <label className={styles.paramField}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <input type="checkbox" checked={params.enable_markdown_filter ?? false} onChange={(event) => setParams({ enable_markdown_filter: event.target.checked })} />
                          Markdown 过滤
                        </span>
                      </label>
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
                      {(params.mimo_voice_description || cloneVoiceDescription) && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <span className={styles.paramLabel}>音色描述（设计来源）</span>
                          <p className={styles.configHint} style={{ marginTop: '0.25rem' }}>{params.mimo_voice_description || cloneVoiceDescription}</p>
                        </div>
                      )}
                      {clonePreviewAudioSrc && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <span className={styles.paramLabel}>试听音频</span>
                          <audio controls className={styles.designAudioPlayer} src={clonePreviewAudioSrc} />
                        </div>
                      )}
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
                      {(params.voxcpm_voice_description || cloneVoiceDescription) && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <span className={styles.paramLabel}>音色描述（设计来源）</span>
                          <p className={styles.configHint} style={{ marginTop: '0.25rem' }}>{params.voxcpm_voice_description || cloneVoiceDescription}</p>
                        </div>
                      )}
                      {clonePreviewAudioSrc && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <span className={styles.paramLabel}>试听音频</span>
                          <audio controls className={styles.designAudioPlayer} src={clonePreviewAudioSrc} />
                        </div>
                      )}
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
                      <label className={styles.paramField}>CFG 强度
                        <input className={styles.range} aria-label="CFG 强度" type="range" min={1} max={5} step={0.1} value={params.voxcpm_cfg_value ?? 2} onChange={(event) => setParams({ voxcpm_cfg_value: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{(params.voxcpm_cfg_value ?? 2).toFixed(1)}</span>
                      </label>
                      <label className={styles.paramField}>去噪步数
                        <input className={styles.range} aria-label="去噪步数" type="range" min={1} max={50} step={1} value={params.voxcpm_inference_timesteps ?? 10} onChange={(event) => setParams({ voxcpm_inference_timesteps: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{params.voxcpm_inference_timesteps ?? 10}</span>
                      </label>
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
                        onChange({
                          ...draft,
                          default_engine: 'mimo_tts',
                          default_engine_params: { ...draft.default_engine_params, engine: 'mimo_tts', mimo_mode: 'voicedesign' } as SegmentEngineParams,
                        });
                      }}>MiMo</button>
                      <button type="button" className={`${styles.enginePill} ${designSubEngine === 'voxcpm' ? styles.enginePillActive : ''}`} onClick={() => {
                        setDesignSubEngine('voxcpm');
                        onChange({
                          ...draft,
                          default_engine: 'voxcpm',
                          default_engine_params: { ...draft.default_engine_params, engine: 'voxcpm', voxcpm_mode: 'design' } as SegmentEngineParams,
                        });
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
              {designPhase === 'confirmed' && (
                <>
                  <p className={styles.designHint}>{designProfileId ? '音色已保存' : '音色已暂存 · 点击顶部「保存角色」完成持久化'}</p>
                  <div className={styles.designActions}>
                    <button type="button" className={styles.ghostButton} onClick={() => { setDesignProfileId(''); setDesignPhase('idle'); setDesignAudioBase64(''); setDesignAudioSrc(''); }}>重新设计</button>
                  </div>
                </>
              )}
              {(designAudioSrc || clonePreviewAudioSrc) && (designPhase === 'previewed' || designPhase === 'confirmed') && (
                <audio controls className={styles.designAudioPlayer} src={designAudioSrc || clonePreviewAudioSrc} />
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
  onEdit,
  onPreview,
  onDelete,
}: {
  role: Role;
  isDefault: boolean;
  onEdit: () => void;
  onPreview: () => void;
  onDelete?: () => void;
}) {
  const configured = isConfigured(role);
  const cardClass = [
    styles.charCard,
    isDefault ? styles.charCardDefault : '',
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
          <span className={`${styles.chip} ${styles.chipCast}`}>角色</span>
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
  projectId,
  onCreateRole,
  onSaveRole,
  onDeleteRole,
  onPreviewRole,
  onManageRoles,
}: ProjectVoicesProps) {
  const [editingRole, setEditingRole] = useState<RoleSnapshot | null>(null);
  const [engineFilter, setEngineFilter] = useState<EngineFilter>('all');

  const filterByEngine = (list: Role[]) =>
    engineFilter === 'all' ? list : list.filter(r => r.default_engine === engineFilter);

  const filteredRoles = filterByEngine(roles);

  const [saving, setSaving] = useState(false);

  const { triggerRefresh } = useVoiceRefresh();

  /** 试听角色：按 voice_id 查询已保存的音频，找不到再实时合成 */
  const handleCardPreview = useCallback(async (role: Role) => {
    const params = role.default_engine_params;
    const voiceId = params.mimo_clone_voice_id || params.voice_id || '';
    if (voiceId) {
      try {
        const list = await ttsApi.getVoices({ voice_id: voiceId });
        const profile = list[0];
        if (profile?.audio_url) {
          const audio = new Audio(profile.audio_url);
          audio.play().catch(() => {});
          return;
        }
      } catch { /* fall through to live synthesis */ }
    }
    onPreviewRole(roleToSnapshot(role), ROLE_SAMPLE);
  }, [onPreviewRole]);

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
          <p className={styles.headerDesc}>管理项目中的角色，配置音色、引擎和参数。</p>
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
          projectId={projectId}
        />
      )}

      {/* Roles */}
      <section className={styles.roleGroup}>
        <div className={styles.cardGrid} data-testid="role-list">
          {filteredRoles.length === 0 && (
            <div className={styles.emptyState}>
              <strong>还没有角色</strong>
              <p>创建角色，配置音色用于旁白和对话段落。</p>
            </div>
          )}
          {filteredRoles.map(role => (
            <CharacterCard
              key={role.id}
              role={role}
              isDefault={false}
              onEdit={() => setEditingRole(roleToSnapshot(role))}
              onPreview={() => handleCardPreview(role)}
              onDelete={() => onDeleteRole?.(role.id)}
            />
          ))}
          <button
            type="button"
            className={styles.placeholderCard}
            onClick={() => {
              if (onCreateRole) {
                onCreateRole();
              } else {
                setEditingRole(createRoleDraft());
              }
            }}
          >
            <span className={styles.placeholderIcon}>+</span>
            <span className={styles.placeholderLabel}>创建角色</span>
          </button>
        </div>
      </section>
    </section>
  );
}
