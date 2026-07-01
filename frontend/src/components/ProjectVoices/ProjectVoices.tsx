import { useEffect, useState, useCallback, useRef } from 'react';
import type { Role, RoleSnapshot, EngineParams, EdgeTTSParams, MiMoParams, CosyVoiceParams, VoxCPMParams, VoiceProfile } from '../../types';
import { ttsApi, voiceApi, mimoTtsApi, voxcpmApi } from '../../services/api';
import { fetchVoiceRolePreview, synthesizeVoiceRolePreview } from '../../services/voiceRolePreview';
import { useVoiceRefresh } from '../../hooks/useVoiceRefresh';
import { DEFAULT_EDGE_CAST_VOICE, DEFAULT_EDGE_NARRATOR_VOICE } from '../../services/voiceRoleDefaults';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import { ImageUploadZone } from '../ui/ImageUploadZone';
import { StyleInstructionPicker } from '../TTSSynthesis/StyleInstructionPicker';
import { AudioRecorder, AudioUploader, AudioPreview, UrlInput } from '../VoiceClone';
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
    name: '新角色',
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

const VOICE_SOURCE_TABS: { value: VoiceSourceCategory; label: string; desc: string }[] = [
  { value: 'preset', label: '模型预制音色', desc: 'Edge-TTS / MiMo 系统音色' },
  { value: 'clone', label: '克隆音色', desc: 'CosyVoice / MiMo / VoxCPM 克隆' },
  { value: 'design', label: '设计新音色', desc: 'MiMo / VoxCPM 文本描述设计' },
];

