import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { t } from '../i18n';
import { GlobalControlBar } from '../components/TTSSynthesis/GlobalControlBar';
import { EdgeTTSPanel } from '../components/TTSSynthesis/EdgeTTSPanel';
import { MiMoTTSPanel, type MiMoMode } from '../components/TTSSynthesis/MiMoTTSPanel';
import { VoxCPMPanel, type VoxCPMMode } from '../components/TTSSynthesis/VoxCPMPanel';
import { TextInputPanel } from '../components/SegmentedTTS/TextInputPanel';
import { SegmentList } from '../components/SegmentedTTS/SegmentList';
import { ExportDialog } from '../components/SegmentedTTS/ExportDialog';
import { ProjectSidebar } from '../components/SegmentedTTS/ProjectSidebar';
import { segmentedReducer, createInitialProject, getActiveChapter, migrateV1, type Action } from '../hooks/useSegmentedProject';
import { textSplitApi, ttsApi, mimoTtsApi, voxcpmApi, roleApi } from '../services/api';
import { playVoiceRolePreview } from '../services/voiceRolePreview';
import { saveTTSResult, deleteTTSResult, getTTSAudioBlob } from '../services/indexedDB';
import { trimBase64AudioSilence } from '../services/audioTrim';
import { indexedDBStorage, type SegmentedProjectStorage } from '../services/segmentedProjectStorage';
import { backendStorage } from '../services/backendSegmentedProjectStorage';
import { useSegmentedDraftSync } from '../hooks/useSegmentedDraftSync';
import { getDraft, deleteDraft, type ProjectDraftRecord } from '../services/segmentedDraftStore';
import { MigrationPrompt } from '../components/SegmentedTTS/MigrationPrompt';
import { ConflictPrompt } from '../components/SegmentedTTS/ConflictPrompt';
import { useStorageMode } from '../hooks/useStorageMode';
import { useVoiceRefresh } from '../hooks/useVoiceRefresh';
import type { TTSRequest, TTSResult, VoiceProfile, SegmentedProject, Chapter, Segment, EngineParams, Role, RoleSnapshot, SegmentKind } from '../types';
import { segEffectiveParams, segHasOverride } from '../services/segmentShims';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

import { RoleLibraryPanel } from '../components/SegmentedTTS/RoleLibraryPanel';
import { ProjectShell, type ProjectSectionId } from '../components/ProjectShell/ProjectShell';
import { ProjectLibrary } from '../components/ProjectLibrary/ProjectLibrary';
import { ProjectVoices } from '../components/ProjectVoices/ProjectVoices';
import { ProjectOverview } from '../components/ProjectOverview/ProjectOverview';
import { ProjectSettings } from '../components/ProjectSettings/ProjectSettings';
import { VoiceStudioLayout } from '../components/VoiceStudio/VoiceStudioLayout';
import { assignRoleForSplitItem, type SplitVoiceMode } from '../services/segmentKindInference';
import styles from './TTSSynthesis.module.css';

type Engine = 'cosyvoice' | 'edge_tts' | 'mimo_tts' | 'voxcpm';

/** 将角色 voice (EngineParams) 转换为 old flat 字段名，供 handleRegenerate 内部使用 */
function roleVoiceToFlatParams(voice: EngineParams | undefined): Record<string, unknown> {
  if (!voice) return {};
  switch (voice.engine) {
    case 'edge_tts':
      return { engine: 'edge_tts', edge_voice: voice.voice, edge_rate: voice.rate, edge_volume: voice.volume };
    case 'cosyvoice':
      return { engine: 'cosyvoice', voice_id: voice.voice_id, instruction: voice.instruction ?? '', speed: voice.speed ?? 1, volume: voice.volume ?? 80, pitch: voice.pitch ?? 1, language: voice.language ?? 'Chinese' };
    case 'mimo_tts': {
      const mimoMode = voice.mode;
      if (mimoMode === 'voicedesign') {
        return { engine: 'mimo_tts', mimo_mode: 'voicedesign', mimo_clone_voice_id: voice.voice_id, mimo_voice_description: voice.voice_description ?? '', mimo_instruction: voice.instruction ?? '' };
      }
      if (mimoMode === 'voiceclone') {
        return { engine: 'mimo_tts', mimo_mode: 'voiceclone', mimo_clone_voice_id: voice.voice_id, mimo_instruction: voice.instruction ?? '' };
      }
      return { engine: 'mimo_tts', mimo_mode: 'preset', mimo_preset_voice: voice.voice_id, mimo_instruction: voice.instruction ?? '' };
    }
    case 'voxcpm': {
      const voxcpmMode = voice.mode;
      if (voxcpmMode === 'tts_design') {
        return { engine: 'voxcpm', voice_id: voice.voice_id, voxcpm_mode: 'design', voxcpm_voice_description: voice.voice_description ?? '', voxcpm_style_control: voice.style_control ?? '', voxcpm_cfg_value: voice.cfg_value ?? 2, voxcpm_inference_timesteps: voice.inference_timesteps ?? 10 };
      }
      if (voxcpmMode === 'ultimate') {
        return { engine: 'voxcpm', voice_id: voice.voice_id, voxcpm_mode: 'ultimate', voxcpm_style_control: voice.style_control ?? '', voxcpm_prompt_text: voice.prompt_text ?? '', voxcpm_cfg_value: voice.cfg_value ?? 2, voxcpm_inference_timesteps: voice.inference_timesteps ?? 10 };
      }
      return { engine: 'voxcpm', voice_id: voice.voice_id, voxcpm_mode: 'clone', voxcpm_style_control: voice.style_control ?? '', voxcpm_cfg_value: voice.cfg_value ?? 2, voxcpm_inference_timesteps: voice.inference_timesteps ?? 10 };
    }
    default:
      return {};
  }
}

const SCRATCHPAD_PROJECT_ID = '__scratchpad__';

function toEdgeFormat(value: number) {
  return value >= 0 ? `+${value}%` : `${value}%`;
}

