import { useEffect, useState, useCallback, useRef } from 'react';
import type { Role, RoleSnapshot, SegmentEngineParams, VoiceProfile } from '../../types';
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
    default_engine: role.default_engine,
    default_voice: role.default_voice,
    default_engine_params: { ...role.default_engine_params },
    favorite_styles: [...role.favorite_styles],
  };
}

function engineLabel(role: Role): string {
  return ENGINE_META[role.default_engine as EngineKey]?.label ?? role.default_engine;
}

function inputMethodLabel(role: Role): string {
  const method = role.default_engine_params?.input_method as string | undefined;
  if (method === 'record') return '录制';
  if (method === 'upload') return '上传';
  if (method === 'url') return 'URL';
  return '';
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
  const engine = draft.default_engine;
  const p = draft.default_engine_params;
  let params: SegmentEngineParams;
  let defaultVoice: string;

  if (engine === 'edge_tts') {
    params = { engine: 'edge_tts', edge_voice: p.edge_voice ?? '', edge_rate: p.edge_rate ?? '+0%', edge_volume: p.edge_volume ?? '+0%' };
    defaultVoice = params.edge_voice ?? '';
  } else if (engine === 'cosyvoice') {
    params = { engine: 'cosyvoice', voice_id: p.voice_id ?? '', speed: p.speed ?? 1, volume: p.volume ?? 80, pitch: p.pitch ?? 1, language: p.language || 'Chinese', instruction: p.instruction || '' };
    defaultVoice = params.voice_id ?? '';
  } else if (engine === 'mimo_tts') {
    const mode = p.mimo_mode || 'preset';
    if (mode === 'voicedesign') {
      params = { engine: 'mimo_tts', mimo_mode: 'voicedesign', mimo_clone_voice_id: p.mimo_clone_voice_id || '', mimo_voice_description: p.mimo_voice_description || '', mimo_instruction: p.mimo_instruction || '' };
      defaultVoice = params.mimo_voice_description ?? '';
    } else if (mode === 'voiceclone') {
      params = { engine: 'mimo_tts', mimo_mode: 'voiceclone', mimo_clone_voice_id: p.mimo_clone_voice_id || '', mimo_instruction: p.mimo_instruction || '' };
      defaultVoice = params.mimo_clone_voice_id ?? '';
    } else {
      params = { engine: 'mimo_tts', mimo_mode: 'preset', mimo_preset_voice: p.mimo_preset_voice || '冰糖', mimo_instruction: p.mimo_instruction || '' };
      defaultVoice = params.mimo_preset_voice ?? '';
    }
  } else {
    // voxcpm
    const mode = p.voxcpm_mode || 'clone';
    if (mode === 'design') {
      params = { engine: 'voxcpm', voxcpm_mode: 'design', voice_id: p.voice_id || '', voxcpm_voice_description: p.voxcpm_voice_description || '', voxcpm_cfg_value: p.voxcpm_cfg_value ?? 2, voxcpm_inference_timesteps: p.voxcpm_inference_timesteps ?? 10 };
      defaultVoice = params.voxcpm_voice_description ?? '';
    } else {
      // clone / ultimate
      params = { engine: 'voxcpm', voxcpm_mode: mode as 'clone' | 'ultimate', voice_id: p.voice_id || '', voxcpm_style_control: p.voxcpm_style_control || '', voxcpm_cfg_value: p.voxcpm_cfg_value ?? 2, voxcpm_inference_timesteps: p.voxcpm_inference_timesteps ?? 10 };
      if (mode === 'ultimate') params.voxcpm_prompt_text = p.voxcpm_prompt_text || '';
      defaultVoice = params.voice_id ?? '';
    }
  }

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
  // @ts-expect-error TS6133 - used in JSX but TS can't detect it
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
  const params = draft.default_engine_params;
  const [edgeVoices, setEdgeVoices] = useState<{ short_name: string; display_name: string; gender: string }[]>(COMMON_EDGE_VOICES);
  const { triggerRefresh } = useVoiceRefresh();

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
  const [cloneInputMethod, setCloneInputMethod] = useState<'record' | 'upload' | 'url'>('record');
  const [clonePendingFile, setClonePendingFile] = useState<File | null>(null);

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
  const [cloneOriginalAudioSrc, setCloneOriginalAudioSrc] = useState('');
  const [cloneVoiceDescription, setCloneVoiceDescription] = useState('');
  const [clonePromptText, setClonePromptText] = useState('');
  // Clone preview generation status
  const [clonePreviewStatus, setClonePreviewStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle');
  const [clonePreviewError, setClonePreviewError] = useState('');

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
  // 从 voices_engine 还原 UI 状态（音色来源分类、引擎、参数）
  const voiceEngineAppliedRef = useRef(false);
  useEffect(() => {
    const voiceId = params.mimo_clone_voice_id || params.voice_id || '';
    if (!voiceId) { setClonePreviewAudioSrc(''); setCloneOriginalAudioSrc(''); setCloneVoiceDescription(''); setClonePromptText(''); return; }
    let cancelled = false;
    ttsApi.getVoices({ voice_id: voiceId }).then(list => {
      if (cancelled) return;
      const profile = list[0];
      if (!profile) { setClonePreviewAudioSrc(''); setCloneOriginalAudioSrc(''); setCloneVoiceDescription(''); setClonePromptText(''); return; }
      const previewSrc = profile.cloned_preview_url || profile.audio_url || '';
      setClonePreviewAudioSrc(previewSrc);
      if (previewSrc) setClonePreviewStatus('done');
      setCloneOriginalAudioSrc(profile.source_audio_url ?? '');
      setCloneVoiceDescription(profile.description ?? '');
      setClonePromptText(profile.prompt_text ?? '');

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
        const savedMethod = ve.parameters.input_method as string | undefined;
        if (savedMethod === 'upload' || savedMethod === 'url') {
          setCloneInputMethod(savedMethod as 'upload' | 'url');
        } else {
          setCloneInputMethod('record');
        }
        // 将 input_method 同步到角色 params，列表展示用
        if (savedMethod === 'record' || savedMethod === 'upload' || savedMethod === 'url') {
          setParams({ input_method: savedMethod });
        }
      }
    }).catch(() => {
      if (!cancelled) { setClonePreviewAudioSrc(''); setCloneOriginalAudioSrc(''); setCloneVoiceDescription(''); setClonePromptText(''); }
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.mimo_clone_voice_id, params.voice_id]);

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
    setCloneInputMethod('record');
    setClonePendingFile(null);
    setClonePreviewStatus('idle');
    setClonePreviewError('');
    if (cat === 'preset') {
      setEngine('edge_tts');
    } else if (cat === 'clone') {
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
        matchedVoice = sorted.find(v => v.clone_engine === 'qwen' && v.is_cloned);
        if (matchedVoice) setParams({ voice_id: matchedVoice.qwen_voice_id || matchedVoice.id });
      } else if (engine === 'mimo') {
        matchedVoice = sorted.find(v => v.is_cloned && (v.clone_engine === 'mimo' || v.clone_engine === 'voxcpm'));
        if (matchedVoice) setParams({ mimo_clone_voice_id: matchedVoice.id });
      } else {
        matchedVoice = sorted.find(v => v.clone_engine === 'voxcpm' && v.is_cloned);
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
        ttsResult = await ttsApi.synthesize({ text: previewText, engine: 'cosyvoice', voice_id: voice.qwen_voice_id || voice.id, language: 'Chinese', speed: 1, volume: 80, pitch: 1, format: 'mp3' });
      } else if (engine === 'mimo') {
        ttsResult = await mimoTtsApi.synthesizeVoiceClone({ text: previewText, voice_id: voice.id, format: 'wav' });
      } else {
        const voxcpmMode = voice.voices_engine?.parameters?.voxcpm_mode as string | undefined;
        if (voxcpmMode === 'ultimate') {
          ttsResult = await voxcpmApi.ultimateClone({ text: previewText, voice_id: voice.id, prompt_text: voice.prompt_text || undefined, format: 'wav' });
        } else {
          ttsResult = await voxcpmApi.clone({ text: previewText, voice_id: voice.id, format: 'wav' });
        }
      }

      const { base64, format } = await resolveAudioBase64(ttsResult);
      const saveResult = await voiceApi.savePreviewAudio(voice.id, base64, format);
      if (!saveResult.cloned_preview_path) throw new Error('后端未返回试听文件路径');
      setClonePreviewAudioSrc(`data:audio/${format};base64,${base64}`);
    } catch (err) {
      console.warn('Failed to generate/save clone preview:', err);
      throw err;
    }
  };

  const SAMPLE_TEXT = '这是一段角色试听文本，用来确认音色、节奏和情绪是否适合当前项目。';

  /** 从当前 draft 提取引擎参数，用于克隆时写入 VoiceProfile.engine_params */
  const cloneEngineParams = (engine: 'cosyvoice' | 'mimo' | 'voxcpm'): Record<string, unknown> => {
    const p = draft.default_engine_params;
    if (engine === 'cosyvoice') return { speed: p.speed ?? 1, volume: p.volume ?? 80, pitch: p.pitch ?? 1, language: p.language || 'Chinese', instruction: p.instruction || '', input_method: cloneInputMethod };
    if (engine === 'mimo') return { mimo_mode: 'voiceclone', mimo_instruction: p.mimo_instruction || '', input_method: cloneInputMethod };
    return { voxcpm_mode: voxcpmCloneMode, voxcpm_style_control: p.voxcpm_style_control || '', cfg_value: p.voxcpm_cfg_value ?? 2, inference_timesteps: p.voxcpm_inference_timesteps ?? 10, input_method: cloneInputMethod };
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
      const voiceId = params.mimo_clone_voice_id || params.voice_id || '';
      if (voiceId) {
        const saveResult = await voiceApi.savePreviewAudio(voiceId, base64, format);
        if (!saveResult.cloned_preview_path) throw new Error('后端未返回试听文件路径');
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
  }, [draft, params.mimo_clone_voice_id, params.voice_id]);

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
              // voice_id / mimo_clone_voice_id 存储 design VoiceProfile 的 ID，用于查找参考音频
              const updatedParams: SegmentEngineParams = designSubEngine === 'mimo'
                ? { ...params, engine: 'mimo_tts', mimo_mode: 'voicedesign', mimo_clone_voice_id: profileId }
                : { ...params, engine: 'voxcpm', voxcpm_mode: 'design', voice_id: profileId };
              const updatedDraft = { ...draft, default_engine: updatedParams.engine, default_engine_params: updatedParams };
              onSave(normalizeDraftForSave(updatedDraft));
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
                  instruction: params.mimo_instruction || '',
                });
                // MiMo 预置音色：转为 voiceclone 模式使用 VoiceProfile 参考音频
                // Edge-TTS：保持 edge_tts 引擎，VoiceProfile 仅存储音频文件
                let updatedParams: SegmentEngineParams;
                if (params.mimo_preset_voice) {
                  updatedParams = { ...params, engine: 'mimo_tts', mimo_mode: 'voiceclone', mimo_clone_voice_id: profile.id };
                } else {
                  updatedParams = { ...params, voice_id: profile.id };
                }
                onSave({ ...draft, default_engine: updatedParams.engine, default_engine_params: updatedParams });
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
                      <button type="button" className={`${styles.enginePill} ${cloneSubEngine === 'cosyvoice' ? styles.enginePillActive : ''}`} onClick={() => { setCloneSubEngine('cosyvoice'); setEngine('cosyvoice'); setCloneInputMethod('record'); setClonePendingFile(null); }}>CosyVoice</button>
                      <button type="button" className={`${styles.enginePill} ${cloneSubEngine === 'mimo' ? styles.enginePillActive : ''}`} onClick={() => {
                        setCloneSubEngine('mimo');
                        setCloneInputMethod('record');
                        setClonePendingFile(null);
                        onChange({
                          ...draft,
                          default_engine: 'mimo_tts',
                          default_engine_params: { ...draft.default_engine_params, engine: 'mimo_tts', mimo_mode: 'voiceclone' } as SegmentEngineParams,
                        });
                      }}>MiMo</button>
                      <button type="button" className={`${styles.enginePill} ${cloneSubEngine === 'voxcpm' ? styles.enginePillActive : ''}`} onClick={() => {
                        setCloneSubEngine('voxcpm');
                        setCloneInputMethod('record');
                        setClonePendingFile(null);
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
                                setParams({ voice_id: voice.qwen_voice_id || voice.id });
                                triggerRefresh();
                              } catch { /* error handled below */ }
                              setCloneInputMethod('url');
                            }}
                            onBack={() => setCloneInputMethod('url')}
                          />
                        )}
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

                      {(params.mimo_voice_description || cloneVoiceDescription) && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <span className={styles.paramLabel}>音色描述（设计来源）</span>
                          <p className={styles.configHint} style={{ marginTop: '0.25rem' }}>{params.mimo_voice_description || cloneVoiceDescription}</p>
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
                      {(params.voxcpm_voice_description || cloneVoiceDescription) && (
                        <div className={styles.paramField} style={{ gridColumn: '1 / -1' }}>
                          <span className={styles.paramLabel}>音色描述（设计来源）</span>
                          <p className={styles.configHint} style={{ marginTop: '0.25rem' }}>{params.voxcpm_voice_description || cloneVoiceDescription}</p>
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
                          {clonePromptText ? (
                            <span className={styles.configHint} style={{ display: 'block', marginTop: '0.25rem' }}>{clonePromptText}</span>
                          ) : (
                            <span style={{ color: 'var(--color-danger, #ef4444)', fontSize: '0.8rem', display: 'block', marginTop: '0.25rem' }}>⚠ 该声音未填写参考音频文本，极致克隆无法使用</span>
                          )}
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
          {inputMethodLabel(role) && (
            <span className={`${styles.chip} ${styles.chipEngine}`}>{inputMethodLabel(role)}</span>
          )}
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