/** 判断当前 draft 属于哪个音色来源分类 */
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const vox = draft.voice;
  const [edgeVoices, setEdgeVoices] = useState<{ short_name: string; display_name: string; gender: string }[]>(COMMON_EDGE_VOICES);
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

  const voiceDescription: string = designSubEngine === 'mimo'
    ? ((vox?.engine === 'mimo_tts' ? (vox as MiMoParams).voice_description : undefined) ?? '')
    : ((vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).voice_description : undefined) ?? '');

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
        ? ((vox?.engine === 'mimo_tts' ? (vox as MiMoParams).instruction : undefined) ?? '')
        : ((vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).style_control : undefined) ?? '');
      const auditionText = '这是一段角色试听文本，用来确认音色、节奏和情绪是否适合当前项目。';
      const profile = await voiceApi.createFromDesign({
        audio_base64: audioBase64,
        engine,
        name: draft.name,
        description: voiceDescription,
        project_id: projectId,
        voice_description: voiceDescription,
        instruction,
        preview_text: auditionText,
        original_prompt_text: voiceDescription,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, designAudioBase64, designAudioSrc, designSubEngine, voiceDescription, projectId]);

  useEffect(() => {
    ttsApi.getEdgeVoices('Chinese').then(setEdgeVoices).catch(() => {});
  }, []);

  // 当已保存的角色有 clone voice id 时，按 ID 查询对应的 VoiceProfile
  // 从 engine 还原 UI 状态（音色来源分类、引擎、参数）
  const voiceEngineAppliedRef = useRef(false);
  useEffect(() => {
    const voiceId = (vox?.engine === 'mimo_tts' ? (vox as MiMoParams).voice_id : vox?.engine === 'cosyvoice' ? (vox as CosyVoiceParams).voice_id : vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).voice_id : '') || '';
    if (!voiceId) { setClonePreviewAudioSrc(''); setCloneOriginalAudioSrc(''); setCloneVoiceDescription(''); setClonePromptText(''); return; }
    let cancelled = false;
    ttsApi.getVoices({ voice_id: voiceId }).then(list => {
      if (cancelled) return;
      const profile = list[0];
      if (!profile) { setClonePreviewAudioSrc(''); setCloneOriginalAudioSrc(''); setCloneVoiceDescription(''); setClonePromptText(''); return; }
      const previewSrc = profile.preview_audio_url || profile.audio_url || '';
      setClonePreviewAudioSrc(previewSrc);
      if (previewSrc) setClonePreviewStatus('done');
      setCloneOriginalAudioSrc(profile.source_audio_url ?? '');
      setCloneVoiceDescription(profile.description ?? '');
      setClonePromptText((profile.description ?? '').slice(0, 100));

      const vv = profile.voice;
      if (!vv || voiceEngineAppliedRef.current) return;
      voiceEngineAppliedRef.current = true;

      const model = vv.model || '';
      if (model === 'cosyvoice') {
        setVoiceCategory('clone');
        setCloneSubEngine('cosyvoice');
      } else if (model === 'mimo_tts') {
        setVoiceCategory('clone');
        setCloneSubEngine('mimo');
      } else if (model === 'voxcpm') {
        setVoiceCategory('clone');
        setCloneSubEngine('voxcpm');
      } else if (model === 'edge_tts') {
        setVoiceCategory('preset');
      } else {
        setVoiceCategory('preset');
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
        voice = { engine: 'mimo_tts', mode: existing?.mode || 'preset', voice_id: existing?.voice_id || '冰糖', instruction: existing?.instruction, voice_description: existing?.voice_description } as MiMoParams;
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
      setDesignSubEngine(eng === 'voxcpm' ? 'voxcpm' : 'mimo');
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
          setClonePreviewError(err instanceof Error ? err.message : '试听音频生成失败');
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
      if (!saveResult.preview_audio_path) throw new Error('后端未返回试听文件路径');
      setClonePreviewAudioSrc(`data:audio/${format};base64,${base64}`);
    } catch (err) {
      console.warn('Failed to generate/save clone preview:', err);
      throw err;
    }
  };

  const SAMPLE_TEXT = '这是一段角色试听文本，用来确认音色、节奏和情绪是否适合当前项目。';

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
      if (!resp.ok) throw new Error(`获取音频失败: ${resp.status}`);
      const blob = await resp.blob();
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return { base64: btoa(binary), format };
    }
    throw new Error('合成未返回音频');
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

      // Save to cloned_preview_path (skip if voice not yet persisted)
      const voiceId = (vox?.engine === 'mimo_tts' ? (vox as MiMoParams).voice_id : vox?.engine === 'cosyvoice' ? (vox as CosyVoiceParams).voice_id : vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).voice_id : '') || '';
      if (voiceId) {
        const saveResult = await voiceApi.savePreviewAudio(voiceId, base64, format);
        if (!saveResult.preview_audio_path) throw new Error('后端未返回试听文件路径');
      }
      setClonePreviewAudioSrc(src);
      setClonePreviewStatus('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '试听失败';
      setClonePreviewError(msg);
      setClonePreviewStatus('error');
    } finally {
      setClonePreviewing(false);
    }
  }, [draft, draft.voice]);

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
              let profileId: string | null = designProfileId;
              if (!profileId) {
                if (!designAudioBase64 && !designAudioSrc) {
                  setDesignError('请先试听音色，再保存角色');
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
                const profile = await voiceApi.createFromDesign({
                  audio_base64: base64,
                  engine: 'preset',
                  name: draft.name,
                  description: draft.description || '',
                  project_id: projectId,
                  preview_text: SAMPLE_TEXT,
                  instruction: (draft.voice?.engine === 'mimo_tts' ? (draft.voice as MiMoParams).instruction : undefined) || '',
                });
                // MiMo 预置音色：转为 voiceclone 模式使用 VoiceProfile 参考音频
                // Edge-TTS：保持 edge_tts 引擎，VoiceProfile 仅存储音频文件
                const v = draft.voice;
                let savedVoice: EngineParams;
                if (v?.engine === 'mimo_tts' && (v as MiMoParams).mode === 'preset') {
                  savedVoice = { ...v, mode: 'voiceclone' as const, voice_id: profile.id } as MiMoParams;
                } else {
                  savedVoice = (v?.engine === 'edge_tts' ? v : { engine: 'edge_tts' as const, voice: DEFAULT_EDGE_CAST_VOICE, rate: '+0%', volume: '+0%' }) as EdgeTTSParams;
                }
                onSave({ ...draft, voice: savedVoice });
              } catch (err) {
                setDesignError(err instanceof Error ? err.message : '预置音色保存失败');
              }
              return;
            }
            // Clone mode: verify preview audio was saved
            if (voiceCategory === 'clone') {
              if (clonePreviewStatus === 'generating') {
                setClonePreviewError('请等待试听音频生成完成');
                return;
              }
              if (clonePreviewStatus === 'error' || !clonePreviewAudioSrc) {
                setClonePreviewError('试听音频尚未生成，请先点击「生成试听」');
                return;
              }
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
                      <button type="button" className={`${styles.enginePill} ${vox?.engine === 'edge_tts' ? styles.enginePillActive : ''}`} onClick={() => setEngine('edge_tts')}>Edge-TTS</button>
                      <button type="button" className={`${styles.enginePill} ${vox?.engine === 'mimo_tts' ? styles.enginePillActive : ''}`} onClick={() => setEngine('mimo_tts')}>MiMo</button>
                    </div>
                  </div>

                  {/* Edge-TTS 预制 */}
                  {vox?.engine === 'edge_tts' && (
                    <>
                      <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>音色
                        <select className={styles.paramSelect} value={(vox as EdgeTTSParams).voice ?? ''} onChange={(event) => setParams({ edge_voice: event.target.value })}>
                          {(vox as EdgeTTSParams).voice && <option value={(vox as EdgeTTSParams).voice}>{(vox as EdgeTTSParams).voice}</option>}
                          {edgeVoices.map(v => (
                            <option key={v.short_name} value={v.short_name}>
                              {v.display_name} ({v.gender === 'Female' ? '女' : '男'})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.paramField}>语速
                        <select className={styles.paramSelect} value={(vox as EdgeTTSParams).rate ?? '+0%'} onChange={(event) => setParams({ edge_rate: event.target.value })}>
                          {['-50%', '-30%', '-20%', '-10%', '+0%', '+10%', '+20%', '+30%', '+50%', '+80%', '+100%'].map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </label>
                      <label className={styles.paramField}>音量
                        <select className={styles.paramSelect} value={(vox as EdgeTTSParams).volume ?? '+0%'} onChange={(event) => setParams({ edge_volume: event.target.value })}>
                          {['-50%', '-30%', '-20%', '-10%', '+0%', '+10%', '+20%', '+30%', '+50%', '+80%', '+100%'].map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </label>
                    </>
                  )}

                  {/* MiMo 预制 */}
                  {vox?.engine === 'mimo_tts' && (
                    <>
                      <label className={styles.paramField} style={{ gridColumn: '1 / -1' }}>预置音色
                        <select className={styles.paramSelect} value={(vox as MiMoParams).voice_id ?? ''} onChange={(event) => setParams({ mimo_preset_voice: event.target.value })}>
                          {MIMO_PRESET_VOICES.map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                      </label>
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <StyleInstructionPicker value={(vox as MiMoParams).instruction ?? ''} onChange={(value) => setParams({ mimo_instruction: value })} label="风格指令" placeholder="选择预设或直接输入..." dense />
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
                            <span className={styles.paramLabel}>原始音频</span>
                            <audio controls style={{ width: '100%', marginTop: '0.25rem' }} src={cloneOriginalAudioSrc} />
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                              <button type="button" className={styles.ghostButton} onClick={() => setCloneOriginalAudioSrc('')}>重新输入 URL</button>
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

                      <label className={styles.paramField}>语速
                        <input className={styles.range} aria-label="语速" type="range" min={0.5} max={2} step={0.01} value={(vox as CosyVoiceParams).speed ?? 1} onChange={(event) => setParams({ speed: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{((vox as CosyVoiceParams).speed ?? 1).toFixed(2)}×</span>
                      </label>
                      <label className={styles.paramField}>音量
                        <input className={styles.range} aria-label="音量" type="range" min={0} max={100} value={(vox as CosyVoiceParams).volume ?? 80} onChange={(event) => setParams({ volume: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{(vox as CosyVoiceParams).volume ?? 80}</span>
                      </label>
                      <label className={styles.paramField}>音高
                        <input className={styles.range} aria-label="音高" type="range" min={0.5} max={2} step={0.01} value={(vox as CosyVoiceParams).pitch ?? 1} onChange={(event) => setParams({ pitch: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{((vox as CosyVoiceParams).pitch ?? 1).toFixed(2)}</span>
                      </label>
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <StyleInstructionPicker value={(vox as CosyVoiceParams).instruction ?? ''} onChange={(value) => setParams({ instruction: value })} label="风格指令" placeholder="选择预设或直接输入..." dense />
                      </div>
                      <label className={styles.paramField}>语言
                        <select className={styles.paramSelect} value={(vox as CosyVoiceParams).language || 'Chinese'} onChange={(event) => setParams({ language: event.target.value })}>
                          <option value="Chinese">中文</option>
                          <option value="English">English</option>
                          <option value="Japanese">日本語</option>
                          <option value="Korean">한국어</option>
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
                              {m === 'record' ? '录制' : '上传'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {cloneInputMethod === 'record' && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          {cloneOriginalAudioSrc && !clonePendingFile ? (
                            <div style={{ padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                              <span className={styles.paramLabel}>原始录音</span>
                              <audio controls style={{ width: '100%', marginTop: '0.25rem' }} src={cloneOriginalAudioSrc} />
                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <button type="button" className={styles.ghostButton} onClick={() => setCloneOriginalAudioSrc('')}>重新录制</button>
                                <button type="button" className={styles.ghostButton} onClick={() => { setCloneInputMethod('upload'); setCloneOriginalAudioSrc(''); }}>重新上传</button>
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
                              <span className={styles.paramLabel}>原始录音</span>
                              <audio controls style={{ width: '100%', marginTop: '0.25rem' }} src={cloneOriginalAudioSrc} />
                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <button type="button" className={styles.ghostButton} onClick={() => { setCloneInputMethod('record'); setCloneOriginalAudioSrc(''); }}>重新录制</button>
                                <button type="button" className={styles.ghostButton} onClick={() => setCloneOriginalAudioSrc('')}>重新上传</button>
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
                          <span className={styles.paramLabel}>音色描述（设计来源）</span>
                          <p className={styles.configHint} style={{ marginTop: '0.25rem' }}>{(vox?.engine === 'mimo_tts' ? (vox as MiMoParams).voice_description : undefined) || cloneVoiceDescription}</p>
                        </div>
                      )}
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <StyleInstructionPicker value={(vox?.engine === 'mimo_tts' ? (vox as MiMoParams).instruction : undefined) ?? ''} onChange={(value) => setParams({ mimo_instruction: value })} label="风格指令" placeholder="选择预设或直接输入..." dense />
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
                      <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                        <div className={styles.enginePills} style={{ marginBottom: '0.5rem' }}>
                          {(['record', 'upload'] as const).map(m => (
                            <button key={m} type="button"
                              className={`${styles.enginePill} ${cloneInputMethod === m ? styles.enginePillActive : ''}`}
                              onClick={() => { setCloneInputMethod(m); setClonePendingFile(null); }}>
                              {m === 'record' ? '录制' : '上传'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {cloneInputMethod === 'record' && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          {cloneOriginalAudioSrc && !clonePendingFile ? (
                            <div style={{ padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                              <span className={styles.paramLabel}>原始录音</span>
                              <audio controls style={{ width: '100%', marginTop: '0.25rem' }} src={cloneOriginalAudioSrc} />
                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <button type="button" className={styles.ghostButton} onClick={() => setCloneOriginalAudioSrc('')}>重新录制</button>
                                <button type="button" className={styles.ghostButton} onClick={() => { setCloneInputMethod('upload'); setCloneOriginalAudioSrc(''); }}>重新上传</button>
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
                              <span className={styles.paramLabel}>原始录音</span>
                              <audio controls style={{ width: '100%', marginTop: '0.25rem' }} src={cloneOriginalAudioSrc} />
                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <button type="button" className={styles.ghostButton} onClick={() => { setCloneInputMethod('record'); setCloneOriginalAudioSrc(''); }}>重新录制</button>
                                <button type="button" className={styles.ghostButton} onClick={() => setCloneOriginalAudioSrc('')}>重新上传</button>
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
                          <span className={styles.paramLabel}>音色描述（设计来源）</span>
                          <p className={styles.configHint} style={{ marginTop: '0.25rem' }}>{(vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).voice_description : undefined) || cloneVoiceDescription}</p>
                        </div>
                      )}
                      {voxcpmCloneMode === 'clone' && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <StyleInstructionPicker value={(vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).style_control : undefined) ?? ''} onChange={(value) => setParams({ voxcpm_style_control: value })} label="风格指令" placeholder="选择预设或直接输入..." dense />
                        </div>
                      )}
                      {voxcpmCloneMode === 'ultimate' && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <span className={styles.paramLabel}>参考音频文本</span>
                          {clonePromptText ? (
                            <span className={styles.configHint} style={{ display: 'block', marginTop: '0.25rem' }}>{clonePromptText}</span>
                          ) : (
                            <span style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.8rem', display: 'block', marginTop: '0.25rem' }}>⚠ 该声音未填写参考音频文本，极致克隆无法使用</span>
                          )}
                        </div>
                      )}
                      <label className={styles.paramField}>CFG 强度
                        <input className={styles.range} aria-label="CFG 强度" type="range" min={1} max={5} step={0.1} value={(vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).cfg_value : undefined) ?? 2} onChange={(event) => setParams({ voxcpm_cfg_value: Number(event.target.value) })} />
                        <span className={styles.sliderVal}>{((vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).cfg_value : undefined) ?? 2).toFixed(1)}</span>
                      </label>
                      <label className={styles.paramField}>去噪步数
                        <input className={styles.range} aria-label="去噪步数" type="range" min={1} max={50} step={1} value={(vox?.engine === 'voxcpm' ? (vox as VoxCPMParams).inference_timesteps : undefined) ?? 10} onChange={(event) => setParams({ voxcpm_inference_timesteps: Number(event.target.value) })} />
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
            <>
              {clonePreviewing ? (
                <div style={{ marginBottom: '0.75rem' }}>
                  <span className={styles.paramLabel}>克隆试听音色</span>
                  <p className={styles.designHint}>正在生成试听音频...</p>
                </div>
              ) : clonePreviewAudioSrc ? (
                <div style={{ marginBottom: '0.75rem' }}>
                  <span className={styles.paramLabel}>克隆试听音色</span>
                  <audio controls style={{ width: '100%', marginTop: '0.25rem' }} src={clonePreviewAudioSrc} />
                </div>
              ) : null}
              {clonePreviewError && (
                <p className={styles.designHint} style={{ color: '#d32f2f' }}>{clonePreviewError}</p>
              )}
              <button type="button" className={styles.ghostButton} disabled={clonePreviewing} onClick={handleClonePreview}>{clonePreviewing ? '生成中...' : '生成试听'}</button>
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
        engine={role.voice?.engine}
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
          <span className={`${styles.chip} ${styles.chipEngine}`}>{roleVoiceDisplayName(role) || '未设置'}</span>
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
    engineFilter === 'all' ? list : list.filter(r => r.voice?.engine === engineFilter);

  const filteredRoles = filterByEngine(roles);

  const [saving, setSaving] = useState(false);

  /** 试听角色：按 voice_id 查询已保存的音频，找不到再实时合成 */
  const handleCardPreview = useCallback(async (role: Role) => {
    const v = role.voice;
    let voiceId = '';
    if (v) {
      if (v.engine === 'mimo_tts') voiceId = (v as { voice_id?: string }).voice_id ?? '';
      else if (v.engine === 'cosyvoice' || v.engine === 'voxcpm') voiceId = (v as { voice_id?: string }).voice_id ?? '';
    }
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
