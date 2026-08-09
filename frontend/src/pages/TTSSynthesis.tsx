import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { createTranslator, useTranslation } from '../i18n';
import { GlobalControlBar } from '../components/TTSSynthesis/GlobalControlBar';
import { EdgeTTSPanel } from '../components/TTSSynthesis/EdgeTTSPanel';
import { MiMoTTSPanel, type MiMoMode } from '../components/TTSSynthesis/MiMoTTSPanel';
import { VoxCPMPanel, type VoxCPMMode } from '../components/TTSSynthesis/VoxCPMPanel';
import { TextInputPanel } from '../components/SegmentedTTS/TextInputPanel';
import { SegmentList } from '../components/SegmentedTTS/SegmentList';
import { BatchSynthesizeMenu, type BatchSynthesizeMode } from '../components/SegmentedTTS/BatchSynthesizeMenu';
import { chaptersNeedingSplit, selectProduceAllSegments, type ProduceAllRun } from '../services/produceAll';
import { ExportDialog } from '../components/SegmentedTTS/ExportDialog';
import { AdjustAudioDialog } from '../components/TTSSynthesis/AdjustAudioDialog';
import { ProjectSidebar } from '../components/SegmentedTTS/ProjectSidebar';
import { segmentedReducer, createInitialProject, getActiveChapter, migrateV1, type Action } from '../hooks/useSegmentedProject';
import { textSplitApi, ttsApi, mimoTtsApi, voxcpmApi, roleApi, segmentedProjectApi } from '../services/api';
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
import type { TTSRequest, TTSResult, VoiceProfile, SegmentedProject, Chapter, Segment, EngineParams, EdgeTTSParams, CosyVoiceParams, MiMoParams, VoxCPMParams, Role, RoleSnapshot, SegmentKind } from '../types';
import { segEffectiveParams, segHasOverride } from '../services/segmentShims';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { useConfirm } from '../components/ui/useConfirm';
import { SegmentRecordPanel } from '../components/SegmentedTTS/SegmentRecordPanel';

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
const SCRATCHPAD_PROJECT_ID = '__scratchpad__';

function toEdgeFormat(value: number) {
  return value >= 0 ? `+${value}%` : `${value}%`;
}

