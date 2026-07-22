import { useEffect, useState, useCallback, useRef } from 'react';
import type { Role, RoleSnapshot, EngineParams, EdgeTTSParams, MiMoParams, CosyVoiceParams, VoxCPMParams, VoiceProfile, MiMoPresetVoice } from '../../types';
import { voicePreviewAudioUrl, voiceSourceAudioUrl } from '../../types';
import { ttsApi, voiceApi, mimoTtsApi, voxcpmApi } from '../../services/api';
import { fetchVoiceRolePreview, synthesizeVoiceRolePreview } from '../../services/voiceRolePreview';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
import { DEFAULT_EDGE_CAST_VOICE, DEFAULT_EDGE_NARRATOR_VOICE } from '../../services/voiceRoleDefaults';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import { ImageUploadZone } from '../ui/ImageUploadZone';
import { StyleInstructionPicker } from '../TTSSynthesis/StyleInstructionPicker';
import { AudioRecorder, AudioUploader, AudioPreview, UrlInput } from '../VoiceClone';
import { useTranslation, t } from '../../i18n';
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

const COMMON_EDGE_VOICES: { short_name: string; display_name: string; gender: string }[] = [
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
    role_kind: role.role_kind,
    voice: role.voice,
    favorite_styles: [...role.favorite_styles],
  };
}

function engineLabel(role: Role): string {
  const eng = role.voice?.engine;
  return ENGINE_META[eng as EngineKey]?.label ?? eng ?? '';
}

function isConfigured(role: Role): boolean {
  const v = role.voice;
  if (!v) return false;
  if (v.engine === 'edge_tts') return !!((v as { voice?: string }).voice);
  if (v.engine === 'mimo_tts' || v.engine === 'cosyvoice' || v.engine === 'voxcpm') return !!((v as { voice_id?: string }).voice_id);
  return false;
}

function roleVoiceDisplayName(role: Role): string {
  const v = role.voice;
  if (!v) return '';
  if (v.engine === 'edge_tts') return (v as { voice?: string }).voice ?? '';
  if (v.engine === 'mimo_tts') {
    const m = v as { mode?: string; voice_id?: string; voice_description?: string };
    return m.voice_description || m.voice_id || '';
  }
  if (v.engine === 'cosyvoice' || v.engine === 'voxcpm') {
    const c = v as { voice_id?: string; voice_description?: string };
    return c.voice_description || c.voice_id || '';
  }
  return '';
}

function createRoleDraft(): RoleSnapshot {
  const voice = { engine: 'edge_tts' as const, voice: DEFAULT_EDGE_CAST_VOICE, rate: '+0%', volume: '+0%' } as EdgeTTSParams;
  return {
    id: `role-cast-${Date.now()}`,
    name: t('projectVoices.newRole'),
    avatar: '',
    description: 'Cast',
    voice,
    favorite_styles: [],
    default_engine: voice.engine,
    default_voice: null,
    default_engine_params: {} as RoleSnapshot['default_engine_params'],
  };
}

/* ------------------------------------------------------------------ */
/*  Voice source category types                                        */
/* ------------------------------------------------------------------ */

type VoiceSourceCategory = 'preset' | 'clone' | 'design';

/** 判断当前 draft 属于哪个音色来源分类 */
// eslint-disable-next-line react-refresh/only-export-components
export function normalizeDraftForSave(draft: RoleSnapshot): RoleSnapshot {
  const voice = draft.voice;
  if (!voice) return draft;
  const engine = voice.engine;
  return {
    ...draft,
    default_engine: engine,
    default_voice: engine === 'edge_tts' ? (voice as EdgeTTSParams).voice || '' : null,
    default_engine_params: voice,
  };
}