function endsWithSentencePeriod(text: string): boolean {
  return /[。．.](?:[”"』」》）)]*)\s*$/.test(text.trim());
}

function getErrorMessage(error: unknown, fallback = t('common.generationFailed')): string {
  return error instanceof Error ? error.message : String(error || fallback);
}

function createScratchpadProject(): SegmentedProject {
  const project = createInitialProject();
  const now = new Date().toISOString();
  return {
    ...project,
    id: SCRATCHPAD_PROJECT_ID,
    name: t('common.draftProject'),
    created_at: project.created_at || now,
    updated_at: project.updated_at || now,
  };
}

function sortProjectsWithScratchpad(projects: SegmentedProject[]) {
  return [...projects].sort((a, b) => {
    if (a.id === SCRATCHPAD_PROJECT_ID) return -1;
    if (b.id === SCRATCHPAD_PROJECT_ID) return 1;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export function TTSSynthesis({
  onNavigateToClone,
  initialProjectId,
  hideProjectSidebar = false,
  onBackToProjects,
}: {
  onNavigateToClone?: () => void;
  initialProjectId?: string;
  hideProjectSidebar?: boolean;
  onBackToProjects?: () => void;
}) {
  const { mode: storageMode } = useStorageMode();
  const { refreshCounter } = useVoiceRefresh();
  const initialLoadDoneRef = useRef(false);
  const lastSavedUpdatedAtRef = useRef<string | null>(null);
  const [engine, setEngine] = useState<Engine>('edge_tts');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('');
  const [params, setParams] = useState<Partial<TTSRequest>>({ language: 'Chinese', speed: 1.0, volume: 80, pitch: 1.0 });

  // Edge-TTS state
  const [edgeVoice, setEdgeVoice] = useState('');
  const [edgeRate, setEdgeRate] = useState(0);
  const [edgeVolume, setEdgeVolume] = useState(0);

  // MiMo TTS state
  const [mimoMode, setMimoMode] = useState<MiMoMode>('preset');
  const [mimoPresetVoice, setMimoPresetVoice] = useState('冰糖');
  const [mimoInstruction, setMimoInstruction] = useState('');
  const [mimoCloneVoiceId, setMimoCloneVoiceId] = useState('');

  // VoxCPM state（工作室只保留 clone/ultimate，design 在角色语音设计中提供）
  const [voxcpmMode, setVoxcpmMode] = useState<VoxCPMMode>('clone');
  const [voxcpmStyleControl, setVoxcpmStyleControl] = useState('');
  const [voxcpmPromptText, setVoxcpmPromptText] = useState('');
  const [voxcpmCfgValue, setVoxcpmCfgValue] = useState(2.0);
  const [voxcpmInferenceTimesteps, setVoxcpmInferenceTimesteps] = useState(10);

  const [voices, setVoices] = useState<VoiceProfile[]>([]);

  // Project workbench state
  const [project, setProject] = useState<SegmentedProject>(createScratchpadProject);
  const [projectList, setProjectList] = useState<SegmentedProject[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [srtDurationMode, setSrtDurationMode] = useState<'chapter' | 'global'>('chapter');
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const [playingId, setPlayingId] = useState<string | undefined>();
  const [roles, setRoles] = useState<Role[]>([]);
  const [, setPreviewingRoleId] = useState<string | null>(null);
  const [roleLibraryOpen, setRoleLibraryOpen] = useState(false);
  const [compactMode, setCompactMode] = useState(true);
  const [splitVoiceMode, setSplitVoiceMode] = useState<SplitVoiceMode>(() => project.configs?.split_voice_mode ?? 'narration');
  useEffect(() => {
    setSplitVoiceMode(project.configs?.split_voice_mode ?? 'narration');
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleSplitVoiceModeChange = useCallback((mode: SplitVoiceMode) => {
    setSplitVoiceMode(mode);
    setProject(prev => ({ ...prev, configs: { ...prev.configs, split_voice_mode: mode } }));
  }, []);
  const [projectSection, setProjectSection] = useState<ProjectSectionId>('overview');
  const [panelOpen, setPanelOpen] = useState(true);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [projectSidebarCollapsed, setProjectSidebarCollapsed] = useState(() => localStorage.getItem('narraforge.projectSidebarCollapsed') === 'true');

  // Sidebar accordion state — engine open by default, others collapsed
  const [sidebarOpen, setSidebarOpen] = useState({ voiceMode: false, engine: true });
  const [libraryFulltext, setLibraryFulltext] = useState(false);
  const toggleSidebarSection = (section: keyof typeof sidebarOpen) => {
    setSidebarOpen(prev => ({ ...prev, [section]: !prev[section] }));
  };
  const isScratchpadProject = project.id === SCRATCHPAD_PROJECT_ID;

  const [isPaused, setIsPaused] = useState(false);
  const [playAllActive, setPlayAllActive] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean; title: string; message: string;
    variant?: 'warning' | 'danger';
    confirmLabel?: string;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => undefined });

  // Derived: active chapter
  const activeChapter = useMemo(() => getActiveChapter(project)!, [project]);
  // Stable array refs for panel engine filters (avoid re-fetching voice list on every render)
  const excludeQwen = useMemo(() => ['qwen'], []);
  const allowVoxcpm = useMemo(() => ['voxcpm'], []);
  // Sum total duration of all chapters BEFORE the active one (used as time offset)
  const chapterStartOffset = useMemo(() => {
    const activeIdx = project.chapters.findIndex(c => c.id === activeChapter.id);
    if (activeIdx <= 0) return 0;
    let total = 0;
    for (let i = 0; i < activeIdx; i++) {
      for (const seg of project.chapters[i].segments) {
        if (seg.status === 'ready' && seg.audio.duration_sec) total += seg.audio.duration_sec;
      }
    }
    return total;
  }, [project.chapters, activeChapter.id]);
  // Effective offset for display: 0 for chapter-relative, chapterStartOffset for global
  const effectiveTimeOffset = srtDurationMode === 'global' ? chapterStartOffset : 0;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  // Ref to abort play-all sequence
  const playAllAbortRef = useRef(false);
  // Ref to always have the latest handleRegenerate (avoids stale closure in confirm dialog)
  const handleRegenerateRef = useRef<(id: string) => Promise<void>>(() => Promise.resolve());

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('narraforge.projectSidebarCollapsed', String(projectSidebarCollapsed));
  }, [projectSidebarCollapsed]);

  // Load scratchpad project on mount, possibly surfacing migration prompt
  useEffect(() => {
    (async () => {
      console.log(`[TTSSynthesis] load effect: storageMode=${storageMode}, initialProjectId=${initialProjectId}`);
      // scratchpad 只在前端存储模式下使用，后端模式不需要创建/保存 scratchpad
      let scratchpad: SegmentedProject | undefined;
      if (storageMode === 'frontend') {
        const rawList = await indexedDBStorage.listProjects();
        scratchpad = rawList.find(p => p.id === SCRATCHPAD_PROJECT_ID);
        if (!scratchpad) {
          scratchpad = createScratchpadProject();
          await indexedDBStorage.saveProject(scratchpad, { mode: 'immediate' });
        }
      }

      // 项目列表始终从当前存储模式获取
      const rawList = await projectStorage.listProjects();
      console.log(`[TTSSynthesis] rawList count=${rawList.length}, ids=${rawList.map(p => p.id.slice(0, 20)).join(', ')}`);

      // 项目列表：前端模式包含 scratchpad，后端模式只包含真实项目
      const filteredList = storageMode === 'frontend'
        ? [scratchpad!, ...rawList.filter(p => p.id !== SCRATCHPAD_PROJECT_ID)]
        : rawList;

      const list = sortProjectsWithScratchpad(filteredList);
      setProjectList(list);

      // 如果没有指定项目 ID，后端模式用第一个项目，前端模式用 scratchpad
      const targetProjectId = initialProjectId ?? (
        storageMode === 'frontend'
          ? SCRATCHPAD_PROJECT_ID
          : rawList.filter(p => p.id !== SCRATCHPAD_PROJECT_ID)[0]?.id
      );

      let full: SegmentedProject | undefined;
      if (targetProjectId) {
        console.log(`[TTSSynthesis] loading project: ${targetProjectId}`);
        full = await projectStorage.getProject(targetProjectId);
        console.log(`[TTSSynthesis] getProject result: ${full ? `found: ${full.name} (id=${full.id})` : 'null'}`);
      }

      // 防御性验证：确保读取的项目 ID 与请求一致
      if (full && targetProjectId && full.id !== targetProjectId) {
        console.error(`[TTSSynthesis] ID mismatch: requested ${targetProjectId}, got ${full.id} (name=${full.name})`);
        full = undefined;
      }

      // 真实项目加载失败，不静默降级到草稿
      if (!full && initialProjectId) {
        console.error(`[TTSSynthesis] Project ${initialProjectId} not found in ${storageMode} storage`);
        showToast(`项目加载失败（存储模式: ${storageMode}）`, 'error');
        onBackToProjects?.();
        return;
      }

      // 后端模式没有项目时，创建临时项目不保存；前端模式用 scratchpad
      if (!full) {
        if (storageMode === 'frontend') {
          full = scratchpad!;
        } else {
          full = createInitialProject();
          full.name = t('project.draftProject');
        }
      }
      const localDraft = await getDraft(full.id);
      console.log('[TTSSynthesis] draft check:', { projectId: full.id, hasDraft: !!localDraft, dirty: localDraft?.dirty, base_updated_at: localDraft?.base_updated_at, project_updated_at: full.updated_at });
      // 时间容差：2 秒内视为同一版本，避免亚秒级时间差误判冲突
      const isRealConflict = localDraft && localDraft.base_updated_at && localDraft.dirty
        && (new Date(full.updated_at).getTime() - new Date(localDraft.base_updated_at).getTime() > 2000);
      if (isRealConflict) {
        console.log(`[TTSSynthesis] conflict detected for ${full.id}`);
        if (full.id === SCRATCHPAD_PROJECT_ID) {
          const migratedDraft = migrateV1(localDraft.draft);
          setProject(migratedDraft);
          dispatch({ type: 'LOAD_PROJECT', project: migratedDraft });
          const ch = getActiveChapter(migratedDraft);
          if (ch) restoreChapterSettings(ch);
          return;
        }
        setConflictPrompt({ backend: full, draft: localDraft });
        return;
      }
      const migrated = migrateV1(full);
      console.log(`[TTSSynthesis] setting project: ${migrated.name} (id=${migrated.id}, chapters=${migrated.chapters?.length})`);
      initialLoadDoneRef.current = false; // 暂停自动保存，防止初始加载触发 markDirty
      setProject(migrated);
      dispatch({ type: 'LOAD_PROJECT', project: migrated });
      const ch = getActiveChapter(migrated);
      if (ch) restoreChapterSettings(ch);
      await draftSync.adoptBackendVersion(migrated);
      initialLoadDoneRef.current = true; // 初始加载完成，后续变更可触发自动保存
      lastSavedUpdatedAtRef.current = migrated.updated_at; // 跳过首次无变更的自动保存

      if (storageMode === 'backend') {
        const localProjects = await indexedDBStorage.listProjects();
        const migratableCount = localProjects.filter(p => p.id !== SCRATCHPAD_PROJECT_ID).length;
        if (migratableCount > 0) {
          setLocalCount(migratableCount);
          setShowMigration(true);
        }
      }
    })().catch((e) => {
      console.error('Project load failed:', e);
      if (initialProjectId) {
        showToast('项目加载失败，请重试', 'error');
        onBackToProjects?.();
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageMode, initialProjectId]);

  // Auto-save: debounce PUT in backend mode; IndexedDB direct in frontend mode
  useEffect(() => {
    // 初始加载期间不触发自动保存，避免 markDirty 导致误判冲突
    if (!initialLoadDoneRef.current) return;
    // 跳过纯 UI 状态变更（如 SELECT_SEGMENT 不 bump updated_at）
    if (project.updated_at === lastSavedUpdatedAtRef.current) return;
    lastSavedUpdatedAtRef.current = project.updated_at;
    if (storageMode === 'backend') {
      void draftSync.markDirty(project);
    } else {
      const t = setTimeout(async () => {
        try {
          await indexedDBStorage.saveProject(project);
        } catch (e) { console.warn('Auto-save failed:', e); }
      }, 1000);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, storageMode]);

  const dispatch = useCallback((action: Action) => {
    setProject(prev => segmentedReducer({ project: prev }, action).project);
  }, []);

  // Sync global settings to active chapter whenever they change
  useEffect(() => {
    dispatch({
      type: 'SET_CHAPTER_META',
      meta: {
        engine, voice_id: selectedVoiceId, edge_voice: edgeVoice,
        edge_rate: edgeRate, edge_volume: edgeVolume,
        mimo_mode: mimoMode, mimo_preset_voice: mimoPresetVoice,
        mimo_instruction: mimoInstruction, mimo_clone_voice_id: mimoCloneVoiceId,
        voxcpm_mode: voxcpmMode,
        voxcpm_style_control: voxcpmStyleControl, voxcpm_prompt_text: voxcpmPromptText,
        voxcpm_cfg_value: voxcpmCfgValue, voxcpm_inference_timesteps: voxcpmInferenceTimesteps,
        language: params.language, speed: params.speed,
        volume: params.volume, pitch: params.pitch, panel_open: panelOpen,
      },
    });
  }, [engine, selectedVoiceId, edgeVoice, edgeRate, edgeVolume, mimoMode, mimoPresetVoice, mimoInstruction, mimoCloneVoiceId, voxcpmMode, voxcpmStyleControl, voxcpmPromptText, voxcpmCfgValue, voxcpmInferenceTimesteps, params.language, params.speed, params.volume, params.pitch, panelOpen, dispatch]);

  const showToast = useCallback((message: string, type: 'error' | 'success' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => { ttsApi.getVoices({ project_id: project.id }).then(setVoices).catch(() => {}); }, [refreshCounter, project.id]);

  useEffect(() => {
    roleApi.listRoles()
      .then(setRoles)
      .catch((error) => console.warn('Role list failed:', error));
  }, []);

  const projectStorage: SegmentedProjectStorage = storageMode === 'backend' ? backendStorage : indexedDBStorage;
  const draftSync = useSegmentedDraftSync(project?.id ?? null, { storage: projectStorage });
  const [showMigration, setShowMigration] = useState(false);
  const [localCount, setLocalCount] = useState(0);
  const [conflict, setConflictPrompt] = useState<{ backend: SegmentedProject; draft: ProjectDraftRecord } | null>(null);

  // ---- Chapter management ----

  /** Restore global state from a chapter's saved voice */
  const restoreChapterSettings = useCallback((ch: Chapter) => {
    const v = ch.voice;
    const engine = (v?.engine || 'edge_tts') as Engine;
    setEngine(engine);
    if (engine === 'edge_tts') {
      setEdgeVoice((v as EdgeTTSParams).voice || '');
      setEdgeRate(parseFloat((v as EdgeTTSParams).rate) || 0);
      setEdgeVolume(parseFloat((v as EdgeTTSParams).volume) || 0);
    } else if (engine === 'cosyvoice') {
      setSelectedVoiceId((v as CosyVoiceParams).voice_id || '');
      setParams({ language: ((v as CosyVoiceParams).language || 'Chinese') as TTSRequest['language'], speed: (v as CosyVoiceParams).speed ?? 1.0, volume: (v as CosyVoiceParams).volume ?? 80, pitch: (v as CosyVoiceParams).pitch ?? 1.0 });
    } else if (engine === 'mimo_tts') {
      setMimoMode(((v as MiMoParams).mode || 'preset') as MiMoMode);
      setMimoPresetVoice((v as MiMoParams).voice_id || '冰糖');
      setMimoInstruction((v as MiMoParams).instruction || '');
      setMimoCloneVoiceId((v as MiMoParams).voice_id || '');
    } else if (engine === 'voxcpm') {
      setVoxcpmMode(((v as VoxCPMParams).mode || 'clone') as VoxCPMMode);
      setSelectedVoiceId((v as VoxCPMParams).voice_id || '');
      setVoxcpmStyleControl((v as VoxCPMParams).style_control || '');
      setVoxcpmPromptText((v as VoxCPMParams).prompt_text || '');
      setVoxcpmCfgValue((v as VoxCPMParams).cfg_value ?? 2.0);
      setVoxcpmInferenceTimesteps((v as VoxCPMParams).inference_timesteps ?? 10);
    }
  }, []);

  const handleSelectChapter = useCallback((chapterId: string) => {
    dispatch({ type: 'SELECT_CHAPTER', id: chapterId });
    // After dispatch, the project state will have the new active chapter
    // We need to get the chapter from the current project state
    const ch = project.chapters.find(c => c.id === chapterId);
    if (ch) restoreChapterSettings(ch);
  }, [project.chapters, dispatch, restoreChapterSettings]);

  const handleAddChapter = useCallback((requestedName?: string) => {
    const fallbackName = `新章节 ${project.chapters.length + 1}`;
    const name = requestedName?.trim() || fallbackName;
    dispatch({ type: 'ADD_CHAPTER', name });
    // New chapter inherits settings from previous active chapter, so no need to reset global state
  }, [project.chapters.length, dispatch]);

  const doDeleteChapter = useCallback(async (chapterId: string) => {
    const ch = project.chapters.find(c => c.id === chapterId);
    if (ch) {
      for (const seg of ch.segments) {
        if (seg.audio.current?.id) { try { await deleteTTSResult(seg.audio.current.id); } catch { /* ignore */ } }
        if (seg.audio.previous?.id) { try { await deleteTTSResult(seg.audio.previous.id); } catch { /* ignore */ } }
      }
    }
    dispatch({ type: 'DELETE_CHAPTER', id: chapterId });
    const remaining = project.chapters.filter(c => c.id !== chapterId);
    if (remaining.length > 0) {
      const newActive = project.active_chapter_id === chapterId ? remaining[0] : remaining.find(c => c.id === project.active_chapter_id) || remaining[0];
      restoreChapterSettings(newActive);
    }
    showToast(`已删除 ${ch?.name || '章节'}`);
  }, [project.chapters, project.active_chapter_id, dispatch, restoreChapterSettings, showToast]);

  const handleDeleteChapter = useCallback((chapterId: string) => {
    if (project.chapters.length <= 1) return;
    const ch = project.chapters.find(c => c.id === chapterId);
    const segCount = ch?.segments.length || 0;
    const audioCount = ch?.segments.filter(s => s.audio.current?.id).length || 0;
    setConfirmDialog({
      open: true, title: '删除章节',
      message: `确定删除「${ch?.name || '此章节'}」？\n包含 ${segCount} 个片段${audioCount > 0 ? `、${audioCount} 段音频` : ''}，将一并删除。`,
      variant: 'warning', confirmLabel: '删除',
      onConfirm: () => { setConfirmDialog(prev => ({ ...prev, open: false })); doDeleteChapter(chapterId); },
    });
  }, [project.chapters, doDeleteChapter]);

  // ---- Segmented mode handlers ----

  /** Build EngineParams from current global state */
  const buildCurrentParams = useCallback((): EngineParams => {
    if (engine === 'edge_tts') {
      return { engine: 'edge_tts', voice: edgeVoice, rate: toEdgeFormat(edgeRate), volume: toEdgeFormat(edgeVolume) } as EdgeTTSParams;
    }
    if (engine === 'mimo_tts') {
      return { engine: 'mimo_tts', mode: mimoMode, voice_id: mimoMode === 'preset' ? mimoPresetVoice : mimoCloneVoiceId, instruction: mimoInstruction } as MiMoParams;
    }
    if (engine === 'voxcpm') {
      return { engine: 'voxcpm', mode: voxcpmMode, voice_id: selectedVoiceId, style_control: voxcpmStyleControl, prompt_text: voxcpmPromptText, cfg_value: voxcpmCfgValue, inference_timesteps: voxcpmInferenceTimesteps } as VoxCPMParams;
    }
    return {
      engine: 'cosyvoice', voice_id: selectedVoiceId,
      instruction: params.instruction || '', speed: params.speed ?? 1.0, volume: params.volume ?? 80,
      pitch: params.pitch ?? 1.0, language: params.language || 'Chinese',
      enable_ssml: params.enable_ssml ?? false, enable_markdown_filter: params.enable_markdown_filter ?? false,
    };
  }, [engine, selectedVoiceId, params, edgeVoice, edgeRate, edgeVolume, mimoMode, mimoPresetVoice, mimoCloneVoiceId, mimoInstruction, voxcpmMode, voxcpmStyleControl, voxcpmPromptText, voxcpmCfgValue, voxcpmInferenceTimesteps]);

  // 构建当前全局音色的 VoiceRef（用于新创建的 segment）
  const buildGlobalVoiceRef = useCallback((): import('../types').VoiceRef => {
    // Edge-TTS
    if (engine === 'edge_tts') {
      const parts = (edgeVoice || '').split('-');
      const name = (parts[parts.length - 1] || edgeVoice || '').replace(/Neural$|V\d+$/i, '');
      return { name: name || '未选择', source: 'global', voice_id: edgeVoice, engine: 'edge_tts' };
    }
    // MiMo
    if (engine === 'mimo_tts') {
      if (mimoMode === 'voiceclone') {
        const vObj = voices.find(v => v.id === mimoCloneVoiceId);
        return { name: vObj?.name || '自定义音色', source: 'global', voice_id: mimoCloneVoiceId, engine: 'mimo_tts' };
      }
      return { name: mimoPresetVoice || '未选择', source: 'global', voice_id: mimoPresetVoice, engine: 'mimo_tts' };
    }
    // VoxCPM
    if (engine === 'voxcpm') {
      const vObj = voices.find(v => v.id === selectedVoiceId);
      return { name: vObj?.name || 'VoxCPM 音色', source: 'global', voice_id: selectedVoiceId, engine: 'voxcpm' };
    }
    // CosyVoice (default)
    const vObj = voices.find(v => (v.qwen_voice_id || v.id) === selectedVoiceId);
    return { name: vObj?.name || 'CosyVoice 音色', source: 'global', voice_id: selectedVoiceId, engine: 'cosyvoice' };
  }, [engine, selectedVoiceId, voices, edgeVoice, mimoMode, mimoPresetVoice, mimoCloneVoiceId]);

  const resetGlobalSettings = useCallback(() => {
    setEngine('edge_tts');
    setSelectedVoiceId('');
    setEdgeVoice('');
    setEdgeRate(0);
    setEdgeVolume(0);
    setMimoMode('preset');
    setMimoPresetVoice('冰糖');
    setMimoInstruction('');
    setMimoCloneVoiceId('');
    setVoxcpmMode('clone');
    setVoxcpmStyleControl('');
    setVoxcpmPromptText('');
    setVoxcpmCfgValue(2.0);
    setVoxcpmInferenceTimesteps(10);
    setParams({ language: 'Chinese', speed: 1.0, volume: 80, pitch: 1.0 });
    setPanelOpen(true);
  }, []);

  const loadProjectById = useCallback(async (projectId: string) => {
    const p = await projectStorage.getProject(projectId);
    if (!p) return;
    const migrated = migrateV1(p);
    initialLoadDoneRef.current = false;
    dispatch({ type: 'LOAD_PROJECT', project: migrated });
    setProject(migrated);
    setProjectSection('overview');
    const ch = getActiveChapter(migrated);
    if (ch) restoreChapterSettings(ch);
    if (storageMode === 'backend') {
      await draftSync.adoptBackendVersion(migrated);
    }
    initialLoadDoneRef.current = true;
    lastSavedUpdatedAtRef.current = migrated.updated_at;
  }, [projectStorage, dispatch, restoreChapterSettings, storageMode, draftSync]);

  const handleCreateProject = useCallback(async (name?: string, logo?: string | null) => {
    const np = createInitialProject();
    np.name = name || `新项目 ${projectList.filter(p => p.id !== SCRATCHPAD_PROJECT_ID).length + 1}`;
    if (logo) np.logo = logo;
    await projectStorage.saveProject(np, { mode: 'immediate' });
    const list = sortProjectsWithScratchpad(await projectStorage.listProjects());
    setProjectList(list);
    setProject(np);
    dispatch({ type: 'LOAD_PROJECT', project: np });
    resetGlobalSettings();
  }, [projectList, projectStorage, dispatch, resetGlobalSettings]);

  const doDeleteProject = useCallback(async (projectId: string) => {
    if (projectId === SCRATCHPAD_PROJECT_ID) {
      showToast('草稿项目不可删除', 'error');
      return;
    }

    try {
      await projectStorage.deleteProject(projectId);
      if (storageMode === 'backend') {
        await deleteDraft(projectId);
      }

      const list = sortProjectsWithScratchpad(await projectStorage.listProjects());
      setProjectList(list);

      if (project.id === projectId) {
        const nextProject = list.find(p => p.id === SCRATCHPAD_PROJECT_ID) || list[0];
        if (nextProject) {
          await loadProjectById(nextProject.id);
        } else {
          // 只有前端模式才需要创建 scratchpad，后端模式创建临时项目不保存
          const fallback = createInitialProject();
          if (storageMode === 'frontend') {
            fallback.id = SCRATCHPAD_PROJECT_ID;
            fallback.name = '草稿项目';
            await indexedDBStorage.saveProject(fallback, { mode: 'immediate' });
          } else {
            fallback.name = '临时项目';
          }
          setProjectList([fallback]);
          setProject(fallback);
          dispatch({ type: 'LOAD_PROJECT', project: fallback });
          resetGlobalSettings();
        }
      }
      showToast('项目已删除');
    } catch (e) { console.error('Delete project failed:', e); showToast('删除失败', 'error'); }
  }, [project.id, projectStorage, storageMode, loadProjectById, dispatch, resetGlobalSettings, showToast]);

  const handleDeleteProject = useCallback((projectId = project.id) => {
    if (projectId === SCRATCHPAD_PROJECT_ID) {
      showToast('草稿项目不可删除', 'error');
      return;
    }
    const target = projectList.find(p => p.id === projectId) || project;
    setConfirmDialog({
      open: true, title: '删除项目',
      message: `确定删除项目「${target.name}」？
此操作不可撤销，所有章节和音频将一并删除。`,
      variant: 'danger', confirmLabel: '删除',
      onConfirm: () => { setConfirmDialog(prev => ({ ...prev, open: false })); void doDeleteProject(projectId); },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project, projectList, doDeleteProject, showToast]);

  const handleToggleIndependentVoice = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_INDEPENDENT_VOICE', id });
  }, [dispatch]);

  const handleConfirmCustom = useCallback((id: string, localParams: Record<string, unknown>) => {
    const seg = activeChapter.segments.find(s => s.id === id);
    if (!seg) return;
    if (!window.confirm('此段将使用自定义音色，不再跟随全局/角色设置。确认？')) return;
    // Take all params from the panel display (effective + local edits)
    const eff = segEffectiveParams(seg) as Record<string, unknown>;
    const fullParams = { ...eff, ...localParams };
    dispatch({ type: 'UPDATE_PARAMS', id, params: fullParams as Partial<EngineParams>, convertFromRole: true });
    // Clear existing audio — was generated with old params
    if (seg.status === 'ready') dispatch({ type: 'CLEAR_SEGMENT_AUDIO', id });
  }, [activeChapter.segments, dispatch]);

  const handleMerge = useCallback((id: string, direction: 'up' | 'down') => {
    const segs = activeChapter.segments;
    const srcIdx = segs.findIndex(s => s.id === id);
    if (srcIdx < 0) return;
    // Normalize: always merge "prev + next" → keepIdx is the segment that survives
    const keepIdx = direction === 'down' ? srcIdx : srcIdx - 1;
    if (keepIdx < 0 || keepIdx >= segs.length - 1) return;
    const cur = segs[keepIdx];
    const nxt = segs[keepIdx + 1];
    const hasAudio = !!(cur.current_audio_id || nxt.current_audio_id);
    const doMerge = async () => {
      if (cur.current_audio_id) { try { await deleteTTSResult(cur.current_audio_id); } catch { /* ignore */ } }
      if (nxt.current_audio_id) { try { await deleteTTSResult(nxt.current_audio_id); } catch { /* ignore */ } }
      dispatch({ type: 'MERGE_SEGMENTS', id, direction });
    };
    if (hasAudio) {
      setConfirmDialog({
        open: true, title: '合并分段',
        message: `${direction === 'down' ? '向下' : '向上'}合并将删除两段的已生成音频，是否继续？`,
        variant: 'warning', confirmLabel: '继续',
        onConfirm: () => { setConfirmDialog(prev => ({ ...prev, open: false })); doMerge(); },
      });
    } else {
      doMerge();
    }
  }, [activeChapter.segments, dispatch]);

  const handleSplit = useCallback((id: string, position: number) => {
    const seg = activeChapter.segments.find(s => s.id === id);
    if (!seg) return;
    const hasAudio = !!seg.current_audio_id;
    const doSplit = async () => {
      if (seg.current_audio_id) { try { await deleteTTSResult(seg.current_audio_id); } catch { /* ignore */ } }
      dispatch({ type: 'SPLIT_SEGMENT', id, position });
    };
    if (hasAudio) {
      setConfirmDialog({
        open: true, title: '拆分分段',
        message: '拆分将删除该段的已生成音频，是否继续？',
        variant: 'warning', confirmLabel: '继续',
        onConfirm: () => { setConfirmDialog(prev => ({ ...prev, open: false })); doSplit(); },
      });
    } else {
      doSplit();
    }
  }, [activeChapter.segments, dispatch]);

  const handleDeleteSegment = useCallback((id: string) => {
    const seg = activeChapter.segments.find(s => s.id === id);
    if (!seg) return;
    const doDelete = async () => {
      if (seg.current_audio_id) { try { await deleteTTSResult(seg.current_audio_id); } catch { /* ignore */ } }
      if (seg.previous_audio_id) { try { await deleteTTSResult(seg.previous_audio_id); } catch { /* ignore */ } }
      dispatch({ type: 'DELETE_SEGMENT', id });
    };
    const preview = seg.text.length > 20 ? seg.text.slice(0, 20) + '…' : seg.text;
    const audioWarn = seg.current_audio_id ? '\n已生成的音频也将一并删除。' : '';
    setConfirmDialog({
      open: true, title: '删除分段',
      message: `确定删除该分段？\n「${preview}」${audioWarn}`,
      variant: 'danger', confirmLabel: '删除',
      onConfirm: () => { setConfirmDialog(prev => ({ ...prev, open: false })); doDelete(); },
    });
  }, [activeChapter.segments, dispatch]);

  /** Re-split: clean up existing segment audio before applying new split */
  const doApplySplit = useCallback((items: { text: string; emotion?: string; segment_kind?: SegmentKind; role_id?: string | null; role_snapshot?: RoleSnapshot | null }[], originalText: string) => {
    const oldAudioIds = activeChapter.segments
      .flatMap(s => [s.audio.current?.id, s.audio.previous?.id])
      .filter((id): id is string => !!id);

    // 构建带 voice_ref 的 items
    const globalVoiceRef = buildGlobalVoiceRef();
    const itemsWithVoiceRef = items.map(item => {
      // 如果有角色，使用角色的音色信息
      if (item.role_id && item.role_snapshot) {
        const rsv = item.role_snapshot.voice as Record<string, unknown> | undefined;
        const roleVoiceRef: import('../types').VoiceRef = {
          name: item.role_snapshot.name,
          source: 'role',
          voice_id: (rsv?.voice_id || rsv?.voice || '') as string,
          engine: (rsv?.engine || 'edge_tts') as EngineParams['engine'],
          role_id: item.role_id,
        };
        return { ...item, voice_ref: roleVoiceRef };
      }
      return { ...item, voice_ref: globalVoiceRef };
    });

    const apply = async () => {
      for (const aid of oldAudioIds) { try { await deleteTTSResult(aid); } catch { /* ignore */ } }
      dispatch({ type: 'SET_DEFAULT_PARAMS', params: buildCurrentParams() });
      dispatch({ type: 'SET_CHAPTER_META', meta: { original_text: originalText } });
      dispatch({ type: 'APPLY_SPLIT', items: itemsWithVoiceRef });
    };

    if (oldAudioIds.length > 0) {
      setConfirmDialog({
        open: true, title: '重新拆分',
        message: `重新拆分将删除当前 ${activeChapter.segments.length} 段中已生成的 ${oldAudioIds.length} 段音频，是否继续？`,
        variant: 'warning', confirmLabel: '继续',
        onConfirm: () => { setConfirmDialog(prev => ({ ...prev, open: false })); apply(); },
      });
    } else {
      apply();
    }
  }, [activeChapter.segments, dispatch, buildCurrentParams, buildGlobalVoiceRef, selectedVoiceId, edgeVoice, engine]);

  const buildSplitItemsWithRoles = useCallback((
    items: { text: string; emotion?: string }[],
    voiceMode: SplitVoiceMode,
  ) => items.map(item => ({
    ...item,
    ...assignRoleForSplitItem(item.text, voiceMode, roles),
  })), [roles]);

  const handleSaveRole = useCallback(async (draft: RoleSnapshot) => {
    try {
      const exists = roles.some(role => role.id === draft.id);
      const saved = exists
        ? await roleApi.updateRole(draft.id, draft)
        : await roleApi.createRole(draft);
      setRoles(prev => exists
        ? prev.map(role => role.id === saved.id ? saved : role)
        : [saved, ...prev.filter(role => role.id !== saved.id)]);
      showToast(exists ? '角色已更新' : '角色已创建');
    } catch (error) {
      console.error('Save role failed:', error);
      showToast('角色保存失败', 'error');
      throw error;
    }
  }, [roles, showToast]);

  const handleDeleteRole = useCallback(async (roleId: string) => {
    const target = roles.find(role => role.id === roleId);
    if (!target) return;
    try {
      // 仅从当前项目移除，不全局删除
      // 1. 清除所有引用该角色的 segment 的 role_id 和 role_snapshot
      dispatch({ type: 'CLEAR_ROLE_FROM_SEGMENTS', roleId });
      // 2. 从本地角色列表移除（不调用 roleApi.deleteRole）
      setRoles(prev => prev.filter(role => role.id !== roleId));
      showToast('角色已从项目移除');
    } catch (error) {
      console.error('Remove role from project failed:', error);
      showToast('移除角色失败', 'error');
    }
  }, [roles, dispatch, showToast]);

  const handlePreviewRole = useCallback(async (role: RoleSnapshot, sampleText: string) => {
    setPreviewingRoleId(role.id);
    try {
      await playVoiceRolePreview(role, sampleText);
    } catch (error) {
      console.error('Preview role failed:', error);
      showToast('试听失败：请检查后端 TTS 服务、模型配置和音色参数', 'error');
    } finally {
      setPreviewingRoleId(null);
    }
  }, [showToast]);

  const handleRegenerate = useCallback(async (id: string) => {
    const seg = activeChapter.segments.find(s => s.id === id);
    if (!seg) return;
    const segIdx = activeChapter.segments.findIndex(s => s.id === id);
    dispatch({ type: 'GENERATE_START', id });
    try {
      const hasVoiceLock = segHasOverride(seg);
      // Find role whenever segment has one
      const currentRole = seg.role_id ? roles.find(r => r.id === seg.role_id) : undefined;
      // Global params — build from engine state, convert EngineParams to flat for legacy resolve()
      const gp = roleVoiceToFlatParams(buildCurrentParams());
      // Role voice params — EngineParams format
      const rv = currentRole?.voice;

      // Resolve effective engine
      let effectiveEngine: Engine;
      if (rv) {
        effectiveEngine = (rv.engine || gp.engine) as Engine;
      } else if (hasVoiceLock) {
        effectiveEngine = ((seg.voice as Record<string, unknown>).engine as Engine) || (gp.engine as Engine);
      } else {
        effectiveEngine = gp.engine as Engine;
      }

      // Extract params from role voice (new EngineParams format)
      const rvParams = roleVoiceToFlatParams(rv);

      // Segment custom params
      const segParams = hasVoiceLock
        ? segEffectiveParams(seg) as Record<string, unknown>
        : {};

      // sp = merged source params: role + seg overrides (when applicable), or just seg overrides
      const sp = rv
        ? { ...rvParams, ...(hasVoiceLock ? segParams : {}) }
        : (hasVoiceLock ? segParams : {});

      // Now extract effective params — use sp (role/seg) when role exists, otherwise gp (global)
      const useRole = !!rv;
      const resolve = (key: string, fallback: unknown = '') =>
        useRole ? ((sp[key] !== undefined && sp[key] !== '') ? sp[key] : gp[key]) ?? fallback
          : hasVoiceLock ? ((sp[key] !== undefined && sp[key] !== '') ? sp[key] : gp[key]) ?? fallback
            : gp[key] ?? fallback;
      const resolveNum = (key: string, fallback: number) =>
        Number(resolve(key, fallback));

      const voiceId = resolve('voice_id') as string;
      const speed = resolveNum('speed', 1.0);
      const volume = resolveNum('volume', 80);
      const pitch = resolveNum('pitch', 1.0);
      const instruction = resolve('instruction') as string;
      const language = resolve('language', 'Chinese') as string;

      // Edge-TTS
      const effectiveEdgeVoice = resolve('edge_voice') as string;
      const effectiveEdgeRate = resolve('edge_rate', '+0%') as string;
      const effectiveEdgeVolume = resolve('edge_volume', '+0%') as string;

      // MiMo
      const effectiveMimoMode = resolve('mimo_mode', 'preset') as string;
      const effectiveMimoPreset = resolve('mimo_preset_voice') as string;
      const effectiveMimoCloneId = resolve('mimo_clone_voice_id') as string;
      const effectiveMimoVoiceDesc = resolve('mimo_voice_description') as string;
      const effectiveMimoInstruction = resolve('mimo_instruction') as string;

      // VoxCPM
      const effectiveVoxcpmMode = resolve('voxcpm_mode', 'tts') as string;
      const effectiveVoxcpmCfg = resolveNum('voxcpm_cfg_value', 2.0);
      const effectiveVoxcpmTimesteps = resolveNum('voxcpm_inference_timesteps', 10);
      const effectiveVoxcpmDesc = resolve('voxcpm_voice_description') as string;
      const effectiveVoxcpmStyle = resolve('voxcpm_style_control') as string;
      const effectiveVoxcpmPrompt = resolve('voxcpm_prompt_text') as string;

      const textToSend = seg.text;

      // Voice identifier & params snapshot — shared by both backend and frontend paths
      let usedVoiceId = effectiveEngine === 'edge_tts' ? effectiveEdgeVoice : (effectiveEngine === 'mimo_tts' ? (effectiveMimoMode === 'preset' ? effectiveMimoPreset : effectiveMimoMode === 'voicedesign' ? effectiveMimoVoiceDesc : effectiveMimoCloneId) : (effectiveEngine === 'voxcpm' ? voiceId : voiceId));
      const updatedParams: Partial<EngineParams> = { engine: effectiveEngine };
      if (effectiveEngine === 'edge_tts') {
        updatedParams.edge_voice = effectiveEdgeVoice;
        updatedParams.edge_rate = effectiveEdgeRate;
        updatedParams.edge_volume = effectiveEdgeVolume;
      } else if (effectiveEngine === 'mimo_tts') {
        updatedParams.mimo_mode = effectiveMimoMode;
        updatedParams.mimo_preset_voice = effectiveMimoPreset;
        updatedParams.mimo_clone_voice_id = effectiveMimoCloneId;
        updatedParams.mimo_voice_description = effectiveMimoVoiceDesc;
        updatedParams.mimo_instruction = effectiveMimoInstruction;
      } else if (effectiveEngine === 'voxcpm') {
        updatedParams.voxcpm_mode = effectiveVoxcpmMode;
        updatedParams.voxcpm_cfg_value = effectiveVoxcpmCfg;
        updatedParams.voxcpm_inference_timesteps = effectiveVoxcpmTimesteps;
        updatedParams.voxcpm_voice_description = effectiveVoxcpmDesc;
        updatedParams.voxcpm_style_control = effectiveVoxcpmStyle;
        updatedParams.voxcpm_prompt_text = effectiveVoxcpmPrompt;
      } else {
        updatedParams.voice_id = voiceId;
        updatedParams.speed = speed;
        updatedParams.volume = volume;
        updatedParams.pitch = pitch;
        updatedParams.language = language;
        updatedParams.instruction = instruction;
      }

      // Design voice detection: design modes need to use clone APIs at synthesis time.
      // Roles store mimo_mode='voicedesign' or voxcpm_mode='design' to indicate design voices.
      // We convert to the corresponding clone mode (voiceclone/ultimate) so the backend
      // uses stored reference audio instead of re-synthesizing from text description.
      let designDetected = false;
      if (effectiveEngine === 'mimo_tts' && effectiveMimoMode === 'voicedesign' && effectiveMimoCloneId) {
        updatedParams.mimo_mode = 'voiceclone';
        designDetected = true;
      }
      if (effectiveEngine === 'voxcpm' && effectiveVoxcpmMode === 'design' && voiceId) {
        updatedParams.voxcpm_mode = 'ultimate';
        // 不设置 voxcpm_prompt_text，由后端从 VoiceProfile.engine_params 中解析
        designDetected = true;
      }

      // Final modes after design detection
      const finalMimoMode = (updatedParams.mimo_mode as string) || effectiveMimoMode;
      const finalVoxcpmMode = (updatedParams.voxcpm_mode as string) || effectiveVoxcpmMode;
      const finalVoxcpmPromptText = (updatedParams.voxcpm_prompt_text as string) || effectiveVoxcpmPrompt;
      // Update usedVoiceId when design detection changes the mode
      if (designDetected && effectiveEngine === 'mimo_tts' && finalMimoMode === 'voiceclone') {
        usedVoiceId = effectiveMimoCloneId;
      }

      let resp: TTSResult;

      // Backend mode: write to per-project asset directory via the new segmented endpoint
      if (storageMode === 'backend' && project?.id) {
        const requestParams: Record<string, unknown> = { engine: effectiveEngine };
        if (effectiveEngine === 'edge_tts') {
          requestParams.edge_voice = effectiveEdgeVoice;
          requestParams.edge_rate = effectiveEdgeRate;
          requestParams.edge_volume = effectiveEdgeVolume;
        } else if (effectiveEngine === 'mimo_tts') {
          requestParams.mimo_mode = effectiveMimoMode;
          requestParams.mimo_preset_voice = effectiveMimoPreset;
          requestParams.mimo_clone_voice_id = effectiveMimoCloneId;
          requestParams.mimo_voice_description = effectiveMimoVoiceDesc;
          requestParams.mimo_instruction = effectiveMimoInstruction;
        } else if (effectiveEngine === 'voxcpm') {
          requestParams.voice_id = voiceId;
          requestParams.voxcpm_mode = effectiveVoxcpmMode;
          requestParams.voxcpm_cfg_value = effectiveVoxcpmCfg;
          requestParams.voxcpm_inference_timesteps = effectiveVoxcpmTimesteps;
          requestParams.voxcpm_voice_description = effectiveVoxcpmDesc;
          requestParams.voxcpm_style_control = effectiveVoxcpmStyle;
          requestParams.voxcpm_prompt_text = effectiveVoxcpmPrompt;
        } else {
          requestParams.voice_id = voiceId;
          requestParams.speed = speed;
          requestParams.volume = volume;
          requestParams.pitch = pitch;
          requestParams.language = language;
          requestParams.instruction = instruction;
        }
        // Apply design detection overrides to backend request
        if (designDetected) {
          if (effectiveEngine === 'voxcpm') {
            requestParams.voxcpm_mode = finalVoxcpmMode;
            requestParams.voxcpm_prompt_text = finalVoxcpmPromptText;
          } else if (effectiveEngine === 'mimo_tts') {
            requestParams.mimo_mode = finalMimoMode;
          }
        }
        const { segmentedProjectApi } = await import('../services/api');
        const updated = await segmentedProjectApi.synthesizeSegment(
          project.id, activeChapter.id, seg.id, {
            params: requestParams,
            text: textToSend,
            ssml: undefined,
            keep_previous: true,
          },
        );
        // Extract the regenerated segment from the backend response
        const updatedSeg = updated.chapters
          ?.flatMap((c: Chapter) => c.segments ?? [])
          ?.find((s: Segment) => s.id === seg.id);
        // Clear legacy IndexedDB audio_id if it existed (segment now uses backend path)
        if (seg.audio.current?.id) { try { await deleteTTSResult(seg.audio.current.id); } catch { /* ignore */ } }
        if (seg.audio.previous?.id) { try { await deleteTTSResult(seg.audio.previous.id); } catch { /* ignore */ } }
        // Surgically update only the regenerated segment — preserve all other segments' frontend state
        const usedVoiceId = effectiveEngine === 'edge_tts' ? effectiveEdgeVoice : (effectiveEngine === 'mimo_tts' ? (effectiveMimoMode === 'preset' ? effectiveMimoPreset : effectiveMimoCloneId) : voiceId);
        dispatch({
          type: 'GENERATE_SUCCESS',
          id,
          generated_voice_id: usedVoiceId,
          updated_params: updatedParams,
          current_audio_path: updatedSeg?.audio.current?.path,
            previous_audio_path: updatedSeg?.audio.previous?.path,
            audio_format: updatedSeg?.audio.format ?? 'mp3',
            duration_sec: updatedSeg?.audio.duration_sec,
          generated_params: updatedSeg?.generated_params,
        });
        return;
      }

      if (effectiveEngine === 'edge_tts') {
        resp = await ttsApi.synthesize({ text: textToSend, engine: 'edge_tts', voice_id: '', edge_voice: effectiveEdgeVoice ?? '', edge_rate: effectiveEdgeRate ?? '+0%', edge_volume: effectiveEdgeVolume ?? '+0%', format: 'mp3' });
      } else if (effectiveEngine === 'mimo_tts') {
        if (finalMimoMode === 'voicedesign') {
          resp = await mimoTtsApi.synthesizeVoiceDesign({ text: textToSend, voice_description: effectiveMimoVoiceDesc || '', format: 'wav' });
        } else if (finalMimoMode === 'voiceclone') {
          resp = await mimoTtsApi.synthesizeVoiceClone({ text: textToSend, voice_id: effectiveMimoCloneId ?? '', instruction: effectiveMimoInstruction ?? '', format: 'wav' });
        } else {
          resp = await mimoTtsApi.synthesizePreset({ text: textToSend, voice: effectiveMimoPreset ?? '', instruction: effectiveMimoInstruction ?? '', format: 'wav' });
        }
      } else if (effectiveEngine === 'voxcpm') {
        if (finalVoxcpmMode === 'design') {
          resp = await voxcpmApi.design({ voice_description: effectiveVoxcpmDesc, text: textToSend || undefined, cfg_value: effectiveVoxcpmCfg, inference_timesteps: effectiveVoxcpmTimesteps, format: 'wav' });
        } else if (finalVoxcpmMode === 'clone') {
          resp = await voxcpmApi.clone({ text: textToSend, voice_id: voiceId ?? '', style_control: effectiveVoxcpmStyle, cfg_value: effectiveVoxcpmCfg, inference_timesteps: effectiveVoxcpmTimesteps, format: 'wav' });
        } else if (finalVoxcpmMode === 'ultimate') {
          resp = await voxcpmApi.ultimateClone({ text: textToSend, voice_id: voiceId ?? '', prompt_text: finalVoxcpmPromptText, style_control: effectiveVoxcpmStyle, cfg_value: effectiveVoxcpmCfg, inference_timesteps: effectiveVoxcpmTimesteps, format: 'wav' });
        } else {
          resp = await voxcpmApi.tts({ text: textToSend, cfg_value: effectiveVoxcpmCfg, inference_timesteps: effectiveVoxcpmTimesteps, format: 'wav' });
        }
      } else {
        resp = await ttsApi.synthesize({ text: textToSend, voice_id: voiceId ?? '', language: (language ?? 'Chinese') as 'Chinese' | 'English' | 'Japanese' | 'Korean', speed: speed ?? 1.0, volume: volume ?? 80, pitch: pitch ?? 1.0, instruction: instruction ?? '', enable_ssml: sp.enable_ssml ?? false, enable_markdown_filter: sp.enable_markdown_filter ?? false, format: 'mp3' });
      }
      if (!resp.audio_base64) throw new Error('No audio returned');
      // Auto-trim leading/trailing silence:
      // - Default: keep 80ms natural edge
      // - Sentence period ending: keep 100ms trailing edge
      let audioBase64 = resp.audio_base64;
      let fmt = resp.audio_format || 'mp3';
      try {
        const leadingKeepMs = 80;
        const trailingKeepMs = endsWithSentencePeriod(textToSend) ? 100 : 80;
        const { base64: trimmedBase64, trimmedMs } = await trimBase64AudioSilence(resp.audio_base64, { leadingKeepMs, trailingKeepMs });
        if (trimmedMs > 0) {
          audioBase64 = trimmedBase64;
          fmt = 'wav'; // trim outputs WAV
          console.log(`Trimmed ${trimmedMs}ms silence from segment #${segIdx + 1} (leading=${leadingKeepMs}ms, trailing=${trailingKeepMs}ms)`);
        }
      } catch (trimErr) { console.warn('Silence trim skipped:', trimErr); }
      const bytes = atob(audioBase64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: fmt === 'wav' ? 'audio/wav' : 'audio/mpeg' });
      const ac = new AudioContext();
      const ab = await ac.decodeAudioData(await blob.arrayBuffer());
      const duration = ab.duration;
      ac.close();
      const audioId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await saveTTSResult({ id: audioId, text: seg.text, voice_id: voiceId ?? '', voice_name: '', audioBlob: blob, audio_format: fmt, speed: speed ?? 1, volume: volume ?? 80, pitch: pitch ?? 1, instruction: instruction ?? '', language: language ?? 'Chinese', created_at: new Date().toISOString(), source: 'segmented_tts' });
      if (seg.previous_audio_id) { try { await deleteTTSResult(seg.previous_audio_id); } catch { /* ignore */ } }
      dispatch({ type: 'GENERATE_SUCCESS', id, audio_id: audioId, duration_sec: duration, generated_voice_id: usedVoiceId, updated_params: updatedParams });
    } catch (error: unknown) {
      dispatch({ type: 'GENERATE_FAIL', id, error: getErrorMessage(error) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapter.segments, dispatch, buildCurrentParams, showToast, roles]);

  // Keep ref in sync
  handleRegenerateRef.current = handleRegenerate;

  const handleRegenerateAll = useCallback(async () => {
    if (generating) return;

    // Segments to regenerate: idle, failed, OR ready but NOT voice-locked
    const toRegenerate = activeChapter.segments.filter(s => {
      if (s.status === 'idle' || s.status === 'failed') return true;
      if (s.status === 'ready') {
        const hasVoiceLock = s.voice.source === 'custom';
        return !hasVoiceLock; // regenerate ready segments that follow global voice
      }
      return false; // skip 'pending'/'queued'
    });

    if (toRegenerate.length === 0) {
      showToast('没有需要重新生成的片段');
      return;
    }

    const existingAudio = toRegenerate.filter(s => s.audio.current?.id);

    // Show confirmation
    const lockedCount = activeChapter.segments.filter(s => s.status === 'ready' && s.voice.source === 'custom').length;
    const lines = [
      `将重新生成 ${toRegenerate.length} 个片段。`,
    ];
    if (existingAudio.length > 0) {
      lines.push(`其中 ${existingAudio.length} 个已有音频将被删除后重新生成。`);
    }
    if (lockedCount > 0) {
      lines.push(`已锁定独立音色的 ${lockedCount} 个片段将保持不变。`);
    }

    setConfirmDialog({
      open: true,
      title: '全部重新生成',
      message: lines.join('\n'),
      variant: 'warning',
      confirmLabel: '重新生成',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        await doRegenerateAll(toRegenerate);
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, activeChapter.segments, showToast]);

  const doRegenerateAll = useCallback(async (toRegenerate: typeof activeChapter.segments) => {
    setGenerating(true);
    try {
      // Step 1: Delete existing audio for segments that have it
      for (const seg of toRegenerate) {
        if (seg.current_audio_id) {
          try { await deleteTTSResult(seg.current_audio_id); } catch { /* ignore */ }
        }
        dispatch({ type: 'CLEAR_SEGMENT_AUDIO', id: seg.id });
      }

      // Step 2: Mark all as queued
      dispatch({ type: 'MARK_QUEUED', ids: toRegenerate.map(s => s.id) });

      // Step 3: Generate in parallel (3 workers)
      // Use ref to always get the LATEST handleRegenerate (not stale closure)
      let i = 0;
      const next = async () => {
        while (i < toRegenerate.length) {
          const seg = toRegenerate[i++];
          await handleRegenerateRef.current(seg.id);
        }
      };
      await Promise.all(Array.from({ length: 3 }, () => next()));
      showToast('全部生成完成');
    } catch (e) {
      console.error('Regenerate all failed:', e);
      showToast('部分生成失败', 'error');
    } finally {
      setGenerating(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, showToast]);

  const handleAnnotateSSML = useCallback(async (idsArg?: string[]) => {
    const ids = idsArg ?? activeChapter.segments.filter(s => (segEffectiveParams(s).engine as string) === 'cosyvoice').map(s => s.id);
    const targetSegs = activeChapter.segments.filter(s => ids.includes(s.id));
    if (!targetSegs.length) return;
    try {
      const result = await textSplitApi.ssmlAnnotate(targetSegs.map(s => s.text));
      const updates = targetSegs.map((s, i) => ({ id: s.id, ssml: result.annotations[i]?.ssml ?? `<speak>${s.text}</speak>` }));
      dispatch({ type: 'BATCH_SET_SSML', updates, by_llm: true });
      for (const s of targetSegs) { dispatch({ type: 'UPDATE_PARAMS', id: s.id, params: { enable_ssml: true } }); }
      showToast(`已为 ${targetSegs.length} 段标注 SSML`);
    } catch { showToast('SSML 标注失败，请检查 LLM 配置', 'error'); }
  }, [activeChapter.segments, dispatch, showToast]);

  /** Stop whatever is currently playing (single or play-all) and reset state */
  const stopCurrentAudio = useCallback(() => {
    playAllAbortRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setPlayingId(undefined);
    setIsPaused(false);
    setPlayAllActive(false);
  }, []);

  const handlePlaySegment = useCallback(async (id: string) => {
    // If clicking the same segment that's active → toggle pause/resume
    if (playingId === id && audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play();
        setIsPaused(false);
      } else {
        audioRef.current.pause();
        setIsPaused(true);
      }
      return;
    }

    // Stop any currently playing audio (also interrupts play-all)
    stopCurrentAudio();

    const seg = activeChapter.segments.find(s => s.id === id);
    if (!seg?.audio.current?.id && !seg?.audio.current?.path) {
      showToast('该段尚未生成音频', 'error');
      return;
    }

    const logPlayError = (ctx: string, e: unknown) => {
      // Never silently swallow — log + toast so users can diagnose
      console.error(`[PlaySegment:${ctx}]`, e, {
        segId: seg?.id,
        chapterId: activeChapter?.id,
        projectId: project?.id,
        storageMode,
        current_audio_id: seg?.audio.current?.id,
        current_audio_path: seg?.audio.current?.path,
      });
      const msg = getErrorMessage(e, String(e));
      showToast(`播放失败 (${ctx}): ${msg}`, 'error');
    };

    try {
      // Backend mode: fetch audio as blob, then play via blob URL
      if (storageMode === 'backend' && project?.id && seg.audio.current?.path) {
        const url = `/api/segmented-projects/${project.id}/audio/${activeChapter.id}/${seg.id}`;
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) {
          // Try to extract backend error detail (FastAPI's `detail` field)
          let detail = `HTTP ${resp.status}`;
          try {
            const body = await resp.clone().json();
            if (body?.detail) detail = `${resp.status} ${body.detail}`;
          } catch {
            try { detail = `${resp.status} ${await resp.text()}`.slice(0, 200); } catch { /* ignore */ }
          }
          throw new Error(detail);
        }
        const blob = await resp.blob();
        if (blob.size < 100) throw new Error(`音频为空 (${blob.size}B)，可能后端文件损坏`);
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;
        const audio = new Audio(blobUrl);
        audioRef.current = audio;
        audio.onended = () => { setPlayingId(undefined); setIsPaused(false); setPlayAllActive(false); audioRef.current = null; URL.revokeObjectURL(blobUrl); blobUrlRef.current = null; };
        audio.onerror = () => {
          const errCode = audio.error?.code;
          const errMsg = audio.error?.message ?? 'unknown';
          logPlayError('audio.onerror', new Error(`code=${errCode} msg=${errMsg}`));
          setPlayingId(undefined); setIsPaused(false); setPlayAllActive(false); audioRef.current = null; URL.revokeObjectURL(blobUrl); blobUrlRef.current = null;
        };
        setPlayingId(id);
        setIsPaused(false);
        setPlayAllActive(false);
        await audio.play();
        return;
      }
      // Path mismatch: segment has backend audio_path but storage mode is frontend.
      // This happens when the user generated audio in backend mode then switched modes.
      if (seg.audio.current?.path && !seg.current_audio_id) {
        showToast('该段音频在后端，请切换到后端存储模式播放', 'error');
        return;
      }
      const blob = await getTTSAudioBlob(seg.current_audio_id!);
      if (!blob) {
        showToast('本地音频文件不存在或已被清理，请重新生成', 'error');
        return;
      }
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setPlayingId(undefined); setIsPaused(false); setPlayAllActive(false); audioRef.current = null; URL.revokeObjectURL(url); blobUrlRef.current = null; };
      audio.onerror = () => {
        const errCode = audio.error?.code;
        const errMsg = audio.error?.message ?? 'unknown';
        logPlayError('audio.onerror', new Error(`code=${errCode} msg=${errMsg}`));
        setPlayingId(undefined); setIsPaused(false); setPlayAllActive(false); audioRef.current = null; URL.revokeObjectURL(url); blobUrlRef.current = null;
      };
      setPlayingId(id);
      setIsPaused(false);
      setPlayAllActive(false);
      await audio.play();
    } catch (e) {
      logPlayError('play-handler', e);
      setPlayingId(undefined);
      setIsPaused(false);
      setPlayAllActive(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapter.segments, playingId, stopCurrentAudio, storageMode, project, activeChapter, showToast]);

  const handlePlayAll = useCallback(async () => {
    const readySegs = activeChapter.segments.filter(s =>
      s.status === 'ready' && (s.audio.current?.id || s.audio.current?.path),
    );
    if (readySegs.length === 0) return;

    // Restart abort flag
    playAllAbortRef.current = false;
    setPlayAllActive(true);

    for (const seg of readySegs) {
      if (playAllAbortRef.current) break;

      // Stop previous audio in sequence
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      setPlayingId(seg.id);
      setIsPaused(false);

      try {
        // Backend mode: fetch audio as blob, then play
        if (storageMode === 'backend' && project?.id && seg.audio.current?.path) {
          const url = `/api/segmented-projects/${project.id}/audio/${activeChapter.id}/${seg.id}`;
          const resp = await fetch(url, { cache: 'no-store' });
          if (!resp.ok) {
            let detail = `HTTP ${resp.status}`;
            try { const b = await resp.clone().json(); if (b?.detail) detail = `${resp.status} ${b.detail}`; } catch { /* ignore */ }
            console.error(`[PlayAll:backend HTTP ${resp.status}]`, detail);
            continue;
          }
          if (playAllAbortRef.current) continue;
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          blobUrlRef.current = blobUrl;
          const audio = new Audio(blobUrl);
          audioRef.current = audio;
          await new Promise<void>((resolve) => {
            audio.onended = () => { URL.revokeObjectURL(blobUrl); blobUrlRef.current = null; audioRef.current = null; resolve(); };
            audio.onerror = () => { console.error('[PlayAll:audio.onerror backend]', audio.error); URL.revokeObjectURL(blobUrl); blobUrlRef.current = null; audioRef.current = null; resolve(); };
            audio.play().catch((e) => { console.error('[PlayAll:play() rejected backend]', e); resolve(); });
          });
          continue;
        }
        const blob = await getTTSAudioBlob(seg.current_audio_id!);
        if (!blob || playAllAbortRef.current) continue;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;

        await new Promise<void>((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); blobUrlRef.current = null; audioRef.current = null; resolve(); };
          audio.onerror = () => { console.error('[PlayAll:audio.onerror]', audio.error); URL.revokeObjectURL(url); blobUrlRef.current = null; audioRef.current = null; resolve(); };
          audio.play().catch((e) => { console.error('[PlayAll:play() rejected]', e); resolve(); });
        });
      } catch (e) { console.error('[PlayAll:handler]', e); /* skip */ }
    }

    // Clean up after sequence completes
    setPlayingId(undefined);
    setIsPaused(false);
    setPlayAllActive(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapter.segments, storageMode, project, activeChapter]);

  const handleStopAll = useCallback(() => {
    stopCurrentAudio();
  }, [stopCurrentAudio]);

  const handleTrimSilence = useCallback(async (id: string) => {
    const seg = activeChapter.segments.find(s => s.id === id);
    if (!seg?.audio.current?.id) return;
    try {
      const blob = await getTTSAudioBlob(seg.current_audio_id);
      if (!blob) return;
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });
      const { base64: trimmedBase64, trimmedMs } = await trimBase64AudioSilence(base64);
      if (trimmedMs <= 0) { showToast('无多余静音'); return; }

      // Decode trimmed to get new duration
      const byteStr = atob(trimmedBase64);
      const arr = new Uint8Array(byteStr.length);
      for (let i = 0; i < byteStr.length; i++) arr[i] = byteStr.charCodeAt(i);
      const trimmedBlob = new Blob([arr], { type: 'audio/wav' });
      const ac = new AudioContext();
      const ab = await ac.decodeAudioData(await trimmedBlob.arrayBuffer());
      const newDuration = ab.duration;
      ac.close();

      // Save trimmed audio, delete old
      const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const eff = segEffectiveParams(seg);
      await saveTTSResult({ id: newId, text: seg.text, voice_id: (eff.voice_id as string) || '', voice_name: '', audioBlob: trimmedBlob, audio_format: 'wav', speed: (eff.speed as number) ?? 1, volume: (eff.volume as number) ?? 80, pitch: (eff.pitch as number) ?? 1, instruction: (eff.instruction as string) || '', language: (eff.language as string) || 'Chinese', created_at: new Date().toISOString(), source: 'segmented_tts' });
      try { await deleteTTSResult(seg.current_audio_id); } catch { /* ignore */ }
      dispatch({ type: 'GENERATE_SUCCESS', id, audio_id: newId, duration_sec: newDuration });
      showToast(`裁剪了 ${trimmedMs}ms 静音`);
    } catch (e) { console.error('Trim failed:', e); showToast('裁剪失败', 'error'); }
  }, [activeChapter.segments, dispatch, showToast]);

  const selectedVoice = voices.find(v => (v.qwen_voice_id || v.id) === selectedVoiceId);
  // isScratchpadProject 已提前到 component 顶部 (P2 v2 useMemo 引用)
  const activeChapterDuration = activeChapter.segments.reduce((total, segment) => total + (segment.audio.duration_sec ?? 0), 0);
  const generatedSegmentCount = activeChapter.segments.filter(segment => segment.status === 'ready').length;
  return (
    <div className={styles.container}>
      <div className={styles.workbenchLayout}>
        {!hideProjectSidebar && (
        <ProjectSidebar
          projects={projectList}
          activeProjectId={project.id}
          collapsed={projectSidebarCollapsed}
          scratchpadId={SCRATCHPAD_PROJECT_ID}
          onToggleCollapse={() => setProjectSidebarCollapsed(value => !value)}
          onSelectProject={(projectId) => { void loadProjectById(projectId); }}
          onCreateProject={() => { void handleCreateProject(); }}
          onDeleteProject={handleDeleteProject}
        />
        )}

        <ProjectShell
          projectName={project.name}
          projectSubtitle={isScratchpadProject ? '快速试稿' : '项目制 · 章节分段'}
          activeSection={projectSection}
          chapterName={activeChapter.name}
          segmentCount={activeChapter.segments.length}
          generatedCount={generatedSegmentCount}
          durationSec={activeChapterDuration}
          chapters={project.chapters}
          activeChapterId={libraryFulltext && projectSection === 'library' ? undefined : activeChapter.id}
          onSelectChapter={(id) => {
            if (libraryFulltext && projectSection === 'library') {
              setLibraryFulltext(false);
            }
            handleSelectChapter(id);
          }}
          onAddChapter={handleAddChapter}
          onRenameChapter={(id, name) => dispatch({ type: 'RENAME_CHAPTER', id, name })}
          onDeleteChapter={handleDeleteChapter}
          rightPanelCollapsed={projectSection === 'studio' ? rightPanelCollapsed : true}
          onSectionChange={setProjectSection}
          onBackToProjects={onBackToProjects}
        >
        {projectSection === 'studio' ? (
        <VoiceStudioLayout
          segmentCount={activeChapter.segments.length}
          generatedCount={generatedSegmentCount}
          durationSec={activeChapterDuration}
          remotionPath={project.remotion_project_path}
          onExport={() => setExportOpen(true)}
          onPlayAll={playAllActive ? handleStopAll : handlePlayAll}
          onSidebarCollapseChange={setRightPanelCollapsed}
          sidebarContent={
            <div className={styles.sidebarAccordion}>
              {/* Voice Mode */}
              <div className={`${styles.sidebarSection} ${sidebarOpen.voiceMode ? styles.open : ''}`}>
                <div className={styles.sidebarSectionHeader} onClick={() => toggleSidebarSection('voiceMode')}>
                  <span className={styles.sidebarSectionTitle}>{t('studio.voiceMode')}</span>
                  <span className={styles.sidebarSectionCaret}>›</span>
                </div>
                <div className={styles.sidebarSectionBody}>
                  <div className={styles.sidebarSectionBodyInner}>
                    <div className={styles.sidebarModeSwitch} aria-label={t('studio.voiceMode')}>
                      <button
                        type="button"
                        className={`${styles.sidebarModeBtn} ${splitVoiceMode === 'narration' ? styles.sidebarModeBtnActive : ''}`}
                        onClick={e => { e.stopPropagation(); handleSplitVoiceModeChange('narration'); }}
                      >
                        {t('studio.narration')}
                      </button>
                      <button
                        type="button"
                        className={`${styles.sidebarModeBtn} ${splitVoiceMode === 'dialogue' ? styles.sidebarModeBtnActive : ''}`}
                        onClick={e => { e.stopPropagation(); handleSplitVoiceModeChange('dialogue'); }}
                      >
                        {t('studio.dialogue')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Narration Voice */}
              <div className={`${styles.sidebarSection} ${sidebarOpen.engine ? styles.open : ''}`}>
                <div className={styles.sidebarSectionHeader} onClick={() => toggleSidebarSection('engine')}>
                  <span className={styles.sidebarSectionTitle}>{t('studio.narrationVoice')}</span>
                  <span className={styles.sidebarSectionCaret}>›</span>
                </div>
                <div className={styles.sidebarSectionBody}>
                  <div className={styles.sidebarSectionBodyInner}>
                    <select
                      className={styles.sidebarEngineSelect}
                      value={engine}
                      onChange={e => setEngine(e.target.value as Engine)}
                    >
                      <option value="edge_tts">Edge-TTS</option>
                      <option value="cosyvoice">CosyVoice</option>
                      <option value="mimo_tts">MiMo TTS</option>
                      <option value="voxcpm">VoxCPM</option>
                    </select>
                    {engine === 'cosyvoice' ? (
                      <GlobalControlBar
                        voices={voices} selectedVoiceId={selectedVoiceId} onVoiceSelect={setSelectedVoiceId}
                        speed={params.speed ?? 1.0} volume={params.volume ?? 80} pitch={params.pitch ?? 1.0} language={params.language || 'Chinese'}
                        instruction={params.instruction} enableSsml={params.enable_ssml} enableMarkdownFilter={params.enable_markdown_filter}
                        onSpeedChange={v => setParams(p => ({ ...p, speed: v }))}
                        onVolumeChange={v => setParams(p => ({ ...p, volume: v }))}
                        onPitchChange={v => setParams(p => ({ ...p, pitch: v }))}
                        onLanguageChange={v => setParams(p => ({ ...p, language: v as TTSRequest['language'] }))}
                        onInstructionChange={v => setParams(p => ({ ...p, instruction: v }))}
                        onSsmlToggle={() => setParams(p => ({ ...p, enable_ssml: !p.enable_ssml }))}
                        onMarkdownFilterToggle={() => setParams(p => ({ ...p, enable_markdown_filter: !p.enable_markdown_filter }))}
                        onNavigateToClone={onNavigateToClone}
                      />
                    ) : engine === 'edge_tts' ? (
                      <EdgeTTSPanel selectedVoice={edgeVoice} onVoiceSelect={setEdgeVoice} rate={edgeRate} volume={edgeVolume} onRateChange={setEdgeRate} onVolumeChange={setEdgeVolume} />
                    ) : engine === 'mimo_tts' ? (
                      <MiMoTTSPanel mode={mimoMode} onModeChange={setMimoMode} onPresetVoiceSelect={setMimoPresetVoice} selectedPresetVoice={mimoPresetVoice} onInstructionChange={setMimoInstruction} instruction={mimoInstruction} onCloneVoiceSelect={setMimoCloneVoiceId} selectedCloneVoiceId={mimoCloneVoiceId} excludeCloneEngines={excludeQwen} projectId={project.id} />
                    ) : (
                      <VoxCPMPanel
                        mode={voxcpmMode} onModeChange={setVoxcpmMode}
                        styleControl={voxcpmStyleControl} onStyleControlChange={setVoxcpmStyleControl}
                        promptText={voxcpmPromptText} onPromptTextChange={setVoxcpmPromptText}
                        selectedVoiceId={selectedVoiceId} onVoiceSelect={setSelectedVoiceId}
                        cfgValue={voxcpmCfgValue} onCfgValueChange={setVoxcpmCfgValue}
                        inferenceTimesteps={voxcpmInferenceTimesteps} onInferenceTimestepsChange={setVoxcpmInferenceTimesteps}
                        allowedCloneEngines={allowVoxcpm}
                        projectId={project.id}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          }
        >
        <div className={styles.workbenchMain}>
          <div className={styles.segmentedContent}>
            <TextInputPanel
              splitConfig={activeChapter.split_config}
              onSplitConfigChange={(config) => dispatch({ type: 'SET_SPLIT_CONFIG', config })}
              onSplit={(texts, originalText, voiceMode) => {
                doApplySplit(buildSplitItemsWithRoles(texts.map(t => ({ text: t })), voiceMode), originalText);
              }}
              onLLMSplit={async (text, voiceMode) => {
                const result = await textSplitApi.llmSplit(text, activeChapter.split_config.delimiters);
                doApplySplit(buildSplitItemsWithRoles(result.segments.map(s => ({ text: s.text, emotion: s.emotion })), voiceMode), text);
              }}
              sourceText={activeChapter.original_text}
              segmentTexts={activeChapter.segments.map(s => s.text)}
              segmentCount={activeChapter.segments.length}
              chapterId={activeChapter.id}
              chapterName={activeChapter.design_title || activeChapter.name}
              splitVoiceMode={splitVoiceMode}
              onSplitVoiceModeChange={handleSplitVoiceModeChange}
              showVoiceModeSwitch={false}
            />

            <div className={styles.sourceProductionBar} aria-label="Source Text production controls">
              <div className={styles.productionActions}>
                <button type="button" className={styles.productionBtn} onClick={handleRegenerateAll}>⚡ 批量合成</button>
                <button type="button" className={styles.productionBtnSecondary} onClick={playAllActive ? handleStopAll : handlePlayAll}>
                  {playAllActive ? '⏹ 停止' : '▶ 全部播放'}
                </button>
                {isScratchpadProject && <span className={styles.scratchpadBadge}>默认草稿</span>}
                <span className={styles.segmentedStats}>
                  {activeChapter.segments.length} 段 · {activeChapter.segments.reduce((a, s) => a + (s.audio.duration_sec ?? 0), 0).toFixed(1)}s
                  {activeChapter.segments.filter(s => s.status === 'ready').length > 0 && ` · ${activeChapter.segments.filter(s => s.status === 'ready').length}/${activeChapter.segments.length} 已生成`}
                </span>
                {engine === 'cosyvoice' && (
                  <button className={styles.segmentedActionBtn} onClick={() => handleAnnotateSSML()}>✨ 标注</button>
                )}
              </div>
              <div className={styles.productionRight}>
                <div className={styles.toolbarGroup} aria-label="segment 时间呈现">
                  <button className={`${styles.toolbarPill} ${srtDurationMode === 'chapter' ? styles.toolbarPillActive : ''}`} onClick={() => setSrtDurationMode('chapter')}>章节时间</button>
                  <button className={`${styles.toolbarPill} ${srtDurationMode === 'global' ? styles.toolbarPillActive : ''}`} onClick={() => setSrtDurationMode('global')}>全局时间</button>
                </div>
                <div className={styles.viewToggle} aria-label="segment 卡片呈现">
                  <button className={`${styles.viewToggleBtn} ${compactMode ? styles.viewToggleActive : ''}`}
                    onClick={() => setCompactMode(true)}>紧凑</button>
                  <button className={`${styles.viewToggleBtn} ${!compactMode ? styles.viewToggleActive : ''}`}
                    onClick={() => setCompactMode(false)}>展开</button>
                </div>
              </div>
            </div>

            <div className={styles.segmentedEditor}>
              <SegmentList
                segments={activeChapter.segments}
                layout={project.layout}
                selectedId={activeChapter.selected_segment_id}
                playingId={playingId}
                isPaused={isPaused}
                compact={compactMode}
                voiceMode={splitVoiceMode}
                voices={voices}
                roles={roles}
                globalVoiceId={selectedVoiceId}
                globalVoiceName={selectedVoice?.name}
                globalEdgeVoice={edgeVoice}
                engine={engine}
                globalMimoMode={mimoMode}
                globalMimoPresetVoice={mimoPresetVoice}
                globalMimoCloneVoiceId={mimoCloneVoiceId}
                chapterStartOffset={effectiveTimeOffset}
                onSelect={(id) => {
                  const currentSelected = activeChapter.selected_segment_id;
                  dispatch({ type: 'SELECT_SEGMENT', id: currentSelected === id ? undefined : id });
                }}
                onDelete={handleDeleteSegment}
                onInsertAfter={(afterId) => dispatch({ type: 'INSERT_SEGMENT', afterId, voice_ref: buildGlobalVoiceRef() })}
                onAppend={() => dispatch({ type: 'APPEND_SEGMENT', voice_ref: buildGlobalVoiceRef() })}
                onReorder={(from, to) => dispatch({ type: 'REORDER', fromIndex: from, toIndex: to })}
                onEdit={(id) => {
                  const currentSelected = activeChapter.selected_segment_id;
                  dispatch({ type: 'SELECT_SEGMENT', id: currentSelected === id ? undefined : id });
                }}
                onRegenerate={handleRegenerate}
                onPlay={handlePlaySegment}
                onTrimSilence={handleTrimSilence}
                onUndo={(id) => dispatch({ type: 'UNDO_REGENERATE', id })}
                onConfirmCustom={handleConfirmCustom}
                onDuplicate={(id) => {
                  const seg = activeChapter.segments.find(s => s.id === id);
                  if (seg) dispatch({ type: 'INSERT_SEGMENT', afterId: id, text: seg.text, voice_ref: seg.voice_ref || buildGlobalVoiceRef() });
                }}
                onAnnotateSSML={(id) => handleAnnotateSSML([id])}
                onUpdateText={(id, text) => dispatch({ type: 'UPDATE_TEXT', id, text })}
                onUpdateSSML={(id, ssml) => dispatch({ type: 'UPDATE_SSML', id, ssml })}
                onUpdateParams={(id, params) => {
                  // Only apply params update for already-custom segments
                  const seg = activeChapter.segments.find(s => s.id === id);
                  if (seg?.voice.source === 'custom') {
                    dispatch({ type: 'UPDATE_PARAMS', id, params });
                  }
                  // Non-custom: ignored here; params accumulated locally in edit panel → confirm button handles conversion
                }}
                onUpdateEmotion={(id, emotion) => dispatch({ type: 'UPDATE_EMOTION', id, emotion })}
                onUpdateRole={(id, roleId, roleSnapshot) => dispatch({ type: 'SET_SEGMENT_ROLE', id, roleId, roleSnapshot })}
                onUpdateKind={(id, kind, roleSnapshot) => {
                  dispatch({ type: 'SET_SEGMENT_KIND', id, segmentKind: kind });
                  dispatch({ type: 'SET_SEGMENT_ROLE', id, roleId: roleSnapshot?.id ?? null, roleSnapshot });
                }}
                onToggleIndependentVoice={handleToggleIndependentVoice}
                onMerge={handleMerge}
                onSplit={handleSplit}
              />

              <ExportDialog
                open={exportOpen}
                projectId={project.id}
                chapterId={activeChapter.id}
                segments={activeChapter.segments}
                chapterDesignTitle={activeChapter.design_title || activeChapter.name}
                remotionProjectPath={project.remotion_project_path}
                defaultName={activeChapter.design_title || activeChapter.name}
                globalStartOffset={chapterStartOffset}
                onClose={() => setExportOpen(false)}
              />
            </div>
          </div>
        </div>
        </VoiceStudioLayout>
        ) : projectSection === 'library' ? (
          <ProjectLibrary
            chapters={project.chapters}
            activeChapterId={project.active_chapter_id}
            projectName={project.name}
            sourceDocument={project.source_document}
            onSelectChapter={handleSelectChapter}
            onRenameProject={(name) => dispatch({ type: 'RENAME_PROJECT', name })}
            onModeChange={(mode) => setLibraryFulltext(mode === 'fulltext')}
            onRenameChapter={(id, name) => dispatch({ type: 'RENAME_CHAPTER', id, name })}
            onUpdateChapterText={(id, text) => {
              dispatch({ type: 'SET_CHAPTER_META_BY_ID', id, meta: { original_text: text } });
            }}
            onUpdateChapterDesignTitle={(id, designTitle) => {
              dispatch({ type: 'SET_CHAPTER_META_BY_ID', id, meta: { design_title: designTitle } });
            }}
            onUpdateSourceDocument={(text) => dispatch({ type: 'SET_SOURCE_DOCUMENT', text })}
            onAddChapter={handleAddChapter}
            onDeleteChapter={handleDeleteChapter}
            onEnterStudio={(chapterId) => {
              handleSelectChapter(chapterId);
              setProjectSection('studio');
            }}
          />
        ) : projectSection === 'voices' ? (
          <ProjectVoices
            roles={roles}
            projectId={project.id}
            onSaveRole={handleSaveRole}
            onDeleteRole={handleDeleteRole}
            onPreviewRole={handlePreviewRole}
            onManageRoles={() => setRoleLibraryOpen(true)}
          />
        ) : projectSection === 'overview' ? (
          <ProjectOverview
            projectName={project.name}
            chapters={project.chapters}
            activeChapterId={project.active_chapter_id}
            remotionPath={project.remotion_project_path}
            roles={roles}
            onEnterLibrary={() => setProjectSection('library')}
            onEnterStudio={() => setProjectSection('studio')}
            onOpenVoices={() => setProjectSection('voices')}
          />
        ) : projectSection === 'settings' ? (
          <ProjectSettings
            projectName={project.name}
            remotionPath={project.remotion_project_path}
            storageMode={storageMode}
            chapterCount={project.chapters.length}
            projectDescription={project.description}
            projectType={project.project_type}
            defaultLanguage={project.default_language}
            exportDirectory={project.export_directory}
            exportNamingTemplate={project.export_naming_template}
            onRenameProject={(name) => dispatch({ type: 'RENAME_PROJECT', name })}
            onUpdateRemotionPath={(path) => dispatch({ type: 'SET_PROJECT_META', meta: { remotion_project_path: path } })}
            onUpdateProjectMeta={(meta) => dispatch({ type: 'SET_PROJECT_META', meta })}
            onBackToOverview={() => setProjectSection('overview')}
          />
        ) : null}
        </ProjectShell>
      </div>

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
        confirmLabel={confirmDialog.confirmLabel}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
      />

      {toast && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toast_error : styles.toast_success}`}>
          {toast.message}
        </div>
      )}
      {showMigration && (
        <MigrationPrompt
          localCount={localCount}
          onComplete={() => {
            setShowMigration(false);
            void projectStorage.listProjects().then(setProjectList);
          }}
          onDismiss={() => setShowMigration(false)}
        />
      )}
      {conflict && (
        <ConflictPrompt
          backend={conflict.backend}
          draft={conflict.draft}
          onUseBackend={async () => {
            await draftSync.adoptBackendVersion(conflict.backend);
            setProject(conflict.backend);
            dispatch({ type: 'LOAD_PROJECT', project: conflict.backend });
            setConflictPrompt(null);
          }}
          onUseDraft={async () => {
            setProject(conflict.draft.draft);
            dispatch({ type: 'LOAD_PROJECT', project: conflict.draft.draft });
            setConflictPrompt(null);
          }}
        />
      )}
      <RoleLibraryPanel
        open={roleLibraryOpen}
        onClose={() => setRoleLibraryOpen(false)}
        onRolesChanged={setRoles}
      />
    </div>
  );
}