function endsWithSentencePeriod(text: string): boolean {
  return /[。．.](?:[”"』」》）)]*)\s*$/.test(text.trim());
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String(error || fallback);
}

function createScratchpadProject(): SegmentedProject {
  const _t = createTranslator('zh-CN');
  const project = createInitialProject();
  const now = new Date().toISOString();
  return {
    ...project,
    id: SCRATCHPAD_PROJECT_ID,
    name: _t('common.draftProject'),
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
  const { t } = useTranslation();
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
  const [mimoPresetVoice, setMimoPresetVoice] = useState(t('tts.defaultMimoPresetVoice'));
  const [mimoInstruction, setMimoInstruction] = useState('');
  const [mimoCloneVoiceId, setMimoCloneVoiceId] = useState('');

  // VoxCPM state（工作室只保留 clone/ultimate，design 在角色语音设计中提供）
  const [voxcpmMode, setVoxcpmMode] = useState<VoxCPMMode>('clone');
  const [voxcpmStyleControl, setVoxcpmStyleControl] = useState('');
  const [voxcpmPromptText, setVoxcpmPromptText] = useState('');
  const [voxcpmCfgValue, setVoxcpmCfgValue] = useState(2.0);
  const [voxcpmInferenceTimesteps, setVoxcpmInferenceTimesteps] = useState(10);
  // 禁用风格 tag（随 chapter.voice 持久化，合成时透传后端 SynthesizeParams.mute_tags）
  const [muteTags, setMuteTags] = useState(false);

  const [voices, setVoices] = useState<VoiceProfile[]>([]);

  // Project workbench state
  const [project, setProject] = useState<SegmentedProject>(createScratchpadProject);
  const [projectList, setProjectList] = useState<SegmentedProject[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustBusy, setAdjustBusy] = useState(false);
  // 录入片段音频（录音/上传）面板状态
  const [recordSegmentId, setRecordSegmentId] = useState<string | null>(null);
  const [recordBusy, setRecordBusy] = useState(false);
  const [srtDurationMode, setSrtDurationMode] = useState<'chapter' | 'global'>('chapter');
  const [generating, setGenerating] = useState(false);
  // “一键制作全本”实时进度；非 null 且 running 时在 ProjectShell contextBar 跨 section 可见。
  const [produceAllRun, setProduceAllRun] = useState<ProduceAllRun | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const [playingId, setPlayingId] = useState<string | undefined>();
  const [roles, setRoles] = useState<Role[]>([]);
  const [, setPreviewingRoleId] = useState<string | null>(null);
  const [roleLibraryOpen, setRoleLibraryOpen] = useState(false);
  const [compactMode, setCompactMode] = useState(true);
  // Multi-select mode for batch operations (batch delete)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(new Set());
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
  // Clear multi-selection when the active chapter changes
  useEffect(() => {
    setSelectedSegmentIds(new Set());
  }, [activeChapter.id]);
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
  // Ref to abort produce-all (一键制作全本) 段间停止
  const produceAllAbortRef = useRef(false);
  // Ref to read latest generating inside handleRegenerate (其 useCallback deps 刻意不含 generating)
  const generatingRef = useRef(generating);
  generatingRef.current = generating;
  // Ref to always have the latest handleRegenerate (avoids stale closure in confirm dialog)
  const handleRegenerateRef = useRef<(id: string, opts?: { force?: boolean; internal?: boolean }) => Promise<void>>(() => Promise.resolve());
  // 已解锁的录入片段：下次重新合成需带 force: true（后端可能仍认为其已录入）
  const unlockedRecordedRef = useRef<Set<string>>(new Set());

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
        showToast(t('tts.projectLoadFailedWithMode', { mode: storageMode }), 'error');
        onBackToProjects?.();
        return;
      }

      // 后端模式没有项目时，创建临时项目不保存；前端模式用 scratchpad
      if (!full) {
        if (storageMode === 'frontend') {
          full = scratchpad!;
        } else {
          full = createInitialProject(t);
          full.name = t('common.draftProject');
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
          const migratedDraft = migrateV1(localDraft.draft, t);
          setProject(migratedDraft);
          dispatch({ type: 'LOAD_PROJECT', project: migratedDraft });
          const ch = getActiveChapter(migratedDraft);
          if (ch) restoreChapterSettings(ch);
          return;
        }
        setConflictPrompt({ backend: full, draft: localDraft });
        return;
      }
      const migrated = migrateV1(full, t);
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
        showToast(t('tts.projectLoadFailedRetry'), 'error');
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

  const showToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'success') => {
    if (type === 'error') toast.error(message);
    else if (type === 'info') toast.info(message);
    else toast.success(message);
  }, [toast]);

  useEffect(() => { ttsApi.getVoices({ project_id: project.id }).then(setVoices).catch(() => {}); }, [refreshCounter, project.id]);

  useEffect(() => {
    roleApi.listRoles(project.id)
      .then(setRoles)
      .catch((error) => console.warn('Role list failed:', error));
  }, [project.id]);

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
    setMuteTags(v?.mute_tags ?? false);
    if (engine === 'edge_tts') {
      setEdgeVoice((v as EdgeTTSParams).voice || '');
      setEdgeRate(parseFloat((v as EdgeTTSParams).rate) || 0);
      setEdgeVolume(parseFloat((v as EdgeTTSParams).volume) || 0);
    } else if (engine === 'cosyvoice') {
      setSelectedVoiceId((v as CosyVoiceParams).voice_id || '');
      setParams({ language: ((v as CosyVoiceParams).language || 'Chinese') as TTSRequest['language'], speed: (v as CosyVoiceParams).speed ?? 1.0, volume: (v as CosyVoiceParams).volume ?? 80, pitch: (v as CosyVoiceParams).pitch ?? 1.0 });
    } else if (engine === 'mimo_tts') {
      setMimoMode(((v as MiMoParams).mode || 'preset') as MiMoMode);
      setMimoPresetVoice((v as MiMoParams).voice_id || t('tts.defaultMimoPresetVoice'));
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
    const fallbackName = t('tts.newChapterName', { n: project.chapters.length + 1 });
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
    showToast(t('tts.chapterDeleted', { name: ch?.name || t('tts.chapter') }));
  }, [project.chapters, project.active_chapter_id, dispatch, restoreChapterSettings, showToast]);

  const handleDeleteChapter = useCallback((chapterId: string) => {
    if (project.chapters.length <= 1) return;
    const ch = project.chapters.find(c => c.id === chapterId);
    const segCount = ch?.segments.length || 0;
    const audioCount = ch?.segments.filter(s => s.audio.current?.id).length || 0;
    setConfirmDialog({
      open: true, title: t('tts.deleteChapter'),
      message: t('tts.deleteChapterConfirm', { name: ch?.name || t('tts.thisChapter'), segments: segCount, audioPart: audioCount > 0 ? t('tts.audioCount', { count: audioCount }) : '' }),
      variant: 'warning', confirmLabel: t('common.delete'),
      onConfirm: () => { setConfirmDialog(prev => ({ ...prev, open: false })); doDeleteChapter(chapterId); },
    });
  }, [project.chapters, doDeleteChapter]);

  // ---- Segmented mode handlers ----

  /** Build EngineParams from current global state */
  const buildCurrentParams = useCallback((): EngineParams => {
    if (engine === 'edge_tts') {
      return { engine: 'edge_tts', voice: edgeVoice, rate: toEdgeFormat(edgeRate), volume: toEdgeFormat(edgeVolume), mute_tags: muteTags } as EdgeTTSParams;
    }
    if (engine === 'mimo_tts') {
      return { engine: 'mimo_tts', mode: mimoMode, voice_id: mimoMode === 'preset' ? mimoPresetVoice : mimoCloneVoiceId, instruction: mimoInstruction, mute_tags: muteTags } as MiMoParams;
    }
    if (engine === 'voxcpm') {
      return { engine: 'voxcpm', mode: voxcpmMode, voice_id: selectedVoiceId, style_control: voxcpmStyleControl, prompt_text: voxcpmPromptText, cfg_value: voxcpmCfgValue, inference_timesteps: voxcpmInferenceTimesteps, mute_tags: muteTags } as VoxCPMParams;
    }
    return {
      engine: 'cosyvoice', voice_id: selectedVoiceId,
      instruction: params.instruction || '', speed: params.speed ?? 1.0, volume: params.volume ?? 80,
      pitch: params.pitch ?? 1.0, language: params.language || 'Chinese',
      enable_ssml: params.enable_ssml ?? false, enable_markdown_filter: params.enable_markdown_filter ?? false,
      mute_tags: muteTags,
    };
  }, [engine, selectedVoiceId, params, edgeVoice, edgeRate, edgeVolume, mimoMode, mimoPresetVoice, mimoCloneVoiceId, mimoInstruction, voxcpmMode, voxcpmStyleControl, voxcpmPromptText, voxcpmCfgValue, voxcpmInferenceTimesteps, muteTags]);

  // 构建当前全局音色的 VoiceRef（用于新创建的 segment）
  const buildGlobalVoiceRef = useCallback((): import('../types').VoiceRef => {
    // Edge-TTS
    if (engine === 'edge_tts') {
      const parts = (edgeVoice || '').split('-');
      const name = (parts[parts.length - 1] || edgeVoice || '').replace(/Neural$|V\d+$/i, '');
      return { name: name || t('tts.noVoiceSelected'), source: 'global', voice_id: edgeVoice, engine: 'edge_tts' };
    }
    // MiMo
    if (engine === 'mimo_tts') {
      if (mimoMode === 'voiceclone') {
        const vObj = voices.find(v => v.id === mimoCloneVoiceId);
        return { name: vObj?.name || t('tts.customVoice'), source: 'global', voice_id: mimoCloneVoiceId, engine: 'mimo_tts' };
      }
      return { name: mimoPresetVoice || t('tts.noVoiceSelected'), source: 'global', voice_id: mimoPresetVoice, engine: 'mimo_tts' };
    }
    // VoxCPM
    if (engine === 'voxcpm') {
      const vObj = voices.find(v => v.id === selectedVoiceId);
      return { name: vObj?.name || t('tts.voxcpmVoice'), source: 'global', voice_id: selectedVoiceId, engine: 'voxcpm' };
    }
    // CosyVoice (default)
    const vObj = voices.find(v => {
      const voiceId = (v.voice_params?.[v.voice?.model || '']?.params as Record<string, unknown>)?.voice_id as string | undefined;
      return (voiceId || v.id) === selectedVoiceId;
    });
    return { name: vObj?.name || t('tts.cosyVoiceVoice'), source: 'global', voice_id: selectedVoiceId, engine: 'cosyvoice' };
  }, [engine, selectedVoiceId, voices, edgeVoice, mimoMode, mimoPresetVoice, mimoCloneVoiceId]);

  const resetGlobalSettings = useCallback(() => {
    setEngine('edge_tts');
    setSelectedVoiceId('');
    setEdgeVoice('');
    setEdgeRate(0);
    setEdgeVolume(0);
    setMimoMode('preset');
    setMimoPresetVoice(t('tts.defaultMimoPresetVoice'));
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
    const migrated = migrateV1(p, t);
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

  // Lighter reload after an in-place mutation (e.g. layer-sync action): refetch
  // project data without jumping to the overview section.
  const reloadProjectData = useCallback(async () => {
    if (!project?.id) return;
    const p = await projectStorage.getProject(project.id);
    if (!p) return;
    const migrated = migrateV1(p, t);
    // SELECT_CHAPTER intentionally doesn't bump updated_at (autosave skips it),
    // so the backend's active_chapter_id may be stale — the in-memory selection
    // is authoritative for a reload triggered by a local action.
    const currentActiveId = project.active_chapter_id;
    if (currentActiveId && migrated.chapters.some(c => c.id === currentActiveId)) {
      migrated.active_chapter_id = currentActiveId;
    }
    initialLoadDoneRef.current = false;
    dispatch({ type: 'LOAD_PROJECT', project: migrated });
    setProject(migrated);
    const ch = getActiveChapter(migrated);
    if (ch) restoreChapterSettings(ch);
    if (storageMode === 'backend') {
      await draftSync.adoptBackendVersion(migrated);
    }
    initialLoadDoneRef.current = true;
    lastSavedUpdatedAtRef.current = migrated.updated_at;
  }, [project?.id, project?.active_chapter_id, projectStorage, dispatch, restoreChapterSettings, storageMode, draftSync]);

  const handleAdjustAudio = useCallback(async (tempo: number, volumeDb: number) => {
    if (!project?.id || !activeChapter?.id) return;
    setAdjustBusy(true);
    try {
      const result = await segmentedProjectApi.adjustChapterAudio(project.id, activeChapter.id, {
        tempo: tempo === 1 ? undefined : tempo,
        volume_db: volumeDb === 0 ? undefined : volumeDb,
      });
      setAdjustOpen(false);
      showToast(t('adjustAudio.done', { count: result.adjusted }), 'success');
      await reloadProjectData();
    } catch (e) {
      showToast(t('tts.playbackFailed', { context: 'adjust', message: e instanceof Error ? e.message : String(e) }), 'error');
    } finally {
      setAdjustBusy(false);
    }
  }, [project?.id, activeChapter?.id, reloadProjectData, showToast, t]);

  const handleCreateProject = useCallback(async (name?: string, logo?: string | null) => {    const np = createInitialProject(t);
    np.name = name || t('tts.newProjectName', { n: projectList.filter(p => p.id !== SCRATCHPAD_PROJECT_ID).length + 1 });
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
      showToast(t('tts.cannotDeleteDraftProject'), 'error');
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
          const fallback = createInitialProject(t);
          if (storageMode === 'frontend') {
            fallback.id = SCRATCHPAD_PROJECT_ID;
            fallback.name = t('common.draftProject');
            await indexedDBStorage.saveProject(fallback, { mode: 'immediate' });
          } else {
            fallback.name = t('tts.temporaryProject');
          }
          setProjectList([fallback]);
          setProject(fallback);
          dispatch({ type: 'LOAD_PROJECT', project: fallback });
          resetGlobalSettings();
        }
      }
      showToast(t('tts.projectDeleted'));
    } catch (e) { console.error('Delete project failed:', e); showToast(t('tts.deleteFailed'), 'error'); }
  }, [project.id, projectStorage, storageMode, loadProjectById, dispatch, resetGlobalSettings, showToast]);

  const handleDeleteProject = useCallback((projectId = project.id) => {
    if (projectId === SCRATCHPAD_PROJECT_ID) {
      showToast(t('tts.cannotDeleteDraftProject'), 'error');
      return;
    }
    const target = projectList.find(p => p.id === projectId) || project;
    setConfirmDialog({
      open: true, title: t('tts.deleteProject'),
      message: t('tts.deleteProjectConfirm', { name: target.name }),
      variant: 'danger', confirmLabel: t('common.delete'),
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
    setConfirmDialog({
      open: true,
      title: t('tts.customVoice'),
      message: t('tts.confirmCustomVoice'),
      onConfirm: () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        // Take all params from the panel display (effective + local edits)
        const eff = segEffectiveParams(seg) as Record<string, unknown>;
        const fullParams = { ...eff, ...localParams };
        dispatch({ type: 'UPDATE_PARAMS', id, params: fullParams as Partial<EngineParams>, convertFromRole: true });
        // Clear existing audio — was generated with old params
        if (seg.status === 'ready') dispatch({ type: 'CLEAR_SEGMENT_AUDIO', id });
      },
    });
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
    // Block merging segments with in-flight synthesis — the late GENERATE_SUCCESS
    // would attach audio generated from the old text to the merged new text.
    if (cur.status === 'pending' || cur.status === 'queued' ||
        nxt.status === 'pending' || nxt.status === 'queued') {
      showToast(t('tts.mergeBlockedGenerating'), 'error');
      return;
    }
    const hasAudio = !!(cur.audio.current || nxt.audio.current);
    const doMerge = async () => {
      if (cur.audio.current?.id) { try { await deleteTTSResult(cur.audio.current.id); } catch { /* ignore */ } }
      if (nxt.audio.current?.id) { try { await deleteTTSResult(nxt.audio.current.id); } catch { /* ignore */ } }
      dispatch({ type: 'MERGE_SEGMENTS', id, direction });
    };
    if (hasAudio) {
      setConfirmDialog({
        open: true, title: t('tts.mergeSegments'),
        message: t('tts.mergeSegmentsConfirm', { direction: direction === 'down' ? t('tts.down') : t('tts.up') }),
        variant: 'warning', confirmLabel: t('common.continue'),
        onConfirm: () => { setConfirmDialog(prev => ({ ...prev, open: false })); doMerge(); },
      });
    } else {
      doMerge();
    }
  }, [activeChapter.segments, dispatch]);

  const handleSplit = useCallback((id: string, position: number) => {
    const seg = activeChapter.segments.find(s => s.id === id);
    if (!seg) return;
    const hasAudio = !!seg.audio.current;
    const doSplit = async () => {
      if (seg.audio.current?.id) { try { await deleteTTSResult(seg.audio.current.id); } catch { /* ignore */ } }
      dispatch({ type: 'SPLIT_SEGMENT', id, position });
    };
    if (hasAudio) {
      setConfirmDialog({
        open: true, title: t('tts.splitSegment'),
        message: t('tts.splitSegmentConfirm'),
        variant: 'warning', confirmLabel: t('common.continue'),
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
      if (seg.audio.current?.id) { try { await deleteTTSResult(seg.audio.current.id); } catch { /* ignore */ } }
      if (seg.audio.previous?.id) { try { await deleteTTSResult(seg.audio.previous.id); } catch { /* ignore */ } }
      dispatch({ type: 'DELETE_SEGMENT', id });
    };
    const preview = seg.text.length > 20 ? seg.text.slice(0, 20) + '…' : seg.text;
    const audioWarn = seg.audio.current ? t('tts.audioWillBeDeleted') : '';
    setConfirmDialog({
      open: true, title: t('tts.deleteSegment'),
      message: `${t('tts.deleteSegmentConfirm')}\n「${preview}」${audioWarn}`,
      variant: 'danger', confirmLabel: t('common.delete'),
      onConfirm: () => { setConfirmDialog(prev => ({ ...prev, open: false })); doDelete(); },
    });
  }, [activeChapter.segments, dispatch]);

  const handleToggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => {
      if (prev) setSelectedSegmentIds(new Set()); // clear selection when exiting selection mode
      return !prev;
    });
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedSegmentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    setSelectedSegmentIds(prev => (
      prev.size === activeChapter.segments.length
        ? new Set()
        : new Set(activeChapter.segments.map(s => s.id))
    ));
  }, [activeChapter.segments]);

  const handleDeleteSelected = useCallback(() => {
    if (generating || selectedSegmentIds.size === 0) return;
    const segs = activeChapter.segments.filter(s => selectedSegmentIds.has(s.id));
    if (segs.length === 0) return;
    const ids = segs.map(s => s.id);
    const withAudioCount = segs.filter(s =>
      s.audio.current?.id || s.audio.current?.path
      || s.audio.previous?.id || s.audio.previous?.path,
    ).length;
    const lines = [t('tts.deleteSelectedConfirmMessage', { count: segs.length })];
    if (withAudioCount > 0) {
      lines.push(t('tts.deleteSelectedAudioWarning', { count: withAudioCount }));
    }
    setConfirmDialog({
      open: true, title: t('tts.deleteSelectedConfirmTitle'),
      message: lines.join('\n'),
      variant: 'danger', confirmLabel: t('common.delete'),
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        for (const seg of segs) {
          if (seg.audio.current?.id) { try { await deleteTTSResult(seg.audio.current.id); } catch { /* ignore */ } }
          if (seg.audio.previous?.id) { try { await deleteTTSResult(seg.audio.previous.id); } catch { /* ignore */ } }
        }
        dispatch({ type: 'DELETE_SEGMENTS', ids });
        setSelectedSegmentIds(new Set());
      },
    });
  }, [generating, selectedSegmentIds, activeChapter.segments, dispatch, t]);

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
        open: true, title: t('tts.reSplit'),
        message: t('tts.reSplitConfirm', { segCount: activeChapter.segments.length, audioCount: oldAudioIds.length }),
        variant: 'warning', confirmLabel: t('common.continue'),
        onConfirm: () => { setConfirmDialog(prev => ({ ...prev, open: false })); apply(); },
      });
    } else {
      apply();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      showToast(exists ? t('tts.roleUpdated') : t('tts.roleCreated'));
    } catch (error) {
      console.error('Save role failed:', error);
      showToast(t('tts.roleSaveFailed'), 'error');
      throw error;
    }
  }, [roles, showToast]);

  const handleDeleteRole = useCallback(async (roleId: string) => {
    const target = roles.find(role => role.id === roleId);
    if (!target) return;
    setConfirmDialog({
      open: true,
      title: t('tts.removeRole'),
      message: t('tts.removeRoleConfirm', { name: target.name }),
      variant: 'warning',
      confirmLabel: t('common.delete'),
      onConfirm: () => {
        setConfirmDialog(prev => ({ ...prev, open: false }));
        // 仅从当前项目移除，不全局删除
        // 1. 清除所有引用该角色的 segment 的 role_id 和 role_snapshot
        dispatch({ type: 'CLEAR_ROLE_FROM_SEGMENTS', roleId });
        // 2. 从本地角色列表移除（不调用 roleApi.deleteRole）
        setRoles(prev => prev.filter(role => role.id !== roleId));
        showToast(t('tts.roleRemovedFromProject'));
      },
    });
  }, [roles, dispatch, showToast, t]);

  const handlePreviewRole = useCallback(async (role: RoleSnapshot, sampleText: string) => {
    setPreviewingRoleId(role.id);
    try {
      await playVoiceRolePreview(role, sampleText, t);
    } catch (error) {
      console.error('Preview role failed:', error);
      showToast(t('tts.previewFailedCheckService'), 'error');
    } finally {
      setPreviewingRoleId(null);
    }
  }, [showToast]);

  const handleRegenerate = useCallback(async (id: string, opts?: { force?: boolean; internal?: boolean }) => {
    // 全本/批量合成在跑时，禁止手动触发单段合成；循环内部调用传 internal=true 绕过。
    if (generatingRef.current && !opts?.internal) {
      showToast(t('tts.produceAllInProgress'), 'error');
      return;
    }
    // Project-wide lookup so batch flows (一键制作全本) can synthesize segments
    // in any chapter, not just the active one.
    let seg: Segment | undefined;
    let segChapter: Chapter | undefined;
    for (const c of project.chapters) {
      const found = c.segments.find(s => s.id === id);
      if (found) { seg = found; segChapter = c; break; }
    }
    if (!seg || !segChapter) return;
    const segIdx = segChapter.segments.findIndex(s => s.id === id);
    dispatch({ type: 'GENERATE_START', id });
    try {
      const hasVoiceLock = segHasOverride(seg);
      const currentRole = seg.role_id ? roles.find(r => r.id === seg.role_id) : undefined;

      // Resolve effective EngineParams with priority: custom > role > global
      let effectiveParams: EngineParams;
      let effectiveEngine: Engine;
      if (hasVoiceLock && seg.voice.source === 'custom') {
        effectiveParams = seg.voice.params as unknown as EngineParams;
        effectiveEngine = (effectiveParams.engine || seg.voice.engine) as Engine;
      } else if (currentRole?.voice) {
        effectiveParams = currentRole.voice;
        effectiveEngine = effectiveParams.engine as Engine;
      } else {
        effectiveParams = buildCurrentParams();
        effectiveEngine = effectiveParams.engine as Engine;
      }

      // Extract engine-specific params from discriminated union
      let effectiveEdgeVoice = '';
      let effectiveEdgeRate = '+0%';
      let effectiveEdgeVolume = '+0%';
      let voiceId = '';
      let speed = 1.0;
      let volume: number = 80;
      let pitch = 1.0;
      let instruction = '';
      let language = 'Chinese';
      let effectiveMimoMode = 'preset';
      let effectiveMimoPreset = '';
      let effectiveMimoCloneId = '';
      let effectiveMimoVoiceDesc = '';
      let effectiveMimoInstruction = '';
      let effectiveVoxcpmMode = 'tts';
      let effectiveVoxcpmCfg = 2.0;
      let effectiveVoxcpmTimesteps = 10;
      let effectiveVoxcpmDesc = '';
      let effectiveVoxcpmStyle = '';
      let effectiveVoxcpmPrompt = '';

      if (effectiveEngine === 'edge_tts') {
        const e = effectiveParams as EdgeTTSParams;
        effectiveEdgeVoice = e.voice || '';
        effectiveEdgeRate = e.rate || '+0%';
        effectiveEdgeVolume = e.volume || '+0%';
      } else if (effectiveEngine === 'mimo_tts') {
        const m = effectiveParams as MiMoParams;
        effectiveMimoMode = m.mode || 'preset';
        effectiveMimoInstruction = m.instruction || '';
        effectiveMimoVoiceDesc = m.voice_description || '';
        if (m.mode === 'preset') effectiveMimoPreset = m.voice_id || t('tts.defaultMimoPresetVoice');
        else effectiveMimoCloneId = m.voice_id || '';
      } else if (effectiveEngine === 'voxcpm') {
        const v = effectiveParams as VoxCPMParams;
        effectiveVoxcpmMode = v.mode || 'clone';
        voiceId = v.voice_id || '';
        effectiveVoxcpmCfg = v.cfg_value ?? 2.0;
        effectiveVoxcpmTimesteps = v.inference_timesteps ?? 10;
        effectiveVoxcpmDesc = v.voice_description || '';
        effectiveVoxcpmStyle = v.style_control || '';
        effectiveVoxcpmPrompt = v.prompt_text || '';
      } else {
        const c = effectiveParams as CosyVoiceParams;
        voiceId = c.voice_id || '';
        speed = c.speed ?? 1.0;
        volume = c.volume ?? 80;
        pitch = c.pitch ?? 1.0;
        language = c.language || 'Chinese';
        instruction = c.instruction || '';
      }

      const textToSend = seg.text;

      // Voice identifier for display (may be updated below for design detection)
      let usedVoiceId = effectiveEngine === 'edge_tts' ? effectiveEdgeVoice
        : effectiveEngine === 'mimo_tts' ? (effectiveMimoMode === 'preset' ? effectiveMimoPreset : effectiveMimoCloneId)
        : effectiveEngine === 'voxcpm' ? voiceId
        : voiceId;

      // Use effectiveParams directly as the snapshot (already EngineParams)
      // 交叉 Record<string, unknown> 仅为允许下面按 key 写入 design 检测覆盖（mimo_mode 等运行时字段），行为不变
      const updatedParams = effectiveParams as EngineParams & Record<string, unknown>;

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
        // 禁用风格 tag：透传后端 SynthesizeParams.mute_tags（clone 音色建议开启）
        if (effectiveParams.mute_tags) requestParams.mute_tags = true;
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
          project.id, segChapter.id, seg.id, {
            params: requestParams,
            text: textToSend,
            ssml: undefined,
            keep_previous: true,
            ...(opts?.force ? { force: true } : {}),
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
            duration_sec: updatedSeg?.audio.current?.duration_sec ?? updatedSeg?.audio.duration_sec,
          generated_params: updatedSeg?.generated_params,
          origin: updatedSeg?.audio.current?.origin ?? 'tts',
        });
        unlockedRecordedRef.current.delete(id);
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
        // 原代码引用了未定义的 sp；按上下文恢复为 cosyvoice 的 effectiveParams（该分支原本会因 ReferenceError 崩溃）
        const sp = effectiveParams as CosyVoiceParams;
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
      dispatch({ type: 'GENERATE_SUCCESS', id, audio_id: audioId, duration_sec: duration, generated_voice_id: usedVoiceId, updated_params: updatedParams, origin: 'tts' });
      unlockedRecordedRef.current.delete(id);
    } catch (error: unknown) {
      dispatch({ type: 'GENERATE_FAIL', id, error: getErrorMessage(error, t('common.generationFailed')) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.chapters, dispatch, buildCurrentParams, showToast, roles]);

  // Keep ref in sync
  handleRegenerateRef.current = handleRegenerate;

  // 录入音频锁定保护：已录入（recorded）的片段点击重新合成时提示先解锁；
  // 解锁后的首次重新合成带 force: true（后端可能仍标记为 recorded）
  const handleRegenerateClick = useCallback((id: string) => {
    const seg = activeChapter.segments.find(s => s.id === id);
    if (seg?.audio.current?.origin === 'recorded') {
      showToast(t('segment.segmentRecord.regenerateBlocked'), 'error');
      return;
    }
    void handleRegenerate(id, { force: unlockedRecordedRef.current.has(id) });
  }, [activeChapter.segments, handleRegenerate, showToast, t]);

  const handleUnlockSegmentAudio = useCallback(async (id: string) => {
    const ok = await confirm({
      title: t('segment.segmentRecord.unlockConfirmTitle'),
      message: t('segment.segmentRecord.unlockConfirmMessage'),
      variant: 'warning',
    });
    if (!ok) return;
    unlockedRecordedRef.current.add(id);
    dispatch({ type: 'UNLOCK_SEGMENT_AUDIO', id });
  }, [confirm, dispatch, t]);

  // 录入面板确认：前端模式存 IndexedDB，后端模式上传到项目资产目录
  const handleRecordConfirm = useCallback(async (audio: File | Blob, durationSec?: number) => {
    const segId = recordSegmentId;
    const seg = activeChapter.segments.find(s => s.id === segId);
    if (!seg || !segId) return;
    setRecordBusy(true);
    try {
      if (storageMode === 'backend' && project?.id) {
        const updated = await segmentedProjectApi.uploadSegmentAudio(project.id, activeChapter.id, segId, audio, durationSec);
        // 与合成流程一致：从返回的 ProjectDetail 中外科手术式同步该片段
        const updatedSeg = updated.chapters
          ?.flatMap((c: Chapter) => c.segments ?? [])
          ?.find((s: Segment) => s.id === segId);
        // 片段音频切换到后端路径后，清理遗留的 IndexedDB 音频
        if (seg.audio.current?.id) { try { await deleteTTSResult(seg.audio.current.id); } catch { /* ignore */ } }
        if (seg.audio.previous?.id) { try { await deleteTTSResult(seg.audio.previous.id); } catch { /* ignore */ } }
        dispatch({
          type: 'RECORD_SUCCESS',
          id: segId,
          audio_path: updatedSeg?.audio.current?.path,
          duration_sec: updatedSeg?.audio.current?.duration_sec ?? durationSec,
          audio_format: updatedSeg?.audio.format,
        });
      } else {
        const MIME_TO_FMT: Record<string, string> = {
          'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
          'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
        };
        const fmt = MIME_TO_FMT[audio.type] || audio.type.split('/')[1] || 'webm';
        const audioId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        await saveTTSResult({ id: audioId, text: seg.text, voice_id: '', voice_name: '', audioBlob: audio, audio_format: fmt, speed: 1, volume: 80, pitch: 1, instruction: '', language: 'Chinese', created_at: new Date().toISOString(), source: 'segmented_record' });
        dispatch({ type: 'RECORD_SUCCESS', id: segId, audio_id: audioId, duration_sec: durationSec, audio_format: fmt });
      }
      unlockedRecordedRef.current.delete(segId);
      setRecordSegmentId(null);
    } catch (error) {
      showToast(getErrorMessage(error, t('segment.segmentRecord.saveFailed')), 'error');
    } finally {
      setRecordBusy(false);
    }
  }, [recordSegmentId, activeChapter, storageMode, project?.id, dispatch, showToast, t]);

  const handleRegenerateAll = useCallback(async (mode: BatchSynthesizeMode = 'all') => {
    if (generating) return;

    // Segments to regenerate: idle, failed, OR (mode 'all' only) ready but NOT voice-locked
    const toRegenerate = activeChapter.segments.filter(s => {
      // 已录入音频的片段处于锁定状态，批量合成一律跳过（与后端 force=false 行为一致）
      if (s.audio.current?.origin === 'recorded') return false;
      if (s.status === 'idle' || s.status === 'failed') return true;
      if (mode === 'all' && s.status === 'ready') {
        const hasVoiceLock = s.voice.source === 'custom';
        return !hasVoiceLock; // regenerate ready segments that follow global voice
      }
      return false; // skip 'pending'/'queued' (and 'ready' in 'unsynthesized' mode)
    });

    if (toRegenerate.length === 0) {
      showToast(t('tts.noSegmentsToRegenerate'));
      return;
    }

    const existingAudio = toRegenerate.filter(s => s.audio.current?.id);

    // Show confirmation
    const lockedCount = activeChapter.segments.filter(s => s.status === 'ready' && s.voice.source === 'custom').length;
    const lines = [
      t('tts.willRegenerateN', { count: toRegenerate.length }),
    ];
    // 'unsynthesized' only targets idle/failed segments — there is no existing audio to delete
    if (mode === 'all' && existingAudio.length > 0) {
      lines.push(t('tts.nExistingAudioWillBeDeleted', { count: existingAudio.length }));
    }
    if (mode === 'all' && lockedCount > 0) {
      lines.push(t('tts.nLockedSegmentsUnchanged', { count: lockedCount }));
    }

    setConfirmDialog({
      open: true,
      title: t(mode === 'all' ? 'tts.regenerateAll' : 'tts.synthesizeUnsynthesized'),
      message: lines.join('\n'),
      variant: 'warning',
      confirmLabel: t(mode === 'all' ? 'tts.regenerate' : 'segment.segmentRow.generate'),
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

      // Step 3: Generate sequentially to avoid rate-limiting external TTS services
      let i = 0;
      while (i < toRegenerate.length) {
        await handleRegenerateRef.current(toRegenerate[i++].id, { internal: true });
      }
      showToast(t('tts.allGenerationComplete'));
    } catch (e) {
      console.error('Regenerate all failed:', e);
      showToast(t('tts.partialGenerationFailed'), 'error');
    } finally {
      setGenerating(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, showToast]);

  const handleProduceAll = useCallback(async (mode: BatchSynthesizeMode) => {
    if (generating) return;
    setGenerating(true);
    produceAllAbortRef.current = false;
    try {
      // Phase 1: 补切--给无 segment 的章节按规则切分段落（复用 chapter 音色）。
      const toSplit = chaptersNeedingSplit(project.chapters);
      if (toSplit.length > 0) {
        for (const { chapterId, text } of toSplit) {
          try {
            await segmentedProjectApi.splitChapter(project.id, chapterId, {
              mode: 'rule', text, replace_strategy: 'replace_chapter_segments',
            });
          } catch (e) {
            console.error(`[produceAll] split chapter ${chapterId} failed`, e);
          }
        }
        await reloadProjectData();
        // 等 React 重渲染刷新 handleRegenerateRef，使新段可被全项目查找。
        await new Promise((r) => setTimeout(r, 0));
      }

      // 暂停自动保存：逐段合成会 dispatch 状态更新，若中途触发全量 PUT，
      // 会用陈旧内存态覆盖刚合成段的音频（reconcile 还会删掉刚写的文件）。
      // 此时还未开始合成，状态与后端一致，暂停安全；最后 reload 恢复。
      initialLoadDoneRef.current = false;

      // Phase 2: 拉最新项目态收集目标段。
      const raw = await projectStorage.getProject(project.id);
      if (!raw) { showToast(t('tts.projectLoadFailedRetry'), 'error'); return; }
      const fresh = migrateV1(raw, t);
      const targets = selectProduceAllSegments(fresh.chapters, mode);
      if (targets.length === 0) {
        showToast(t('tts.noSegmentsToRegenerate'));
        return;
      }

      // Phase 3: 顺序合成，复用 handleRegenerate（重构后全项目可查段），沿用每段已有音色。
      // 段间停止：每次迭代前检查 abort flag，当前段跑完即停；停止后已合成段保留、未合成段保持 idle/failed。
      setProduceAllRun({ running: true, mode, total: targets.length, done: 0, startedAt: Date.now() });
      let doneCount = 0;
      for (const segId of targets) {
        if (produceAllAbortRef.current) break;
        const chName = fresh.chapters.find(c => c.segments.some(s => s.id === segId))?.name;
        setProduceAllRun(prev => prev ? { ...prev, currentSegmentId: segId, currentChapterName: chName } : prev);
        await handleRegenerateRef.current(segId, { internal: true });
        doneCount += 1;
        setProduceAllRun(prev => prev ? { ...prev, done: doneCount } : prev);
      }
      if (produceAllAbortRef.current) {
        showToast(t('tts.produceAllStopped', { done: doneCount, total: targets.length }), 'info');
      } else {
        showToast(t('tts.allGenerationComplete'));
      }
    } catch (e) {
      console.error('[produceAll] failed', e);
      showToast(t('tts.partialGenerationFailed'), 'error');
    } finally {
      setGenerating(false);
      setProduceAllRun(null);
      // 恢复 autosave（reloadProjectData 内部置 ref=true）+ 拉回后端权威态。
      await reloadProjectData();
    }
  }, [generating, project.id, project.chapters, projectStorage, reloadProjectData, showToast, t]);

  const handleStopProduceAll = useCallback(() => {
    produceAllAbortRef.current = true;
  }, []);

  const handleAnnotateSSML = useCallback(async (idsArg?: string[]) => {
    const ids = idsArg ?? activeChapter.segments.filter(s => (segEffectiveParams(s).engine as string) === 'cosyvoice').map(s => s.id);
    const targetSegs = activeChapter.segments.filter(s => ids.includes(s.id));
    if (!targetSegs.length) return;
    try {
      const result = await textSplitApi.ssmlAnnotate(targetSegs.map(s => s.text));
      const updates = targetSegs.map((s, i) => ({ id: s.id, ssml: result.annotations[i]?.ssml ?? `<speak>${s.text}</speak>` }));
      dispatch({ type: 'BATCH_SET_SSML', updates, by_llm: true });
      for (const s of targetSegs) { dispatch({ type: 'UPDATE_PARAMS', id: s.id, params: { enable_ssml: true } }); }
      showToast(t('tts.ssmlAnnotatedForN', { count: targetSegs.length }));
    } catch { showToast(t('tts.ssmlAnnotateFailed'), 'error'); }
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
      showToast(t('tts.segmentNoAudio'), 'error');
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
      showToast(t('tts.playbackFailed', { context: ctx, message: msg }), 'error');
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
        if (blob.size < 100) throw new Error(t('tts.audioEmpty', { size: blob.size }));
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
        showToast(t('tts.audioOnBackendSwitchMode'), 'error');
        return;
      }
      const blob = await getTTSAudioBlob(seg.current_audio_id!);
      if (!blob) {
        showToast(t('tts.localAudioNotFound'), 'error');
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
      const blob = await getTTSAudioBlob(seg.current_audio_id!);
      if (!blob) return;
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });
      const { base64: trimmedBase64, trimmedMs } = await trimBase64AudioSilence(base64);
      if (trimmedMs <= 0) { showToast(t('tts.noExcessSilence')); return; }

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
      const currentOrigin = seg.audio.current?.origin;
      await saveTTSResult({ id: newId, text: seg.text, voice_id: (eff.voice_id as string) || '', voice_name: '', audioBlob: trimmedBlob, audio_format: 'wav', speed: (eff.speed as number) ?? 1, volume: (eff.volume as number) ?? 80, pitch: (eff.pitch as number) ?? 1, instruction: (eff.instruction as string) || '', language: (eff.language as string) || 'Chinese', created_at: new Date().toISOString(), source: currentOrigin === 'recorded' ? 'segmented_record' : 'segmented_tts' });
      try { await deleteTTSResult(seg.current_audio_id!); } catch { /* ignore */ }
      dispatch({ type: 'GENERATE_SUCCESS', id, audio_id: newId, duration_sec: newDuration, origin: currentOrigin });
      showToast(t('tts.trimmedSilence', { ms: trimmedMs }));
    } catch (e) { console.error('Trim failed:', e); showToast(t('tts.trimFailed'), 'error'); }
  }, [activeChapter.segments, dispatch, showToast]);

  // 一键导出所有章节的 mp3 + srt 到项目导出目录（仅 backend 存储模式）
  const handleExportAll = useCallback(async () => {
    if (storageMode !== 'backend' || !project?.id || isScratchpadProject) return;
    try {
      const result = await segmentedProjectApi.exportAllChapters(project.id);
      const dir = result.exported[0]
        ? result.exported[0].audio_path.replace(/[/\\][^/\\]+$/, '')
        : '';
      showToast(t('studio.exportAllSuccess', { count: result.count, dir }));
    } catch (error: unknown) {
      // A8 错误契约：detail 为 {code, message, ...}
      const resp = (error as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
      const detail = resp?.data?.detail;
      const code = (typeof detail === 'object' && detail !== null && 'code' in detail)
        ? (detail as { code: string }).code : undefined;
      if (resp?.status === 409 && code === 'chapters_incomplete') {
        const chapters = (detail as { chapters?: string[] }).chapters ?? [];
        const missingCounts = (detail as { missing_counts?: Record<string, number> }).missing_counts ?? {};
        // 章节名后附缺失段数（后端 missing_counts），让用户知道每章还差几段。
        const chaptersText = chapters
          .map((c) => (missingCounts[c] ? `${c}(缺${missingCounts[c]}段)` : c))
          .join('、');
        showToast(t('studio.exportAllIncomplete', { chapters: chaptersText }), 'error');
      } else if (resp?.status === 409 && code === 'export_directory_not_configured') {
        showToast(t('studio.exportAllNoDir'), 'error');
      } else {
        showToast(getErrorMessage(error, t('common.generationFailed')), 'error');
      }
    }
  }, [storageMode, project?.id, isScratchpadProject, showToast, t]);

  const selectedVoice = voices.find(v => {
    const voiceId = (v.voice_params?.[v.voice?.model || '']?.params as Record<string, unknown>)?.voice_id as string | undefined;
    return (voiceId || v.id) === selectedVoiceId;
  });
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
          projectSubtitle={isScratchpadProject ? t('tts.quickDraft') : t('tts.projectChaptered')}
          projectId={project.id}
          activeSection={projectSection}
          onProjectChanged={() => { void reloadProjectData(); }}
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
          onMoveChapter={(id, direction) => dispatch({ type: 'MOVE_CHAPTER', id, direction })}
          rightPanelCollapsed={projectSection === 'studio' ? rightPanelCollapsed : true}
          onSectionChange={setProjectSection}
          onBackToProjects={onBackToProjects}
          produceAllRun={produceAllRun}
          onStopProduceAll={handleStopProduceAll}
        >
        {projectSection === 'studio' ? (
        <VoiceStudioLayout
          segmentCount={activeChapter.segments.length}
          generatedCount={generatedSegmentCount}
          durationSec={activeChapterDuration}
          remotionPath={project.remotion_project_path}
          onExport={() => setExportOpen(true)}
          onExportAll={storageMode === 'backend' && !isScratchpadProject ? () => { void handleExportAll(); } : undefined}
          onProduceAll={storageMode === 'backend' && !isScratchpadProject ? (mode) => { void handleProduceAll(mode); } : undefined}
          produceAllDisabled={generating}
          onAdjustAudio={storageMode === 'backend' && !isScratchpadProject ? () => setAdjustOpen(true) : undefined}
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
                    <label className={styles.sidebarMuteTags} title={t("ariaLabels.styleTagHint")}>
                      <input
                        type="checkbox"
                        checked={muteTags}
                        onChange={e => setMuteTags(e.target.checked)}
                      />
                      禁用风格 tag（clone 音色建议开启）
                    </label>
                    <button
                      type="button"
                      className={styles.sidebarApplyBtn}
                      onClick={() => {
                        const params = buildCurrentParams();
                        setConfirmDialog({
                          open: true,
                          title: t('studio.applyVoice'),
                          message: t('studio.applyVoiceHelp'),
                          confirmLabel: t('studio.applyVoice'),
                          onConfirm: () => {
                            setConfirmDialog(prev => ({ ...prev, open: false }));
                            dispatch({ type: 'SET_ALL_CHAPTERS_PARAMS', params });
                            showToast(t('studio.voiceApplied'));
                          },
                        });
                      }}
                      title={t('studio.applyVoiceHelp')}
                    >
                      {t('studio.applyVoice')}
                    </button>
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
                <BatchSynthesizeMenu disabled={generating} onSelect={(mode) => void handleRegenerateAll(mode)} />
                <button type="button" className={styles.productionBtnSecondary} onClick={playAllActive ? handleStopAll : handlePlayAll}>
                  {playAllActive ? t('tts.stop') : `▶ ${t('studio.playAll')}`}
                </button>
                {selectionMode && (
                  <>
                    <button type="button" className={styles.productionBtnSecondary} onClick={handleToggleSelectAll}>
                      {activeChapter.segments.length > 0 && selectedSegmentIds.size === activeChapter.segments.length
                        ? t('studio.deselectAll')
                        : t('studio.selectAll')}
                    </button>
                    <button
                      type="button"
                      className={styles.productionBtnDanger}
                      onClick={handleDeleteSelected}
                      disabled={selectedSegmentIds.size === 0 || generating}
                    >
                      {t('studio.deleteSelected', { count: selectedSegmentIds.size })}
                    </button>
                  </>
                )}
                {isScratchpadProject && <span className={styles.scratchpadBadge}>{t('projectHub.tempProject')}</span>}
                <span className={styles.segmentedStats}>
                  {activeChapter.segments.length} {t('projectOverview.segments')} · {activeChapter.segments.reduce((a, s) => a + (s.audio.duration_sec ?? 0), 0).toFixed(1)}s
                  {activeChapter.segments.filter(s => s.status === 'ready').length > 0 && ` · ${activeChapter.segments.filter(s => s.status === 'ready').length}/${activeChapter.segments.length} ${t('projectOverview.generated')}`}
                </span>
                {engine === 'cosyvoice' && (
                  <button className={styles.segmentedActionBtn} onClick={() => handleAnnotateSSML()}>{t('tts.annotate')}</button>
                )}
              </div>
              <div className={styles.productionRight}>
                <button
                  type="button"
                  className={`${styles.toolbarPill} ${selectionMode ? styles.toolbarPillActive : ''}`}
                  onClick={handleToggleSelectionMode}
                >
                  {selectionMode ? t('studio.exitSelectMode') : t('studio.selectMode')}
                </button>
                <div className={styles.toolbarGroup} aria-label={t('tts.segmentTimeDisplay')}>
                  <button className={`${styles.toolbarPill} ${srtDurationMode === 'chapter' ? styles.toolbarPillActive : ''}`} onClick={() => setSrtDurationMode('chapter')}>{t('studio.chapterTime')}</button>
                  <button className={`${styles.toolbarPill} ${srtDurationMode === 'global' ? styles.toolbarPillActive : ''}`} onClick={() => setSrtDurationMode('global')}>{t('studio.globalTime')}</button>
                </div>
                <div className={styles.viewToggle} aria-label={t('tts.segmentCardDisplay')}>
                  <button className={`${styles.viewToggleBtn} ${compactMode ? styles.viewToggleActive : ''}`}
                    onClick={() => setCompactMode(true)}>{t('studio.compactView')}</button>
                  <button className={`${styles.viewToggleBtn} ${!compactMode ? styles.viewToggleActive : ''}`}
                    onClick={() => setCompactMode(false)}>{t('studio.expandedView')}</button>
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
                chapterVoice={activeChapter.voice}
                selectionMode={selectionMode}
                selectedIds={selectedSegmentIds}
                onToggleSelect={handleToggleSelect}
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
                onRegenerate={handleRegenerateClick}
                onRecord={(id) => setRecordSegmentId(id)}
                onUnlockAudio={handleUnlockSegmentAudio}
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

              {adjustOpen && (
                <AdjustAudioDialog
                  readyCount={generatedSegmentCount}
                  currentAdjust={activeChapter.audio_adjust ?? null}
                  busy={adjustBusy}
                  onCancel={() => setAdjustOpen(false)}
                  onConfirm={(tempo, volumeDb) => { void handleAdjustAudio(tempo, volumeDb); }}
                />
              )}
              {exportOpen && (
                <ExportDialog
                  projectId={project.id}
                  chapterId={activeChapter.id}
                  segments={activeChapter.segments}
                  chapterDesignTitle={activeChapter.design_title || activeChapter.name}
                  remotionProjectPath={project.remotion_project_path}
                  exportDirectory={project.configs?.export_directory ?? null}
                  defaultName={activeChapter.design_title || activeChapter.name}
                  globalStartOffset={chapterStartOffset}
                  onClose={() => setExportOpen(false)}
                />
              )}
              {recordSegmentId && (() => {
                const recordSeg = activeChapter.segments.find(s => s.id === recordSegmentId);
                if (!recordSeg) return null;
                return (
                  <SegmentRecordPanel
                    segmentText={recordSeg.text}
                    hasExistingAudio={!!(recordSeg.audio.current?.id || recordSeg.audio.current?.path)}
                    busy={recordBusy}
                    onConfirm={handleRecordConfirm}
                    onClose={() => setRecordSegmentId(null)}
                  />
                );
              })()}
            </div>
          </div>
        </div>
        </VoiceStudioLayout>
        ) : projectSection === 'library' ? (
          <ProjectLibrary
            projectId={project.id}
            projectName={project.name}
            chapters={project.chapters}
            activeChapterId={project.active_chapter_id}
            sourceDocument={project.source_document}
            narrationScript={project.narration_script}
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
            onUpdateNarrationScript={(text) => dispatch({ type: 'SET_NARRATION_SCRIPT', text })}
            onAddChapter={handleAddChapter}
            onDeleteChapter={handleDeleteChapter}
            onProjectChanged={() => { void reloadProjectData(); }}
            onEnterStudio={(chapterId) => {
              handleSelectChapter(chapterId);              setProjectSection('studio');
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
            onEnterStudio={(chapterId) => {
              if (chapterId) handleSelectChapter(chapterId);
              setProjectSection('studio');
            }}
            onOpenVoices={() => setProjectSection('voices')}
          />
        ) : projectSection === 'settings' ? (
          <ProjectSettings
            projectName={project.name}
            remotionPath={project.remotion_project_path}
            storageMode={storageMode}
            chapterCount={project.chapters.length}
            projectDescription={project.configs?.description ?? null}
            exportDirectory={project.configs?.export_directory ?? null}
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
        projectId={project.id}
      />
    </div>
  );
}