function detectCategory(draft: RoleSnapshot): VoiceSourceCategory {
  const v = draft.voice;
  if (!v) return 'preset';
  if (v.engine === 'mimo_tts' && (v as MiMoParams).mode === 'voicedesign') return 'design';
  if (v.engine === 'voxcpm' && (v as VoxCPMParams).mode === 'tts_design') return 'design';
  if (v.engine === 'edge_tts') return 'preset';
  if (v.engine === 'mimo_tts' && ((v as MiMoParams).mode ?? 'preset') === 'preset') return 'preset';
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
  const { t } = useTranslation();

  const voiceSourceTabs: { value: VoiceSourceCategory; label: string; desc: string }[] = [
    { value: 'preset', label: t('projectVoices.presetVoice'), desc: t('projectVoices.presetVoiceDesc') },
    { value: 'clone', label: t('projectVoices.cloneVoice'), desc: t('projectVoices.cloneVoiceDesc') },
    { value: 'design', label: t('projectVoices.designVoice'), desc: t('projectVoices.designVoiceDesc') },
  ];

  const vox = draft.voice;
  const [edgeVoices, setEdgeVoices] = useState<{ short_name: string; display_name: string; gender: string }[]>(COMMON_EDGE_VOICES);
  const [mimoPresetVoices, setMimoPresetVoices] = useState<MiMoPresetVoice[]>([]);
  const { triggerRefresh } = useVoiceRefresh();

  // 音色来源分类
  const [voiceCategory, setVoiceCategory] = useState<VoiceSourceCategory>(() => detectCategory(draft));

  // 克隆流程状态
  const initCloneSubEngine = (): 'cosyvoice' | 'mimo' | 'voxcpm' => {
    const eng = draft.voice?.engine;
    if (eng === 'cosyvoice') return 'cosyvoice';
    if (eng === 'voxcpm') return 'voxcpm';
    return 'mimo';
  };
  const [cloneSubEngine, setCloneSubEngine] = useState<'cosyvoice' | 'mimo' | 'voxcpm'>(initCloneSubEngine);
  const [voxcpmCloneMode, setVoxcpmCloneMode] = useState<'clone' | 'ultimate'>(() =>
    (draft.voice?.engine === 'voxcpm' && (draft.voice as VoxCPMParams).mode === 'ultimate') ? 'ultimate' : 'clone',
  );
  const [cloneInputMethod, setCloneInputMethod] = useState<'record' | 'upload' | 'url'>('record');
  const [clonePendingFile, setClonePendingFile] = useState<File | null>(null);

  // 音色设计流程状态
  const [designSubEngine, setDesignSubEngine] = useState<'mimo' | 'voxcpm'>(
    draft.voice?.engine === 'voxcpm' ? 'voxcpm' : 'mimo',
  );
  const [designPhase, setDesignPhase] = useState<'idle' | 'previewing' | 'previewed' | 'saving' | 'confirmed'>('idle');
  const [designAudioBase64, setDesignAudioBase64] = useState('');
  const [designAudioSrc, setDesignAudioSrc] = useState('');
  const [designError, setDesignError] = useState('');
  const [designProfileId, setDesignProfileId] = useState('');

  // 已保存的设计音色预览（从 VoiceProfile 加载）
  const [clonePreviewAudioSrc, setClonePreviewAudioSrc] = useState('');
  const [cloneOriginalAudioSrc, setCloneOriginalAudioSrc] = useState('');
  const [cloneVoiceDescription, setCloneVoiceDescription] = useState('');
  const [clonePromptText, setClonePromptText] = useState('');
  // Clone preview generation status
  const [clonePreviewStatus, setClonePreviewStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle');
  const [clonePreviewError, setClonePreviewError] = useState('');

  const isDesignMode = voiceCategory === 'design';

  // Local editable state for design voice description (sync from vox on engine/voice change)
  const [localDesignDesc, setLocalDesignDesc] = useState('');
  useEffect(() => {
    const desc = designSubEngine === 'mimo'
      ? ((vox?.engine === 'mimo_tts' ? (vox as MiMoParams).voice_description : undefined) ?? '')
      : ((vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).voice_description : undefined) ?? '');
    setLocalDesignDesc(desc);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vox?.engine, (vox as VoxCPMParams | undefined)?.voice_description, designSubEngine]);

  const setVoiceDescription = (desc: string) => {
    setLocalDesignDesc(desc);
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
        t('projectVoices.auditionSampleText'),
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
        setDesignError(t('projectVoices.noAudioReturned'));
        setDesignPhase('idle');
      }
    } catch (err) {
      setDesignError(err instanceof Error ? err.message : t('projectVoices.previewFailed'));
      setDesignPhase('idle');
    }
  }, [draft, t]);

  /** 确认保存音色：将试听音频持久化为 VoiceProfile，但保持设计界面不变。返回 profile ID 或 null。 */
  const handleDesignConfirmSave = useCallback(async (): Promise<string | null> => {
    if (!designAudioBase64 && !designAudioSrc) {
      setDesignError(t('projectVoices.noAudioToSave'));
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
        setDesignError(t('projectVoices.cannotGetAudioData'));
        setDesignPhase('previewed');
        return null;
      }
      const engine = designSubEngine === 'mimo' ? 'mimo' : 'voxcpm';
      const instruction = designSubEngine === 'mimo'
        ? ((vox?.engine === 'mimo_tts' ? (vox as MiMoParams).instruction : undefined) ?? '')
        : ((vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).style_control : undefined) ?? '');
      const auditionText = t('projectVoices.auditionSampleText');
      const profile = await voiceApi.createFromDesign({
        audio_base64: audioBase64,
        engine,
        name: draft.name,
        description: localDesignDesc,
        project_id: projectId,
        voice_description: localDesignDesc,
        instruction,
        preview_text: auditionText,
        ...(engine === 'voxcpm' ? { original_prompt_text: localDesignDesc } : {}),
      });
      setDesignProfileId(profile.id);
      setDesignPhase('confirmed');
      triggerRefresh();
      return profile.id;
    } catch (err) {
      setDesignError(err instanceof Error ? err.message : t('projectVoices.saveFailed'));
      setDesignPhase('previewed');
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, designAudioBase64, designAudioSrc, designSubEngine, localDesignDesc, projectId]);

  useEffect(() => {
    ttsApi.getEdgeVoices('Chinese').then(setEdgeVoices).catch(() => {});
    mimoTtsApi.getPresetVoices().then(setMimoPresetVoices).catch(() => {});
  }, []);

  // 当已保存的角色有 clone voice id 时，按 ID 查询对应的 VoiceProfile
  // 从 engine 还原 UI 状态（音色来源分类、引擎、参数）
  const voiceEngineAppliedRef = useRef(false);
  const lastVoiceIdRef = useRef('');
  useEffect(() => {
    const voiceId = (vox?.engine === 'mimo_tts' ? (vox as MiMoParams).voice_id : vox?.engine === 'cosyvoice' ? (vox as CosyVoiceParams).voice_id : vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).voice_id : '') || '';
    if (!voiceId) { setClonePreviewAudioSrc(''); setCloneOriginalAudioSrc(''); setCloneVoiceDescription(''); setClonePromptText(''); return; }
    if (voiceId === lastVoiceIdRef.current) return;
    let cancelled = false;
    const fetchId = voiceId;
    ttsApi.getVoices({ voice_id: voiceId }).then(list => {
      if (cancelled) return;
      lastVoiceIdRef.current = fetchId;
      const profile = list[0];
      if (!profile) { setClonePreviewAudioSrc(''); setCloneOriginalAudioSrc(''); setCloneVoiceDescription(''); setClonePromptText(''); return; }
      const previewSrc = profile.has_preview ? voicePreviewAudioUrl(profile.id) : '';
      setClonePreviewAudioSrc(previewSrc);
      if (previewSrc) setClonePreviewStatus('done');
      setCloneOriginalAudioSrc(profile.has_source ? voiceSourceAudioUrl(profile.id) : '');
      setCloneVoiceDescription(profile.description ?? '');
      setClonePromptText((profile.description ?? '').slice(0, 100));

      if (voiceEngineAppliedRef.current) return;
      voiceEngineAppliedRef.current = true;

      const vv = profile.voice;
      if (!vv) return;

      const model = vv.model || '';
      const voiceType = vv.voice_type || '';
      if (voiceType === 'design') {
        setVoiceCategory('design');
        if (model === 'mimo_tts') setDesignSubEngine('mimo');
        else if (model === 'voxcpm') setDesignSubEngine('voxcpm');
        setDesignProfileId(profile.id);
        setDesignPhase('confirmed');
        // Set design audio from existing preview
        if (previewSrc) setDesignAudioSrc(previewSrc);
      } else if (voiceType === 'preset') {
        setVoiceCategory('preset');
      } else {
        setVoiceCategory('clone');
        if (model === 'cosyvoice') setCloneSubEngine('cosyvoice');
        else if (model === 'mimo_tts') setCloneSubEngine('mimo');
        else if (model === 'voxcpm') setCloneSubEngine('voxcpm');
      }
    }).catch(() => {
      if (!cancelled) { setClonePreviewAudioSrc(''); setCloneOriginalAudioSrc(''); setCloneVoiceDescription(''); setClonePromptText(''); }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.voice]);

  const setEngine = (engine: EngineParams['engine']) => {
    const current = draft.voice;
    let voice: EngineParams;

    switch (engine) {
      case 'edge_tts': {
        const existing = current?.engine === 'edge_tts' ? current as EdgeTTSParams : undefined;
        voice = { engine: 'edge_tts', voice: existing?.voice || DEFAULT_EDGE_CAST_VOICE, rate: existing?.rate || '+0%', volume: existing?.volume || '+0%' } as EdgeTTSParams;
        break;
      }
      case 'cosyvoice': {
        const existing = current?.engine === 'cosyvoice' ? current as CosyVoiceParams : undefined;
        voice = { engine: 'cosyvoice', voice_id: existing?.voice_id || '', speed: existing?.speed ?? 1, volume: existing?.volume ?? 80, pitch: existing?.pitch ?? 1, language: existing?.language || 'Chinese', instruction: existing?.instruction || '' } as CosyVoiceParams;
        break;
      }
      case 'mimo_tts': {
        const existing = current?.engine === 'mimo_tts' ? current as MiMoParams : undefined;
        voice = { engine: 'mimo_tts', mode: existing?.mode || 'preset', voice_id: existing?.voice_id || '', instruction: existing?.instruction, voice_description: existing?.voice_description } as MiMoParams;
        break;
      }
      case 'voxcpm': {
        const existing = current?.engine === 'voxcpm' ? current as VoxCPMParams : undefined;
        voice = { engine: 'voxcpm', mode: existing?.mode || 'clone', voice_id: existing?.voice_id || '', voice_description: existing?.voice_description, style_control: existing?.style_control, cfg_value: existing?.cfg_value, inference_timesteps: existing?.inference_timesteps } as VoxCPMParams;
        break;
      }
      default:
        voice = current || { engine: 'edge_tts', voice: DEFAULT_EDGE_CAST_VOICE, rate: '+0%', volume: '+0%' } as EdgeTTSParams;
    }
    onChange({ ...draft, voice });
  };

  const setParams = (next: Record<string, unknown>) => {
    const v = draft.voice;
    if (!v) return;
    let updated: EngineParams;

    switch (v.engine) {
      case 'edge_tts':
        updated = {
          ...v,
          ...(next.edge_voice !== undefined ? { voice: next.edge_voice as string } : {}),
          ...(next.edge_rate !== undefined ? { rate: next.edge_rate as string } : {}),
          ...(next.edge_volume !== undefined ? { volume: next.edge_volume as string } : {}),
        } as EdgeTTSParams;
        break;
      case 'cosyvoice':
        updated = {
          ...v,
          ...(next.voice_id !== undefined ? { voice_id: next.voice_id as string } : {}),
          ...(next.instruction !== undefined ? { instruction: next.instruction as string } : {}),
          ...(next.speed !== undefined ? { speed: next.speed as number } : {}),
          ...(next.volume !== undefined ? { volume: next.volume as number } : {}),
          ...(next.pitch !== undefined ? { pitch: next.pitch as number } : {}),
          ...(next.language !== undefined ? { language: next.language as string } : {}),
        } as CosyVoiceParams;
        break;
      case 'mimo_tts':
        updated = {
          ...v,
          ...(next.mimo_mode !== undefined ? { mode: next.mimo_mode as MiMoParams['mode'] } : {}),
          ...(next.mimo_preset_voice !== undefined ? { mode: 'preset' as const, voice_id: next.mimo_preset_voice as string } : {}),
          ...(next.mimo_clone_voice_id !== undefined ? { voice_id: next.mimo_clone_voice_id as string } : {}),
          ...(next.mimo_instruction !== undefined ? { instruction: next.mimo_instruction as string } : {}),
          ...(next.mimo_voice_description !== undefined ? { voice_description: next.mimo_voice_description as string } : {}),
          ...(next.voice_id !== undefined ? { voice_id: next.voice_id as string } : {}),
        } as MiMoParams;
        break;
      case 'voxcpm':
        updated = {
          ...v,
          ...(next.voxcpm_mode !== undefined ? { mode: ((next.voxcpm_mode === 'design' ? 'tts_design' : next.voxcpm_mode) as VoxCPMParams['mode']) } : {}),
          ...(next.voice_id !== undefined ? { voice_id: next.voice_id as string } : {}),
          ...(next.voxcpm_voice_description !== undefined ? { voice_description: next.voxcpm_voice_description as string } : {}),
          ...(next.voxcpm_style_control !== undefined ? { style_control: next.voxcpm_style_control as string } : {}),
          ...(next.voxcpm_cfg_value !== undefined ? { cfg_value: next.voxcpm_cfg_value as number } : {}),
          ...(next.voxcpm_inference_timesteps !== undefined ? { inference_timesteps: next.voxcpm_inference_timesteps as number } : {}),
        } as VoxCPMParams;
        break;
      default:
        return;
    }
    onChange({ ...draft, voice: updated });
  };

  /** 切换音色来源分类时，保留已有参数，只切换引擎模式 */
  const switchCategory = (cat: VoiceSourceCategory) => {
    setVoiceCategory(cat);
    setDesignError('');
    // Derive sub-engine from current draft.voice when switching to clone/design
    if (cat === 'clone') {
      const eng = draft.voice?.engine;
      if (eng === 'cosyvoice') setCloneSubEngine('cosyvoice');
      else if (eng === 'voxcpm') setCloneSubEngine('voxcpm');
      else setCloneSubEngine('mimo');
    } else if (cat === 'design') {
      const eng = draft.voice?.engine;
      const sub = eng === 'voxcpm' ? 'voxcpm' : 'mimo';
      setDesignSubEngine(sub);
      // Directly set the voice object with voicedesign mode so params.route properly
      if (sub === 'voxcpm') {
        onChange({
          ...draft,
          voice: { engine: 'voxcpm', mode: 'tts_design' as const, voice_id: '' } as VoxCPMParams,
        });
      } else {
        onChange({
          ...draft,
          voice: { engine: 'mimo_tts', mode: 'voicedesign' as const, voice_id: '' } as MiMoParams,
        });
      }
      setVoiceCategory('design');
    }
  };

  /** 克隆成功后自动绑定新声音到角色 */
  const handleCloneSuccess = async (engine: 'cosyvoice' | 'mimo' | 'voxcpm') => {
    setCloneInputMethod('record');
    setClonePendingFile(null);
    triggerRefresh();
    try {
      const list = await voiceApi.list(projectId);
      const sorted = [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      let matchedVoice: VoiceProfile | undefined;

      if (engine === 'cosyvoice') {
        matchedVoice = sorted.find(v => v.voice?.model === 'cosyvoice' && v.voice?.voice_type === 'clone');
        if (matchedVoice) setParams({ voice_id: (matchedVoice.voice_params?.cosyvoice?.params as Record<string, unknown>)?.voice_id as string || matchedVoice.id });
      } else if (engine === 'mimo') {
        matchedVoice = sorted.find(v => v.voice?.voice_type === 'clone' && (v.voice?.model === 'mimo_tts' || v.voice?.model === 'voxcpm'));
        if (matchedVoice) setParams({ mimo_clone_voice_id: matchedVoice.id });
      } else {
        matchedVoice = sorted.find(v => v.voice?.model === 'voxcpm' && v.voice?.voice_type === 'clone');
        if (matchedVoice) setParams({ voice_id: matchedVoice.id });
      }

      // Generate TTS preview and save to cloned_preview_path
      if (matchedVoice) {
        setClonePreviewStatus('generating');
        setClonePreviewError('');
        try {
          await generateAndSavePreview(engine, matchedVoice);
          setClonePreviewStatus('done');
        } catch (err) {
          setClonePreviewStatus('error');
          setClonePreviewError(err instanceof Error ? err.message : t('projectVoices.previewFailed'));
        }
      }
    } catch { /* ignore refresh errors */ }
  };

  /** Generate a TTS preview using the cloned voice and save it to the voice profile */
  const generateAndSavePreview = async (engine: 'cosyvoice' | 'mimo' | 'voxcpm', voice: VoiceProfile) => {
    const previewText = SAMPLE_TEXT;

    try {
      let ttsResult;
      if (engine === 'cosyvoice') {
        const voiceId = (voice.voice_params?.cosyvoice?.params as Record<string, unknown>)?.voice_id as string || voice.id;
        ttsResult = await ttsApi.synthesize({ text: previewText, engine: 'cosyvoice', voice_id: voiceId, language: 'Chinese', speed: 1, volume: 80, pitch: 1, format: 'mp3' });
      } else if (engine === 'mimo') {
        ttsResult = await mimoTtsApi.synthesizeVoiceClone({ text: previewText, voice_id: voice.id, format: 'wav' });
      } else {
        const voxcpmMode = (voice.voice_params?.voxcpm?.params as Record<string, unknown>)?.mode as string | undefined;
        if (voxcpmMode === 'ultimate') {
          ttsResult = await voxcpmApi.ultimateClone({ text: previewText, voice_id: voice.id, prompt_text: undefined, format: 'wav' });
        } else {
          ttsResult = await voxcpmApi.clone({ text: previewText, voice_id: voice.id, format: 'wav' });
        }
      }

      const { base64, format } = await resolveAudioBase64(ttsResult);
      const saveResult = await voiceApi.savePreviewAudio(voice.id, base64, format);
      if (!saveResult.preview_audio_path) throw new Error(t('projectVoices.backendNoPreviewPath'));
      setClonePreviewAudioSrc(`data:audio/${format};base64,${base64}`);
    } catch (err) {
      console.warn('Failed to generate/save clone preview:', err);
      throw err;
    }
  };

  const SAMPLE_TEXT = t('projectVoices.auditionSampleText');

  /** 从当前 draft 提取引擎参数，用于克隆时写入 VoiceProfile.engine_params */
  const cloneEngineParams = (engine: 'cosyvoice' | 'mimo' | 'voxcpm'): Record<string, unknown> => {
    const v = draft.voice;
    if (engine === 'cosyvoice') {
      const cv = v?.engine === 'cosyvoice' ? v as CosyVoiceParams : undefined;
      return { speed: cv?.speed ?? 1, volume: cv?.volume ?? 80, pitch: cv?.pitch ?? 1, language: cv?.language || 'Chinese', instruction: cv?.instruction || '', input_method: cloneInputMethod };
    }
    if (engine === 'mimo') {
      const mv = v?.engine === 'mimo_tts' ? v as MiMoParams : undefined;
      return { mimo_mode: 'voiceclone', mimo_instruction: mv?.instruction || '', input_method: cloneInputMethod };
    }
    const vv = v?.engine === 'voxcpm' ? v as VoxCPMParams : undefined;
    return { voxcpm_mode: voxcpmCloneMode, voxcpm_style_control: vv?.style_control || '', cfg_value: vv?.cfg_value ?? 2, inference_timesteps: vv?.inference_timesteps ?? 10, input_method: cloneInputMethod };
  };

  /** 从 TTS 结果中提取 base64 音频数据；后端存储模式下仅返回 audio_url，需 fetch 转换 */
  const resolveAudioBase64 = async (result: { audio_base64?: string; audio_url?: string; audio_format?: string }): Promise<{ base64: string; format: string }> => {
    const format = result.audio_format || 'mp3';
    if (result.audio_base64) return { base64: result.audio_base64, format };
    if (result.audio_url) {
      const resp = await fetch(result.audio_url);
      if (!resp.ok) throw new Error(`${t('projectVoices.cannotGetAudioData')}: ${resp.status}`);
      const blob = await resp.blob();
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return { base64: btoa(binary), format };
    }
    throw new Error(t('projectVoices.synthesisNoAudio'));
  };

  /** Clone mode: synthesize preview, play it, and save to cloned_preview_path */
  const [clonePreviewing, setClonePreviewing] = useState(false);
  const handleClonePreview = useCallback(async () => {
    setClonePreviewing(true);
    setClonePreviewError('');
    try {
      const normalized = normalizeDraftForSave(draft);
      const result = await synthesizeVoiceRolePreview(normalized, SAMPLE_TEXT);
      const { base64, format } = await resolveAudioBase64(result);

      // Play
      const src = `data:audio/${format};base64,${base64}`;
      const audio = new Audio(src);
      await audio.play();

      // Save preview audio to VoiceProfile (only for clone/design voices with a UUID voice_id;
      // MiMo preset voice_id is a name like "白桦", not a VoiceProfile UUID)
      const voiceId = (vox?.engine === 'mimo_tts' ? (vox as MiMoParams).voice_id : vox?.engine === 'cosyvoice' ? (vox as CosyVoiceParams).voice_id : vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).voice_id : '') || '';
      const isPresetVoice = vox?.engine === 'mimo_tts' && ((vox as MiMoParams).mode ?? 'preset') === 'preset';
      if (voiceId && !isPresetVoice) {
        const saveResult = await voiceApi.savePreviewAudio(voiceId, base64, format);
        if (!saveResult.preview_audio_path) throw new Error(t('projectVoices.backendNoPreviewPath'));
      }
      setClonePreviewAudioSrc(src);
      setClonePreviewStatus('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('projectVoices.previewFailed');
      setClonePreviewError(msg);
      setClonePreviewStatus('error');
    } finally {
      setClonePreviewing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, draft.voice]);

  return (
    <section className={styles.editorPanel} aria-label={t('projectVoices.voiceRoleEditor')}>
      <div className={styles.editorBar}>
        <div>
          <span className={styles.kicker}>Voice Role</span>
          <h3>{draft.name || t('projectVoices.voiceRoleConfig')}</h3>
          <p>{t('projectVoices.selectVoiceSourceAndParams')}</p>
        </div>
        <div className={styles.editorActions}>
          <button type="button" className={styles.ghostButton} onClick={onCancel}>{t('common.cancel')}</button>
          <button type="button" className={styles.primaryButton} disabled={saving || designPhase === 'saving'} onClick={async () => {
            if (isDesignMode) {
              // 如果还没确认过音色，先自动确认
              let profileId: string | null = designProfileId;
              if (!profileId) {
                if (!designAudioBase64 && !designAudioSrc) {
                  setDesignError(t('projectVoices.previewBeforeSave'));
                  return;
                }
                profileId = await handleDesignConfirmSave();
                if (!profileId) return;
              }
              // 保持 design 模式不变，合成时再自动转为对应的 clone 方式
              // voice_id 存储 design VoiceProfile 的 ID，用于查找参考音频
              const designVoice: EngineParams = designSubEngine === 'mimo'
                ? { engine: 'mimo_tts', mode: 'voicedesign' as const, voice_id: profileId, ...(draft.voice?.engine === 'mimo_tts' ? { instruction: (draft.voice as MiMoParams).instruction, voice_description: (draft.voice as MiMoParams).voice_description } : {}) } as MiMoParams
                : { engine: 'voxcpm', mode: 'tts_design' as const, voice_id: profileId, ...(draft.voice?.engine === 'voxcpm' ? { voice_description: (draft.voice as VoxCPMParams).voice_description } : {}) } as VoxCPMParams;
              onSave({ ...draft, voice: designVoice });
              return;
            }
            // Preset voice: 生成音频文件并创建 VoiceProfile
            if (voiceCategory === 'preset') {
              try {
                const normalized = normalizeDraftForSave(draft);
                const result = await fetchVoiceRolePreview(normalized, SAMPLE_TEXT);
                const { base64 } = await resolveAudioBase64(result);
                const isEdgeTtsPreset = draft.voice?.engine === 'edge_tts';
                const profile = await voiceApi.createFromDesign({
                  audio_base64: base64,
                  engine: 'preset',
                  name: draft.name,
                  description: draft.description || '',
                  project_id: projectId,
                  preview_text: SAMPLE_TEXT,
                  instruction: (draft.voice?.engine === 'mimo_tts' ? (draft.voice as MiMoParams).instruction : undefined) || '',
                  default_voice: isEdgeTtsPreset ? (draft.voice as EdgeTTSParams).voice : undefined,
                });
                // MiMo 预置音色：转为 voiceclone 模式使用 VoiceProfile 参考音频
                // Edge-TTS：保持 edge_tts 引擎，存储 voice_id 以便试听
                const v = draft.voice;
                let savedVoice: EngineParams;
                if (v?.engine === 'mimo_tts' && (v as MiMoParams).mode === 'preset') {
                  savedVoice = { ...v, mode: 'voiceclone' as const, voice_id: profile.id } as MiMoParams;
                } else if (v?.engine === 'edge_tts') {
                  savedVoice = { ...v, voice_id: profile.id } as EdgeTTSParams;
                } else {
                  savedVoice = { engine: 'edge_tts' as const, voice: DEFAULT_EDGE_CAST_VOICE, rate: '+0%', volume: '+0%' } as EdgeTTSParams;
                }
                onSave({ ...draft, voice: savedVoice });
              } catch (err) {
                setDesignError(err instanceof Error ? err.message : t('projectVoices.presetVoiceSaveFailed'));
              }
              return;
            }
            // Clone mode: verify preview audio was saved
            if (voiceCategory === 'clone') {
              if (clonePreviewStatus === 'generating') {
                setClonePreviewError(t('projectVoices.waitForPreviewGeneration'));
                return;
              }
              if (clonePreviewStatus === 'error' || !clonePreviewAudioSrc) {
                setClonePreviewError(t('projectVoices.generatePreviewFirst'));
                return;
              }
            }
            onSave(normalizeDraftForSave(draft));
          }}>{saving ? t('common.saving') : t('projectVoices.saveRole')}</button>
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
                <label>{t('projectVoices.roleName')}
                  <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
                </label>
              </div>
            </div>
          </section>

          {/* 音色来源分类 */}
          <section className={styles.configCard}>
            <h4>{t('projectVoices.voiceSource')}</h4>
            <div className={styles.engineRow}>
              <div className={styles.enginePills}>
                {voiceSourceTabs.map(tab => (
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
                      <button type="button" className={`${styles.enginePill} ${vox?.engine === 'edge_tts' ? styles.enginePillActive : ''}`} onClick={() => setEngine('edge_tts')}>Edge-TTS</button>
                      <button type="button" className={`${styles.enginePill} ${vox?.engine === 'mimo_tts' ? styles.enginePillActive : ''}`} onClick={() => setEngine('mimo_tts')}>MiMo</button>
                    </div>
                  </div>

                  {/* Edge-TTS 预制 */}
                  {vox?.engine === 'edge_tts' && (
                    <>
                      <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>{t('projectVoices.voice')}
                        <select className={styles.paramSelect} value={(vox as EdgeTTSParams).voice ?? ''} onChange={(event) => setParams({ edge_voice: event.target.value })}>
                          {(vox as EdgeTTSParams).voice && <option value={(vox as EdgeTTSParams).voice}>{(vox as EdgeTTSParams).voice}</option>}
                          {edgeVoices.map(v => (
                            <option key={v.short_name} value={v.short_name}>
                              {v.display_name} ({v.gender === 'Female' ? t('common.female') : t('common.male')})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.paramField}>{t('tts.speed')}
                        <select className={styles.paramSelect} value={(vox as EdgeTTSParams).rate ?? '+0%'} onChange={(event) => setParams({ edge_rate: event.target.value })}>
                          {['-50%', '-30%', '-20%', '-10%', '+0%', '+10%', '+20%', '+30%', '+50%', '+80%', '+100%'].map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </label>
                      <label className={styles.paramField}>{t('tts.volume')}
                        <select className={styles.paramSelect} value={(vox as EdgeTTSParams).volume ?? '+0%'} onChange={(event) => setParams({ edge_volume: event.target.value })}>
                          {['-50%', '-30%', '-20%', '-10%', '+0%', '+10%', '+20%', '+30%', '+50%', '+80%', '+100%'].map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </label>
                    </>
                  )}

                  {/* MiMo 预制 */}
                  {vox?.engine === 'mimo_tts' && (
                    <>
                      <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>{t('projectVoices.presetVoice')}
                        <select className={styles.paramSelect} value={(vox as MiMoParams).voice_id ?? ''} onChange={(event) => setParams({ mimo_preset_voice: event.target.value })}>
                          {mimoPresetVoices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name} ({v.gender === 'Female' ? t('common.female') : t('common.male')})</option>)}
                        </select>
                      </label>
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <StyleInstructionPicker value={(vox as MiMoParams).instruction ?? ''} onChange={(value) => setParams({ mimo_instruction: value })} label={t('tts.styleInstruction')} placeholder={t('tts.styleInstructionPlaceholder')} dense />
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
                      <button type="button" className={`${styles.enginePill} ${cloneSubEngine === 'cosyvoice' ? styles.enginePillActive : ''}`} onClick={() => { setCloneSubEngine('cosyvoice'); setEngine('cosyvoice'); setCloneInputMethod('record'); setClonePendingFile(null); }}>CosyVoice</button>
                      <button type="button" className={`${styles.enginePill} ${cloneSubEngine === 'mimo' ? styles.enginePillActive : ''}`} onClick={() => {
                        setCloneSubEngine('mimo');
                        setCloneInputMethod('record');
                        setClonePendingFile(null);
                        // Preserve existing voice_id if already on this engine
                        const keepVid = vox?.engine === 'mimo_tts' ? (vox as MiMoParams).voice_id : undefined;
                        onChange({
                          ...draft,
                          voice: { engine: 'mimo_tts', mode: 'voiceclone' as const, voice_id: keepVid || '', ...(vox?.engine === 'mimo_tts' ? { instruction: (vox as MiMoParams).instruction } : {}) } as MiMoParams,
                        });
                      }}>MiMo</button>
                      <button type="button" className={`${styles.enginePill} ${cloneSubEngine === 'voxcpm' ? styles.enginePillActive : ''}`} onClick={() => {
                        setCloneSubEngine('voxcpm');
                        setCloneInputMethod('record');
                        setClonePendingFile(null);
                        const keepVid = vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).voice_id : undefined;
                        onChange({
                          ...draft,
                          voice: { engine: 'voxcpm', mode: 'clone' as const, voice_id: keepVid || '' } as VoxCPMParams,
                        });
                      }}>VoxCPM</button>
                    </div>
                  </div>

                  {/* CosyVoice 克隆 */}
                  {cloneSubEngine === 'cosyvoice' && (
                    <>
                      <div style={{ gridColumn: '1 / -1' }}>
                        {cloneOriginalAudioSrc && !clonePendingFile ? (
                          <div style={{ padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                            <span className={styles.paramLabel}>{t('projectVoices.originalAudio')}</span>
                            <audio controls style={{ width: '100%', marginTop: '0.25rem' }} src={cloneOriginalAudioSrc} />
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                              <button type="button" className={styles.ghostButton} onClick={() => setCloneOriginalAudioSrc('')}>{t('projectVoices.reInputUrl')}</button>
                            </div>
                          </div>
                        ) : (
                          <UrlInput
                            projectId={projectId}
                            onUrlConfirmed={async (voice) => {
                              try {
                                await voiceApi.createClone(voice.id, draft.name, undefined, projectId, cloneEngineParams('cosyvoice'));
                                setParams({ voice_id: (voice.voice_params?.cosyvoice?.params as Record<string, unknown>)?.voice_id as string || voice.id });
                                triggerRefresh();
                              } catch { /* error handled below */ }
                              setCloneInputMethod('url');
                            }}
                            onBack={() => setCloneInputMethod('url')}
                          />
                        )}
                      </div>

                      <label className={styles.paramField}>{t('tts.speed')}
                        <input className={styles.range} aria-label={t('tts.speed')} type="range" min={0.5} max={2} step={0.01} value={(vox as CosyVoiceParams).speed ?? 1} onChange={(event) => setParams({ speed: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{((vox as CosyVoiceParams).speed ?? 1).toFixed(2)}×</span>
                      </label>
                      <label className={styles.paramField}>{t('tts.volume')}
                        <input className={styles.range} aria-label={t('tts.volume')} type="range" min={0} max={100} value={(vox as CosyVoiceParams).volume ?? 80} onChange={(event) => setParams({ volume: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{(vox as CosyVoiceParams).volume ?? 80}</span>
                      </label>
                      <label className={styles.paramField}>{t('projectVoices.pitch')}
                        <input className={styles.range} aria-label={t('projectVoices.pitch')} type="range" min={0.5} max={2} step={0.01} value={(vox as CosyVoiceParams).pitch ?? 1} onChange={(event) => setParams({ pitch: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{((vox as CosyVoiceParams).pitch ?? 1).toFixed(2)}</span>
                      </label>
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <StyleInstructionPicker value={(vox as CosyVoiceParams).instruction ?? ''} onChange={(value) => setParams({ instruction: value })} label={t('tts.styleInstruction')} placeholder={t('tts.styleInstructionPlaceholder')} dense />
                      </div>
                      <label className={styles.paramField}>{t('tts.language')}
                        <select className={styles.paramSelect} value={(vox as CosyVoiceParams).language || 'Chinese'} onChange={(event) => setParams({ language: event.target.value })}>
                          <option value="Chinese">{t('segment.language.chinese')}</option>
                          <option value="English">{t('segment.language.english')}</option>
                          <option value="Japanese">{t('segment.language.japanese')}</option>
                          <option value="Korean">{t('segment.language.korean')}</option>
                        </select>
                      </label>
                    </>
                  )}

                  {/* MiMo 克隆 */}
                  {cloneSubEngine === 'mimo' && (
                    <>
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <div className={styles.enginePills} style={{ marginBottom: '0.5rem' }}>
                          {(['record', 'upload'] as const).map(m => (
                            <button key={m} type="button"
                              className={`${styles.enginePill} ${cloneInputMethod === m ? styles.enginePillActive : ''}`}
                              onClick={() => { setCloneInputMethod(m); setClonePendingFile(null); }}>
                              {m === 'record' ? t('common.record') : t('common.upload')}
                            </button>
                          ))}
                        </div>
                      </div>

                      {cloneInputMethod === 'record' && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          {cloneOriginalAudioSrc && !clonePendingFile ? (
                            <div style={{ padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                              <span className={styles.paramLabel}>{t('projectVoices.originalRecording')}</span>
                              <audio controls style={{ width: '100%', marginTop: '0.25rem' }} src={cloneOriginalAudioSrc} />
                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <button type="button" className={styles.ghostButton} onClick={() => setCloneOriginalAudioSrc('')}>{t('projectVoices.reRecord')}</button>
                                <button type="button" className={styles.ghostButton} onClick={() => { setCloneInputMethod('upload'); setCloneOriginalAudioSrc(''); }}>{t('projectVoices.reUpload')}</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <AudioRecorder onRecordComplete={file => setClonePendingFile(file)} />
                              {clonePendingFile && (
                                <AudioPreview
                                  file={clonePendingFile}
                                  engine="mimo"
                                  projectId={projectId}
                                  engineParams={cloneEngineParams('mimo')}
                                  onCloneSuccess={() => handleCloneSuccess('mimo')}
                                  onCancel={() => { setClonePendingFile(null); setCloneInputMethod('record'); }}
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {cloneInputMethod === 'upload' && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          {cloneOriginalAudioSrc && !clonePendingFile ? (
                            <div style={{ padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                              <span className={styles.paramLabel}>{t('projectVoices.originalRecording')}</span>
                              <audio controls style={{ width: '100%', marginTop: '0.25rem' }} src={cloneOriginalAudioSrc} />
                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <button type="button" className={styles.ghostButton} onClick={() => { setCloneInputMethod('record'); setCloneOriginalAudioSrc(''); }}>{t('projectVoices.reRecord')}</button>
                                <button type="button" className={styles.ghostButton} onClick={() => setCloneOriginalAudioSrc('')}>{t('projectVoices.reUpload')}</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <AudioUploader onFileSelected={file => setClonePendingFile(file)} />
                              {clonePendingFile && (
                                <AudioPreview
                                  file={clonePendingFile}
                                  engine="mimo"
                                  projectId={projectId}
                                  engineParams={cloneEngineParams('mimo')}
                                  onCloneSuccess={() => handleCloneSuccess('mimo')}
                                  onCancel={() => { setClonePendingFile(null); setCloneInputMethod('record'); }}
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {((vox?.engine === 'mimo_tts' ? (vox as MiMoParams).voice_description : undefined) || cloneVoiceDescription) && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <span className={styles.paramLabel}>{t('projectVoices.voiceDescriptionSource')}</span>
                          <p className={styles.configHint} style={{ marginTop: '0.25rem' }}>{(vox?.engine === 'mimo_tts' ? (vox as MiMoParams).voice_description : undefined) || cloneVoiceDescription}</p>
                        </div>
                      )}
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <StyleInstructionPicker value={(vox?.engine === 'mimo_tts' ? (vox as MiMoParams).instruction : undefined) ?? ''} onChange={(value) => setParams({ mimo_instruction: value })} label={t('tts.styleInstruction')} placeholder={t('tts.styleInstructionPlaceholder')} dense />
                      </div>
                    </>
                  )}

                  {/* VoxCPM 克隆 */}
                  {cloneSubEngine === 'voxcpm' && (
                    <>
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <div className={styles.enginePills} style={{ marginBottom: '0.5rem' }}>
                          <button type="button" className={`${styles.enginePill} ${voxcpmCloneMode === 'clone' ? styles.enginePillActive : ''}`} onClick={() => { setVoxcpmCloneMode('clone'); setParams({ voxcpm_mode: 'clone' }); }}>{t('projectVoices.voiceClone')}</button>
                          <button type="button" className={`${styles.enginePill} ${voxcpmCloneMode === 'ultimate' ? styles.enginePillActive : ''}`} onClick={() => { setVoxcpmCloneMode('ultimate'); setParams({ voxcpm_mode: 'ultimate' }); }}>{t('projectVoices.ultimateClone')}</button>
                        </div>
                      </div>
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <div className={styles.enginePills} style={{ marginBottom: '0.5rem' }}>
                          {(['record', 'upload'] as const).map(m => (
                            <button key={m} type="button"
                              className={`${styles.enginePill} ${cloneInputMethod === m ? styles.enginePillActive : ''}`}
                              onClick={() => { setCloneInputMethod(m); setClonePendingFile(null); }}>
                              {m === 'record' ? t('common.record') : t('common.upload')}
                            </button>
                          ))}
                        </div>
                      </div>

                      {cloneInputMethod === 'record' && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          {cloneOriginalAudioSrc && !clonePendingFile ? (
                            <div style={{ padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                              <span className={styles.paramLabel}>{t('projectVoices.originalRecording')}</span>
                              <audio controls style={{ width: '100%', marginTop: '0.25rem' }} src={cloneOriginalAudioSrc} />
                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <button type="button" className={styles.ghostButton} onClick={() => setCloneOriginalAudioSrc('')}>{t('projectVoices.reRecord')}</button>
                                <button type="button" className={styles.ghostButton} onClick={() => { setCloneInputMethod('upload'); setCloneOriginalAudioSrc(''); }}>{t('projectVoices.reUpload')}</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <AudioRecorder onRecordComplete={file => setClonePendingFile(file)} />
                              {clonePendingFile && (
                                <AudioPreview
                                  file={clonePendingFile}
                                  engine="voxcpm"
                                  projectId={projectId}
                                  engineParams={cloneEngineParams('voxcpm')}
                                  onCloneSuccess={() => handleCloneSuccess('voxcpm')}
                                  onCancel={() => { setClonePendingFile(null); setCloneInputMethod('record'); }}
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {cloneInputMethod === 'upload' && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          {cloneOriginalAudioSrc && !clonePendingFile ? (
                            <div style={{ padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                              <span className={styles.paramLabel}>{t('projectVoices.originalRecording')}</span>
                              <audio controls style={{ width: '100%', marginTop: '0.25rem' }} src={cloneOriginalAudioSrc} />
                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <button type="button" className={styles.ghostButton} onClick={() => { setCloneInputMethod('record'); setCloneOriginalAudioSrc(''); }}>{t('projectVoices.reRecord')}</button>
                                <button type="button" className={styles.ghostButton} onClick={() => setCloneOriginalAudioSrc('')}>{t('projectVoices.reUpload')}</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <AudioUploader onFileSelected={file => setClonePendingFile(file)} />
                              {clonePendingFile && (
                                <AudioPreview
                                  file={clonePendingFile}
                                  engine="voxcpm"
                                  projectId={projectId}
                                  engineParams={cloneEngineParams('voxcpm')}
                                  onCloneSuccess={() => handleCloneSuccess('voxcpm')}
                                  onCancel={() => { setClonePendingFile(null); setCloneInputMethod('record'); }}
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}
                      {((vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).voice_description : undefined) || cloneVoiceDescription) && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <span className={styles.paramLabel}>{t('projectVoices.voiceDescriptionSource')}</span>
                          <p className={styles.configHint} style={{ marginTop: '0.25rem' }}>{(vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).voice_description : undefined) || cloneVoiceDescription}</p>
                        </div>
                      )}
                      {voxcpmCloneMode === 'clone' && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <StyleInstructionPicker value={(vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).style_control : undefined) ?? ''} onChange={(value) => setParams({ voxcpm_style_control: value })} label={t('tts.styleInstruction')} placeholder={t('tts.styleInstructionPlaceholder')} dense />
                        </div>
                      )}
                      {voxcpmCloneMode === 'ultimate' && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <span className={styles.paramLabel}>{t('projectVoices.referenceAudioText')}</span>
                          {clonePromptText ? (
                            <span className={styles.configHint} style={{ display: 'block', marginTop: '0.25rem' }}>{clonePromptText}</span>
                          ) : (
                            <span style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.8rem', display: 'block', marginTop: '0.25rem' }}>{t('projectVoices.missingRefAudioText')}</span>
                          )}
                        </div>
                      )}
                      <label className={styles.paramField}>{t('projectVoices.cfgStrength')}
                        <input className={styles.range} aria-label={t('projectVoices.cfgStrength')} type="range" min={1} max={5} step={0.1} value={(vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).cfg_value : undefined) ?? 2} onChange={(event) => setParams({ voxcpm_cfg_value: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{((vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).cfg_value : undefined) ?? 2).toFixed(1)}</span>
                      </label>
                      <label className={styles.paramField}>{t('projectVoices.denoiseSteps')}
                        <input className={styles.range} aria-label={t('projectVoices.denoiseSteps')} type="range" min={1} max={50} step={1} value={(vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).inference_timesteps : undefined) ?? 10} onChange={(event) => setParams({ voxcpm_inference_timesteps: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{(vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).inference_timesteps : undefined) ?? 10}</span>
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
                          voice: { engine: 'mimo_tts', mode: 'voicedesign' as const, voice_id: '', voice_description: (vox?.engine === 'mimo_tts' ? (vox as MiMoParams).voice_description : undefined) || '' } as MiMoParams,
                        });
                      }}>MiMo</button>
                      <button type="button" className={`${styles.enginePill} ${designSubEngine === 'voxcpm' ? styles.enginePillActive : ''}`} onClick={() => {
                        setDesignSubEngine('voxcpm');
                        onChange({
                          ...draft,
                          voice: { engine: 'voxcpm', mode: 'tts_design' as const, voice_id: '', voice_description: (vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).voice_description : undefined) || '' } as VoxCPMParams,
                        });
                      }}>VoxCPM</button>
                    </div>
                  </div>
                  <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>{t('projectVoices.voiceDescription')}
                    <textarea
                      className={styles.paramTextarea}
                      value={localDesignDesc}
                      onChange={(event) => setVoiceDescription(event.target.value)}
                      placeholder={t('projectVoices.voiceDescriptionPlaceholder')}
                      rows={3}
                    />
                  </label>
                  <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                    <span className={styles.paramLabel}>{t('projectVoices.sampleText')}</span>
                    <p style={{ margin: '0.25rem 0 0', padding: '0.5rem 0.75rem', background: 'var(--color-bg-secondary, #f7f7f8)', borderRadius: '6px', fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--color-text-secondary, #6b7280)' }}>
                      {t('projectVoices.auditionSampleText')}
                    </p>
                    <span className={styles.configHint}>{t('projectVoices.sampleTextHint')}</span>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        <aside className={styles.previewCard}>
          <span className={styles.kicker}>Real-time Preview</span>
          <h4>Studio Playback</h4>
          <p>"{t('projectVoices.auditionSampleText')}"</p>
          <div className={styles.waveform} aria-hidden="true"><i /><i /><i /><i /><i /></div>

          {isDesignMode ? (
            <div className={styles.designFlow}>
              {designError && <p className={styles.designError}>{designError}</p>}
              {designPhase === 'idle' && (
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={handleDesignPreview}
                  disabled={!localDesignDesc.trim()}
                >
                  {t('projectVoices.previewVoice')}
                </button>
              )}
              {designPhase === 'previewing' && (
                <button type="button" className={styles.ghostButton} disabled>{t('common.generating')}</button>
              )}
              {designPhase === 'previewed' && (
                <>
                  <p className={styles.designHint}>{t('projectVoices.previewedConfirmHint')}</p>
                  <div className={styles.designActions}>
                    <button type="button" className={styles.ghostButton} onClick={handleDesignPreview}>{t('common.regenerate')}</button>
                    <button type="button" className={styles.primaryButton} onClick={handleDesignConfirmSave}>{t('projectVoices.confirmSaveVoice')}</button>
                  </div>
                </>
              )}
              {designPhase === 'saving' && (
                <button type="button" className={styles.ghostButton} disabled>{t('common.saving')}</button>
              )}
              {designPhase === 'confirmed' && (
                <>
                  <p className={styles.designHint}>{designProfileId ? t('projectVoices.voiceSaved') : t('projectVoices.voiceStagedSaveRole')}</p>
                  <div className={styles.designActions}>
                    <button type="button" className={styles.ghostButton} onClick={() => { setDesignProfileId(''); setDesignPhase('idle'); setDesignAudioBase64(''); setDesignAudioSrc(''); }}>{t('projectVoices.redesign')}</button>
                  </div>
                </>
              )}
              {(designAudioSrc || clonePreviewAudioSrc) && (designPhase === 'previewed' || designPhase === 'confirmed') && (
                <audio controls className={styles.designAudioPlayer} src={designAudioSrc || clonePreviewAudioSrc} />
              )}
            </div>
          ) : (
            <>
              {clonePreviewing ? (
                <div style={{ marginBottom: '0.75rem' }}>
                  <span className={styles.paramLabel}>{t('projectVoices.clonePreviewVoice')}</span>
                  <p className={styles.designHint}>{t('projectVoices.generatingPreviewAudio')}</p>
                </div>
              ) : clonePreviewAudioSrc ? (
                <div style={{ marginBottom: '0.75rem' }}>
                  <span className={styles.paramLabel}>{t('projectVoices.clonePreviewVoice')}</span>
                  <audio controls style={{ width: '100%', marginTop: '0.25rem' }} src={clonePreviewAudioSrc} />
                </div>
              ) : null}
              {clonePreviewError && (
                <p className={styles.designHint} style={{ color: '#d32f2f' }}>{clonePreviewError}</p>
              )}
              <button type="button" className={styles.ghostButton} disabled={clonePreviewing} onClick={handleClonePreview}>{clonePreviewing ? t('common.generating') : t('projectVoices.generatePreview')}</button>
            </>
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
  const { t } = useTranslation();
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
      aria-label={t('projectVoices.editRole', { name: role.name })}
      onClick={onEdit}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); } }}
    >
      <VoiceAvatar
        avatar={role.avatar}
        name={role.name}
        engine={role.voice?.engine}
        size={36}
      />

      <div className={styles.cardBody}>
        <strong className={styles.charName}>
          {role.name}
          {isDefault && <span className={styles.defaultBadge}>{t('common.default')}</span>}
        </strong>
        <div className={styles.chipRow}>
          <span className={`${styles.chip} ${styles.chipCast}`}>{t('projectVoices.role')}</span>
          <span className={`${styles.chip} ${styles.chipEngine}`}>{engineLabel(role)}</span>
          <span className={`${styles.chip} ${styles.chipEngine}`}>{roleVoiceDisplayName(role) || t('projectVoices.notSet')}</span>
          <span className={styles.chip} title={configured ? t('projectVoices.voiceConfigured') : t('projectVoices.voiceNotConfigured')}>
            <span className={`${styles.statusDot} ${configured ? styles.statusReady : styles.statusDraft}`} />
          </span>
        </div>
      </div>

      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.ghostButton}
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
        >{t('common.preview')}</button>
        {onDelete && (
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t('projectVoices.deleteRole', { name: role.name })}
            title={t('projectVoices.deleteRoleTitle')}
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
  const { t } = useTranslation();
  const [editingRole, setEditingRole] = useState<RoleSnapshot | null>(null);
  const [engineFilter, setEngineFilter] = useState<EngineFilter>('all');

  const filterByEngine = (list: Role[]) =>
    engineFilter === 'all' ? list : list.filter(r => r.voice?.engine === engineFilter);

  const roleSample = t('projectVoices.roleSampleText');
  const filteredRoles = filterByEngine(roles);

  const [saving, setSaving] = useState(false);

  /** 试听角色：按 voice_id 查询已保存的音频，找不到再实时合成 */
  const handleCardPreview = useCallback(async (role: Role) => {
    const v = role.voice;
    let voiceId = '';
    if (v) {
      if (v.engine === 'mimo_tts') voiceId = (v as { voice_id?: string }).voice_id ?? '';
      else if (v.engine === 'edge_tts') voiceId = (v as EdgeTTSParams).voice_id ?? '';
      else if (v.engine === 'cosyvoice' || v.engine === 'voxcpm') voiceId = (v as { voice_id?: string }).voice_id ?? '';
    }
    if (voiceId) {
      try {
        const list = await ttsApi.getVoices({ voice_id: voiceId });
        const profile = list[0];
        if (profile?.has_preview) {
          const audio = new Audio(voicePreviewAudioUrl(profile.id));
          audio.play().catch(() => {});
          return;
        }
      } catch { /* fall through to live synthesis */ }
    }
    onPreviewRole(roleToSnapshot(role), roleSample);
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
          <h2>{t('projectVoices.roleManagement')}</h2>
          <p className={styles.headerDesc}>{t('projectVoices.roleManagementDesc')}</p>
        </div>
        <div className={styles.filterBar}>
          <select
            className={styles.filterSelect}
            value={engineFilter}
            onChange={(e) => setEngineFilter(e.target.value as EngineFilter)}
          >
            <option value="all">{t('projectVoices.allEngines')}</option>
            <option value="edge_tts">Edge-TTS</option>
            <option value="cosyvoice">CosyVoice</option>
            <option value="mimo_tts">MiMo</option>
            <option value="voxcpm">VoxCPM</option>
          </select>
          <button type="button" className={styles.ghostButton} onClick={onManageRoles}>{t('projectVoices.roleLibrary')}</button>
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
              <strong>{t('projectVoices.noRolesYet')}</strong>
              <p>{t('projectVoices.noRolesDesc')}</p>
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
            <span className={styles.placeholderLabel}>{t('projectVoices.createRole')}</span>
          </button>
        </div>
      </section>
    </section>
  );
}
