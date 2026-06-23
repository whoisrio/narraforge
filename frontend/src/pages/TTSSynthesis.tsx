import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
import { saveTTSResult, deleteTTSResult, getTTSAudioBlob } from '../services/indexedDB';
import { trimBase64AudioSilence } from '../services/audioTrim';
import { indexedDBStorage, type SegmentedProjectStorage } from '../services/segmentedProjectStorage';
import { backendStorage } from '../services/backendSegmentedProjectStorage';
import { useSegmentedDraftSync } from '../hooks/useSegmentedDraftSync';
import { getDraft, deleteDraft } from '../services/segmentedDraftStore';
import { MigrationPrompt } from '../components/SegmentedTTS/MigrationPrompt';
import { ConflictPrompt } from '../components/SegmentedTTS/ConflictPrompt';
import { useStorageMode } from '../hooks/useStorageMode';
import { useVoiceRefresh } from '../hooks/useVoiceRefresh';
import type { TTSRequest, TTSResult, VoiceProfile, SegmentedProject, Chapter, SegmentEngineParams, Role, RoleSnapshot, SegmentKind } from '../types';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CollapsiblePanel } from '../components/ui/CollapsiblePanel';
import { RoleLibraryPanel } from '../components/SegmentedTTS/RoleLibraryPanel';
import { RolePicker } from '../components/SegmentedTTS/RolePicker';
import { ChatSegmentView } from '../components/SegmentedTTS/ChatSegmentView';
import { ProjectShell, type ProjectSectionId } from '../components/ProjectShell/ProjectShell';
import { ProjectLibrary } from '../components/ProjectLibrary/ProjectLibrary';
import { ProjectVoices } from '../components/ProjectVoices/ProjectVoices';
import { VoiceStudioLayout } from '../components/VoiceStudio/VoiceStudioLayout';
import { assignRoleForSplitItem, type SplitVoiceMode } from '../services/segmentKindInference';
import { createVoiceRoleDraft, roleVoiceLabelFromParams } from '../services/voiceRoleDefaults';
import styles from './TTSSynthesis.module.css';

type Engine = 'cosyvoice' | 'edge_tts' | 'mimo_tts' | 'voxcpm';

const SCRATCHPAD_PROJECT_ID = '__scratchpad__';

function toEdgeFormat(value: number) {
  return value >= 0 ? `+${value}%` : `${value}%`;
}

function endsWithSentencePeriod(text: string): boolean {
  return /[。．\.](?:[”"』」》）\)]*)\s*$/.test(text.trim());
}

function createScratchpadProject(): SegmentedProject {
  const project = createInitialProject();
  const now = new Date().toISOString();
  return {
    ...project,
    id: SCRATCHPAD_PROJECT_ID,
    name: '草稿项目',
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

  // VoxCPM state
  const [voxcpmMode, setVoxcpmMode] = useState<VoxCPMMode>('tts');
  const [voxcpmVoiceDescription, setVoxcpmVoiceDescription] = useState('');
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
  const [previewingRoleId, setPreviewingRoleId] = useState<string | null>(null);
  const [roleLibraryOpen, setRoleLibraryOpen] = useState(false);
  const [compactMode, setCompactMode] = useState(true);
  const [segmentViewMode, setSegmentViewMode] = useState<'list' | 'dialogue'>('list');
  const [projectSection, setProjectSection] = useState<ProjectSectionId>('studio');
  const [panelOpen, setPanelOpen] = useState(true);
  const [projectSidebarCollapsed, setProjectSidebarCollapsed] = useState(() => localStorage.getItem('narraforge.projectSidebarCollapsed') === 'true');
  const isScratchpadProject = project.id === SCRATCHPAD_PROJECT_ID;

  const [isPaused, setIsPaused] = useState(false);
  const [playAllActive, setPlayAllActive] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean; title: string; message: string;
    variant?: 'warning' | 'danger';
    confirmLabel?: string;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });

  // Derived: active chapter
  const activeChapter = useMemo(() => getActiveChapter(project)!, [project]);
  // Sum total duration of all chapters BEFORE the active one (used as time offset)
  const chapterStartOffset = useMemo(() => {
    const activeIdx = project.chapters.findIndex(c => c.id === activeChapter.id);
    if (activeIdx <= 0) return 0;
    let total = 0;
    for (let i = 0; i < activeIdx; i++) {
      for (const seg of project.chapters[i].segments) {
        if (seg.status === 'ready' && seg.duration_sec) total += seg.duration_sec;
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
      const rawList = await projectStorage.listProjects();
      let scratchpad = rawList.find(p => p.id === SCRATCHPAD_PROJECT_ID);

      if (!scratchpad) {
        scratchpad = createScratchpadProject();
        await projectStorage.saveProject(scratchpad, { mode: 'immediate' });
      }

      const list = sortProjectsWithScratchpad([
        scratchpad,
        ...rawList.filter(p => p.id !== SCRATCHPAD_PROJECT_ID),
      ]);
      setProjectList(list);

      let full = await projectStorage.getProject(initialProjectId ?? SCRATCHPAD_PROJECT_ID);
      if (!full && initialProjectId) full = await projectStorage.getProject(SCRATCHPAD_PROJECT_ID);
      if (!full) full = scratchpad;
      const localDraft = await getDraft(full.id);
      if (localDraft && localDraft.base_updated_at && localDraft.base_updated_at < full.updated_at && localDraft.dirty) {
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
      setProject(migrated);
      dispatch({ type: 'LOAD_PROJECT', project: migrated });
      const ch = getActiveChapter(migrated);
      if (ch) restoreChapterSettings(ch);
      await draftSync.adoptBackendVersion(migrated);

      if (storageMode === 'backend') {
        const localProjects = await indexedDBStorage.listProjects();
        const migratableCount = localProjects.filter(p => p.id !== SCRATCHPAD_PROJECT_ID).length;
        if (migratableCount > 0) {
          setLocalCount(migratableCount);
          setShowMigration(true);
        }
      }
    })().catch((e) => console.warn('Project load failed:', e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageMode, initialProjectId]);

  // Auto-save: debounce PUT in backend mode; IndexedDB direct in frontend mode
  useEffect(() => {
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
        voxcpm_mode: voxcpmMode, voxcpm_voice_description: voxcpmVoiceDescription,
        voxcpm_style_control: voxcpmStyleControl, voxcpm_prompt_text: voxcpmPromptText,
        voxcpm_cfg_value: voxcpmCfgValue, voxcpm_inference_timesteps: voxcpmInferenceTimesteps,
        language: params.language, speed: params.speed,
        volume: params.volume, pitch: params.pitch, panel_open: panelOpen,
      },
    });
  }, [engine, selectedVoiceId, edgeVoice, edgeRate, edgeVolume, mimoMode, mimoPresetVoice, mimoInstruction, mimoCloneVoiceId, voxcpmMode, voxcpmVoiceDescription, voxcpmStyleControl, voxcpmPromptText, voxcpmCfgValue, voxcpmInferenceTimesteps, params.language, params.speed, params.volume, params.pitch, panelOpen, dispatch]);

  const showToast = useCallback((message: string, type: 'error' | 'success' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => { ttsApi.getVoices().then(setVoices).catch(() => {}); }, [refreshCounter]);

  useEffect(() => {
    roleApi.listRoles()
      .then(setRoles)
      .catch((error) => console.warn('Role list failed:', error));
  }, []);

  const projectStorage: SegmentedProjectStorage = storageMode === 'backend' ? backendStorage : indexedDBStorage;
  const draftSync = useSegmentedDraftSync(project?.id ?? null, { storage: projectStorage });
  const [showMigration, setShowMigration] = useState(false);
  const [localCount, setLocalCount] = useState(0);
  const [conflict, setConflictPrompt] = useState<{ backend: SegmentedProject; draft: any } | null>(null);

  // ---- Chapter management ----

  /** Restore global state from a chapter's saved settings */
  const restoreChapterSettings = useCallback((ch: Chapter) => {
    if (ch.engine) setEngine(ch.engine as Engine); else setEngine('edge_tts');
    setSelectedVoiceId(ch.voice_id || '');
    setEdgeVoice(ch.edge_voice || '');
    setEdgeRate(ch.edge_rate ?? 0);
    setEdgeVolume(ch.edge_volume ?? 0);
    setMimoMode((ch.mimo_mode as MiMoMode) || 'preset');
    setMimoPresetVoice(ch.mimo_preset_voice || '冰糖');
    setMimoInstruction(ch.mimo_instruction || '');
    setMimoCloneVoiceId(ch.mimo_clone_voice_id || '');
    setVoxcpmMode((ch.voxcpm_mode as VoxCPMMode) || 'tts');
    setVoxcpmVoiceDescription(ch.voxcpm_voice_description || '');
    setVoxcpmStyleControl(ch.voxcpm_style_control || '');
    setVoxcpmPromptText(ch.voxcpm_prompt_text || '');
    setVoxcpmCfgValue(ch.voxcpm_cfg_value ?? 2.0);
    setVoxcpmInferenceTimesteps(ch.voxcpm_inference_timesteps ?? 10);
    setParams({ language: (ch.language as any) || 'Chinese', speed: ch.speed ?? 1.0, volume: ch.volume ?? 80, pitch: ch.pitch ?? 1.0 });
    setPanelOpen(ch.panel_open ?? true);
  }, []);

  const handleSelectChapter = useCallback((chapterId: string) => {
    dispatch({ type: 'SELECT_CHAPTER', id: chapterId });
    // After dispatch, the project state will have the new active chapter
    // We need to get the chapter from the current project state
    const ch = project.chapters.find(c => c.id === chapterId);
    if (ch) restoreChapterSettings(ch);
  }, [project.chapters, dispatch, restoreChapterSettings]);

  const handleAddChapter = useCallback(() => {
    const name = `第${project.chapters.length + 1}章`;
    dispatch({ type: 'ADD_CHAPTER', name });
    // New chapter inherits settings from previous active chapter, so no need to reset global state
  }, [project.chapters.length, dispatch]);

  const doDeleteChapter = useCallback(async (chapterId: string) => {
    const ch = project.chapters.find(c => c.id === chapterId);
    if (ch) {
      for (const seg of ch.segments) {
        if (seg.current_audio_id) { try { await deleteTTSResult(seg.current_audio_id); } catch {} }
        if (seg.previous_audio_id) { try { await deleteTTSResult(seg.previous_audio_id); } catch {} }
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
    const audioCount = ch?.segments.filter(s => s.current_audio_id).length || 0;
    setConfirmDialog({
      open: true, title: '删除章节',
      message: `确定删除「${ch?.name || '此章节'}」？\n包含 ${segCount} 个片段${audioCount > 0 ? `、${audioCount} 段音频` : ''}，将一并删除。`,
      variant: 'warning', confirmLabel: '删除',
      onConfirm: () => { setConfirmDialog(prev => ({ ...prev, open: false })); doDeleteChapter(chapterId); },
    });
  }, [project.chapters, doDeleteChapter]);

  // ---- Segmented mode handlers ----

  /** Build SegmentEngineParams from current global state */
  const buildCurrentParams = useCallback((): SegmentEngineParams => {
    if (engine === 'edge_tts') {
      return { engine: 'edge_tts', edge_voice: edgeVoice, edge_rate: toEdgeFormat(edgeRate), edge_volume: toEdgeFormat(edgeVolume) };
    }
    if (engine === 'mimo_tts') {
      return { engine: 'mimo_tts', mimo_mode: mimoMode, mimo_preset_voice: mimoPresetVoice, mimo_clone_voice_id: mimoCloneVoiceId, mimo_instruction: mimoInstruction };
    }
    if (engine === 'voxcpm') {
      const params: SegmentEngineParams = {
        engine: 'voxcpm', voice_id: selectedVoiceId, voxcpm_mode: voxcpmMode,
        voxcpm_voice_description: voxcpmVoiceDescription, voxcpm_style_control: voxcpmStyleControl,
        voxcpm_prompt_text: voxcpmPromptText, voxcpm_cfg_value: voxcpmCfgValue,
        voxcpm_inference_timesteps: voxcpmInferenceTimesteps,
      };
      console.log('[buildCurrentParams] voxcpm:', params);
      return params;
    }
    return {
      engine: 'cosyvoice', voice_id: selectedVoiceId,
      instruction: params.instruction || '', speed: params.speed ?? 1.0, volume: params.volume ?? 80,
      pitch: params.pitch ?? 1.0, language: params.language || 'Chinese',
      enable_ssml: params.enable_ssml ?? false, enable_markdown_filter: params.enable_markdown_filter ?? false,
    };
  }, [engine, selectedVoiceId, params, edgeVoice, edgeRate, edgeVolume, mimoMode, mimoPresetVoice, mimoCloneVoiceId, mimoInstruction, voxcpmMode, voxcpmVoiceDescription, voxcpmStyleControl, voxcpmPromptText, voxcpmCfgValue, voxcpmInferenceTimesteps]);

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
    setVoxcpmMode('tts');
    setVoxcpmVoiceDescription('');
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
    dispatch({ type: 'LOAD_PROJECT', project: migrated });
    setProject(migrated);
    const ch = getActiveChapter(migrated);
    if (ch) restoreChapterSettings(ch);
    if (storageMode === 'backend') {
      await draftSync.adoptBackendVersion(migrated);
    }
  }, [projectStorage, dispatch, restoreChapterSettings, storageMode, draftSync]);

  const handleCreateProject = useCallback(async () => {
    const np = createInitialProject();
    np.name = `新项目 ${projectList.filter(p => p.id !== SCRATCHPAD_PROJECT_ID).length + 1}`;
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
          const scratchpad = createScratchpadProject();
          await projectStorage.saveProject(scratchpad, { mode: 'immediate' });
          setProjectList([scratchpad]);
          setProject(scratchpad);
          dispatch({ type: 'LOAD_PROJECT', project: scratchpad });
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
  }, [project.id, project, projectList, doDeleteProject, showToast]);

  const handleToggleIndependentVoice = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_INDEPENDENT_VOICE', id });
  }, [dispatch]);

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
      if (cur.current_audio_id) { try { await deleteTTSResult(cur.current_audio_id); } catch {} }
      if (nxt.current_audio_id) { try { await deleteTTSResult(nxt.current_audio_id); } catch {} }
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
      if (seg.current_audio_id) { try { await deleteTTSResult(seg.current_audio_id); } catch {} }
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
      if (seg.current_audio_id) { try { await deleteTTSResult(seg.current_audio_id); } catch {} }
      if (seg.previous_audio_id) { try { await deleteTTSResult(seg.previous_audio_id); } catch {} }
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
      .flatMap(s => [s.current_audio_id, s.previous_audio_id])
      .filter((id): id is string => !!id);

    const apply = async () => {
      for (const aid of oldAudioIds) { try { await deleteTTSResult(aid); } catch {} }
      dispatch({ type: 'SET_DEFAULT_PARAMS', params: buildCurrentParams() });
      dispatch({ type: 'SET_CHAPTER_META', meta: { original_text: originalText, engine, voice_id: selectedVoiceId, edge_voice: edgeVoice } });
      dispatch({ type: 'APPLY_SPLIT', items });
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
  }, [activeChapter.segments, dispatch, buildCurrentParams, selectedVoiceId, edgeVoice, engine]);

  const handleAppendByKind = useCallback((kind: SegmentKind) => {
    setProject(prev => {
      const appended = segmentedReducer({ project: prev }, { type: 'APPEND_SEGMENT', text: '' }).project;
      const active = getActiveChapter(appended);
      const latest = active?.segments[active.segments.length - 1];
      if (!latest) return appended;
      return segmentedReducer({ project: appended }, { type: 'SET_SEGMENT_KIND', id: latest.id, segmentKind: kind }).project;
    });
  }, []);

  const buildSplitItemsWithRoles = useCallback((
    items: { text: string; emotion?: string }[],
    voiceMode: SplitVoiceMode,
  ) => items.map(item => ({
    ...item,
    ...assignRoleForSplitItem(item.text, voiceMode, roles, project.default_narrator_role_id),
  })), [roles, project.default_narrator_role_id]);

  const createRoleDraft = useCallback((name: string, description: 'Narrator' | 'Cast'): RoleSnapshot => createVoiceRoleDraft({
    name,
    roleKind: description,
    currentParams: buildCurrentParams(),
  }), [buildCurrentParams]);

  const handleCreateDefaultNarrator = useCallback(async () => {
    try {
      const saved = await roleApi.createRole(createRoleDraft('默认旁白', 'Narrator'));
      setRoles(prev => [saved, ...prev.filter(role => role.id !== saved.id)]);
      dispatch({
        type: 'SET_PROJECT_NARRATOR',
        roleId: saved.id,
        roleSnapshot: {
          id: saved.id,
          name: saved.name,
          avatar: saved.avatar,
          description: saved.description,
          default_engine: saved.default_engine,
          default_voice: saved.default_voice,
          default_engine_params: { ...saved.default_engine_params },
          favorite_styles: [...saved.favorite_styles],
        },
      });
      showToast('默认旁白已创建');
    } catch (error) {
      console.error('Create narrator role failed:', error);
      showToast('创建默认旁白失败', 'error');
    }
  }, [createRoleDraft, dispatch, showToast]);

  const handleCreateCastRole = useCallback(async () => {
    const castCount = roles.filter(role => !`${role.name} ${role.description ?? ''}`.toLowerCase().includes('narrator') && !`${role.name} ${role.description ?? ''}`.includes('旁白')).length;
    try {
      const saved = await roleApi.createRole(createRoleDraft(`嘉宾${castCount + 1}`, 'Cast'));
      setRoles(prev => [saved, ...prev.filter(role => role.id !== saved.id)]);
      showToast('Cast 角色已创建');
    } catch (error) {
      console.error('Create cast role failed:', error);
      showToast('创建 Cast 失败', 'error');
    }
  }, [createRoleDraft, roles, showToast]);

  const roleSnapshotFromRole = useCallback((role: Role): RoleSnapshot => ({
    id: role.id,
    name: role.name,
    avatar: role.avatar,
    description: role.description,
    default_engine: role.default_engine,
    default_voice: role.default_voice,
    default_engine_params: { ...role.default_engine_params },
    favorite_styles: [...role.favorite_styles],
  }), []);

  const handleSaveRole = useCallback(async (draft: RoleSnapshot) => {
    try {
      const exists = roles.some(role => role.id === draft.id);
      const saved = exists
        ? await roleApi.updateRole(draft.id, draft)
        : await roleApi.createRole(draft);
      setRoles(prev => exists
        ? prev.map(role => role.id === saved.id ? saved : role)
        : [saved, ...prev.filter(role => role.id !== saved.id)]);
      const isNarrator = `${saved.name} ${saved.description ?? ''}`.toLowerCase().includes('narrator') || `${saved.name} ${saved.description ?? ''}`.includes('旁白');
      if (isNarrator || project.default_narrator_role_id === saved.id) {
        dispatch({
          type: 'SET_PROJECT_NARRATOR',
          roleId: saved.id,
          roleSnapshot: roleSnapshotFromRole(saved),
        });
      }
      showToast(exists ? '角色已更新' : '角色已创建');
    } catch (error) {
      console.error('Save role failed:', error);
      showToast('角色保存失败', 'error');
    }
  }, [roles, project.default_narrator_role_id, dispatch, roleSnapshotFromRole, showToast]);

  const handleDeleteRole = useCallback(async (roleId: string) => {
    const target = roles.find(role => role.id === roleId);
    if (!target) return;
    const isNarrator = `${target.name} ${target.description ?? ''}`.toLowerCase().includes('narrator') || `${target.name} ${target.description ?? ''}`.includes('旁白');
    const remainingNarrators = roles.filter(role => role.id !== roleId && (`${role.name} ${role.description ?? ''}`.toLowerCase().includes('narrator') || `${role.name} ${role.description ?? ''}`.includes('旁白')));
    if (isNarrator && remainingNarrators.length === 0) {
      showToast('至少保留一个旁白音色', 'error');
      return;
    }
    try {
      await roleApi.deleteRole(roleId);
      setRoles(prev => prev.filter(role => role.id !== roleId));
      if (project.default_narrator_role_id === roleId) {
        const nextNarrator = remainingNarrators[0] ?? null;
        dispatch({
          type: 'SET_PROJECT_NARRATOR',
          roleId: nextNarrator?.id ?? null,
          roleSnapshot: nextNarrator ? roleSnapshotFromRole(nextNarrator) : null,
        });
      }
      showToast('角色已删除');
    } catch (error) {
      console.error('Delete role failed:', error);
      showToast('角色删除失败', 'error');
    }
  }, [roles, project.default_narrator_role_id, dispatch, roleSnapshotFromRole, showToast]);

  const handlePreviewRole = useCallback(async (role: Role, sampleText: string) => {
    setPreviewingRoleId(role.id);
    try {
      const rp = role.default_engine_params;
      const resp = rp.engine === 'edge_tts'
        ? await ttsApi.synthesize({
            text: sampleText,
            engine: 'edge_tts',
            voice_id: '',
            edge_voice: rp.edge_voice || role.default_voice || '',
            edge_rate: rp.edge_rate || '+0%',
            edge_volume: rp.edge_volume || '+0%',
            format: 'mp3',
          })
        : await ttsApi.synthesize({
            text: sampleText,
            voice_id: rp.voice_id || role.default_voice || '',
            language: (rp.language ?? 'Chinese') as 'Chinese' | 'English' | 'Japanese' | 'Korean',
            speed: rp.speed ?? 1,
            volume: rp.volume ?? 80,
            pitch: rp.pitch ?? 1,
            instruction: rp.instruction ?? '',
            enable_ssml: rp.enable_ssml ?? false,
            enable_markdown_filter: rp.enable_markdown_filter ?? false,
            format: 'mp3',
          });
      if (!resp.audio_base64) throw new Error('No preview audio returned');
      const audio = new Audio(`data:audio/${resp.audio_format || 'mp3'};base64,${resp.audio_base64}`);
      await audio.play();
    } catch (error) {
      console.error('Preview role failed:', error);
      showToast('试听失败', 'error');
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
      const sp = seg.params;
      const overrides = seg.overrides || [];
      const gp = buildCurrentParams();

      // Effective engine: global when unlocked, stored when locked
      const hasVoiceLock = overrides.includes('voice');
      const effectiveEngine = hasVoiceLock ? (sp.engine || gp.engine) : gp.engine;

      // Params: locked → use stored; unlocked → use CURRENT global, fallback to stored for CosyVoice-specific fields
      const voiceId = hasVoiceLock ? sp.voice_id : (gp.voice_id || sp.voice_id);
      const speed = overrides.includes('speed') ? sp.speed : ((gp as any).speed ?? 1.0);
      const volume = overrides.includes('volume') ? sp.volume : ((gp as any).volume ?? 80);
      const pitch = overrides.includes('pitch') ? sp.pitch : ((gp as any).pitch ?? 1.0);
      const instruction = overrides.includes('instruction') ? sp.instruction : ((gp as any).instruction || sp.instruction || '');
      const language = overrides.includes('language') ? sp.language : ((gp as any).language || sp.language || 'Chinese');

      // Edge-TTS: locked → stored; unlocked → current global
      const effectiveEdgeVoice = hasVoiceLock ? sp.edge_voice : ((gp as any).edge_voice || '');
      const effectiveEdgeRate = hasVoiceLock ? sp.edge_rate : ((gp as any).edge_rate ?? '+0%');
      const effectiveEdgeVolume = hasVoiceLock ? sp.edge_volume : ((gp as any).edge_volume ?? '+0%');

      // MiMo: locked → stored; unlocked → current global
      const effectiveMimoMode = hasVoiceLock ? sp.mimo_mode : ((gp as any).mimo_mode || 'preset');
      const effectiveMimoPreset = hasVoiceLock ? sp.mimo_preset_voice : ((gp as any).mimo_preset_voice || '');
      const effectiveMimoCloneId = hasVoiceLock ? sp.mimo_clone_voice_id : ((gp as any).mimo_clone_voice_id || '');
      const effectiveMimoInstruction = overrides.includes('instruction') ? (sp.mimo_instruction || '') : ((gp as any).mimo_instruction || '');

      // VoxCPM: locked → stored; unlocked → current global
      const effectiveVoxcpmMode = hasVoiceLock ? (sp.voxcpm_mode || 'tts') : ((gp as any).voxcpm_mode || 'tts');
      const effectiveVoxcpmCfg = hasVoiceLock ? (sp.voxcpm_cfg_value ?? 2.0) : ((gp as any).voxcpm_cfg_value ?? 2.0);
      const effectiveVoxcpmTimesteps = hasVoiceLock ? (sp.voxcpm_inference_timesteps ?? 10) : ((gp as any).voxcpm_inference_timesteps ?? 10);
      const effectiveVoxcpmDesc = hasVoiceLock ? (sp.voxcpm_voice_description || '') : ((gp as any).voxcpm_voice_description || '');
      const effectiveVoxcpmStyle = overrides.includes('instruction') ? (sp.voxcpm_style_control || '') : ((gp as any).voxcpm_style_control || '');
      const effectiveVoxcpmPrompt = hasVoiceLock ? (sp.voxcpm_prompt_text || '') : ((gp as any).voxcpm_prompt_text || '');

      const textToSend = (sp.enable_ssml && seg.ssml) ? seg.ssml : seg.text;

      // Voice identifier & params snapshot — shared by both backend and frontend paths
      const usedVoiceId = effectiveEngine === 'edge_tts' ? effectiveEdgeVoice : (effectiveEngine === 'mimo_tts' ? (effectiveMimoMode === 'preset' ? effectiveMimoPreset : effectiveMimoCloneId) : (effectiveEngine === 'voxcpm' ? voiceId : voiceId));
      const updatedParams: Partial<import('../types').SegmentEngineParams> = { engine: effectiveEngine as any };
      if (effectiveEngine === 'edge_tts') {
        updatedParams.edge_voice = effectiveEdgeVoice;
        updatedParams.edge_rate = effectiveEdgeRate;
        updatedParams.edge_volume = effectiveEdgeVolume;
      } else if (effectiveEngine === 'mimo_tts') {
        updatedParams.mimo_mode = effectiveMimoMode;
        updatedParams.mimo_preset_voice = effectiveMimoPreset;
        updatedParams.mimo_clone_voice_id = effectiveMimoCloneId;
        updatedParams.mimo_instruction = effectiveMimoInstruction;
      } else if (effectiveEngine === 'voxcpm') {
        updatedParams.voxcpm_mode = effectiveVoxcpmMode as any;
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
        const { segmentedProjectApi } = await import('../services/api');
        const updated = await segmentedProjectApi.synthesizeSegment(
          project.id, activeChapter.id, seg.id, {
            params: requestParams,
            text: textToSend,
            ssml: (sp.enable_ssml && seg.ssml) ? seg.ssml : undefined,
            keep_previous: true,
          },
        );
        // Extract the regenerated segment from the backend response
        const updatedSeg = updated.chapters
          ?.flatMap((c: any) => c.segments ?? [])
          ?.find((s: any) => s.id === seg.id);
        // Clear legacy IndexedDB audio_id if it existed (segment now uses backend path)
        if (seg.current_audio_id) { try { await deleteTTSResult(seg.current_audio_id); } catch {} }
        if (seg.previous_audio_id) { try { await deleteTTSResult(seg.previous_audio_id); } catch {} }
        // Surgically update only the regenerated segment — preserve all other segments' frontend state
        const usedVoiceId = effectiveEngine === 'edge_tts' ? effectiveEdgeVoice : (effectiveEngine === 'mimo_tts' ? (effectiveMimoMode === 'preset' ? effectiveMimoPreset : effectiveMimoCloneId) : voiceId);
        dispatch({
          type: 'GENERATE_SUCCESS',
          id,
          generated_voice_id: usedVoiceId,
          updated_params: updatedParams,
          current_audio_path: updatedSeg?.current_audio_path,
          previous_audio_path: updatedSeg?.previous_audio_path,
          audio_format: updatedSeg?.audio_format ?? 'mp3',
          duration_sec: updatedSeg?.duration_sec,
          generated_params: updatedSeg?.generated_params,
        });
        return;
      }

      if (effectiveEngine === 'edge_tts') {
        resp = await ttsApi.synthesize({ text: textToSend, engine: 'edge_tts', voice_id: '', edge_voice: effectiveEdgeVoice ?? '', edge_rate: effectiveEdgeRate ?? '+0%', edge_volume: effectiveEdgeVolume ?? '+0%', format: 'mp3' });
      } else if (effectiveEngine === 'mimo_tts') {
        resp = effectiveMimoMode === 'preset'
          ? await mimoTtsApi.synthesizePreset({ text: textToSend, voice: effectiveMimoPreset ?? '', instruction: effectiveMimoInstruction ?? '', format: 'wav' })
          : await mimoTtsApi.synthesizeVoiceClone({ text: textToSend, voice_id: effectiveMimoCloneId ?? '', instruction: effectiveMimoInstruction ?? '', format: 'wav' });
      } else if (effectiveEngine === 'voxcpm') {
        if (effectiveVoxcpmMode === 'design') {
          resp = await voxcpmApi.design({ voice_description: effectiveVoxcpmDesc, text: textToSend || undefined, cfg_value: effectiveVoxcpmCfg, inference_timesteps: effectiveVoxcpmTimesteps, format: 'wav' });
        } else if (effectiveVoxcpmMode === 'clone') {
          resp = await voxcpmApi.clone({ text: textToSend, voice_id: voiceId ?? '', style_control: effectiveVoxcpmStyle, cfg_value: effectiveVoxcpmCfg, inference_timesteps: effectiveVoxcpmTimesteps, format: 'wav' });
        } else if (effectiveVoxcpmMode === 'ultimate') {
          resp = await voxcpmApi.ultimateClone({ text: textToSend, voice_id: voiceId ?? '', prompt_text: effectiveVoxcpmPrompt, style_control: effectiveVoxcpmStyle, cfg_value: effectiveVoxcpmCfg, inference_timesteps: effectiveVoxcpmTimesteps, format: 'wav' });
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
      if (seg.previous_audio_id) { try { await deleteTTSResult(seg.previous_audio_id); } catch {} }
      dispatch({ type: 'GENERATE_SUCCESS', id, audio_id: audioId, duration_sec: duration, generated_voice_id: usedVoiceId, updated_params: updatedParams });
    } catch (e: any) {
      dispatch({ type: 'GENERATE_FAIL', id, error: e?.message ?? '生成失败' });
    }
  }, [activeChapter.segments, dispatch, buildCurrentParams, showToast]);

  // Keep ref in sync
  handleRegenerateRef.current = handleRegenerate;

  const handleRegenerateAll = useCallback(async () => {
    if (generating) return;

    // Segments to regenerate: idle, failed, OR ready but NOT voice-locked
    const toRegenerate = activeChapter.segments.filter(s => {
      if (s.status === 'idle' || s.status === 'failed') return true;
      if (s.status === 'ready') {
        const hasVoiceLock = s.overrides?.includes('voice');
        return !hasVoiceLock; // regenerate ready segments that follow global voice
      }
      return false; // skip 'pending'/'queued'
    });

    if (toRegenerate.length === 0) {
      showToast('没有需要重新生成的片段');
      return;
    }

    const existingAudio = toRegenerate.filter(s => s.current_audio_id);

    // Show confirmation
    const lockedCount = activeChapter.segments.filter(s => s.status === 'ready' && s.overrides?.includes('voice')).length;
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
  }, [generating, activeChapter.segments, showToast]);

  const doRegenerateAll = useCallback(async (toRegenerate: typeof activeChapter.segments) => {
    setGenerating(true);
    try {
      // Step 1: Delete existing audio for segments that have it
      for (const seg of toRegenerate) {
        if (seg.current_audio_id) {
          try { await deleteTTSResult(seg.current_audio_id); } catch {}
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
  }, [dispatch, showToast]);

  const handleAnnotateSSML = useCallback(async (idsArg?: string[]) => {
    const ids = idsArg ?? activeChapter.segments.filter(s => s.params.engine === 'cosyvoice').map(s => s.id);
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
    if (!seg?.current_audio_id && !seg?.current_audio_path) {
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
        current_audio_id: seg?.current_audio_id,
        current_audio_path: seg?.current_audio_path,
      });
      const msg = (e as any)?.message ?? String(e);
      showToast(`播放失败 (${ctx}): ${msg}`, 'error');
    };

    try {
      // Backend mode: fetch audio as blob, then play via blob URL
      if (storageMode === 'backend' && project?.id && seg.current_audio_path) {
        const url = `/api/segmented-projects/${project.id}/audio/${activeChapter.id}/${seg.id}`;
        const resp = await fetch(url);
        if (!resp.ok) {
          // Try to extract backend error detail (FastAPI's `detail` field)
          let detail = `HTTP ${resp.status}`;
          try {
            const body = await resp.clone().json();
            if (body?.detail) detail = `${resp.status} ${body.detail}`;
          } catch {
            try { detail = `${resp.status} ${await resp.text()}`.slice(0, 200); } catch {}
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
      if (seg.current_audio_path && !seg.current_audio_id) {
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
  }, [activeChapter.segments, playingId, stopCurrentAudio, storageMode, project, activeChapter, showToast]);

  const handlePlayAll = useCallback(async () => {
    const readySegs = activeChapter.segments.filter(s =>
      s.status === 'ready' && (s.current_audio_id || s.current_audio_path),
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
        if (storageMode === 'backend' && project?.id && seg.current_audio_path) {
          const url = `/api/segmented-projects/${project.id}/audio/${activeChapter.id}/${seg.id}`;
          const resp = await fetch(url);
          if (!resp.ok) {
            let detail = `HTTP ${resp.status}`;
            try { const b = await resp.clone().json(); if (b?.detail) detail = `${resp.status} ${b.detail}`; } catch {}
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
  }, [activeChapter.segments, storageMode, project, activeChapter]);

  const handleStopAll = useCallback(() => {
    stopCurrentAudio();
  }, [stopCurrentAudio]);

  const handleTrimSilence = useCallback(async (id: string) => {
    const seg = activeChapter.segments.find(s => s.id === id);
    if (!seg?.current_audio_id) return;
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
      await saveTTSResult({ id: newId, text: seg.text, voice_id: seg.params.voice_id || '', voice_name: '', audioBlob: trimmedBlob, audio_format: 'wav', speed: seg.params.speed ?? 1, volume: seg.params.volume ?? 80, pitch: seg.params.pitch ?? 1, instruction: seg.params.instruction || '', language: seg.params.language || 'Chinese', created_at: new Date().toISOString(), source: 'segmented_tts' });
      try { await deleteTTSResult(seg.current_audio_id); } catch {}
      dispatch({ type: 'GENERATE_SUCCESS', id, audio_id: newId, duration_sec: newDuration, generated_voice_id: seg.generated_voice_id });
      showToast(`裁剪了 ${trimmedMs}ms 静音`);
    } catch (e) { console.error('Trim failed:', e); showToast('裁剪失败', 'error'); }
  }, [activeChapter.segments, dispatch, showToast]);

  const selectedVoice = voices.find(v => (v.qwen_voice_id || v.id) === selectedVoiceId);
  // isScratchpadProject 已提前到 component 顶部 (P2 v2 useMemo 引用)
  const activeChapterDuration = activeChapter.segments.reduce((total, segment) => total + (segment.duration_sec ?? 0), 0);
  const generatedSegmentCount = activeChapter.segments.filter(segment => segment.status === 'ready').length;
  const engineLabel = ({ cosyvoice: 'CosyVoice', edge_tts: 'Edge-TTS', mimo_tts: 'MiMo', voxcpm: 'VoxCPM' } as Record<Engine, string>)[engine] || engine;
  const voiceRoleLabel = project.default_narrator_snapshot?.name
    || selectedVoice?.description
    || selectedVoice?.name
    || edgeVoice
    || mimoPresetVoice
    || '默认旁白';
  const narratorRoleSummaries = roles
    .filter(role => role.id === project.default_narrator_role_id || `${role.name} ${role.description ?? ''}`.toLowerCase().includes('narrator') || `${role.name} ${role.description ?? ''}`.includes('旁白'))
    .map(role => ({ id: role.id, name: role.name }));
  const castRoleSummaries = roles
    .filter(role => !narratorRoleSummaries.some(narrator => narrator.id === role.id))
    .map(role => ({ id: role.id, name: role.name }));
  const narratorDraftPreview = createVoiceRoleDraft({
    name: '默认旁白',
    roleKind: 'Narrator',
    currentParams: buildCurrentParams(),
  });
  const defaultNarratorPreviewLabel = `${({ cosyvoice: 'CosyVoice', edge_tts: 'Edge-TTS', mimo_tts: 'MiMo', voxcpm: 'VoxCPM' } as Record<Engine, string>)[narratorDraftPreview.default_engine] || narratorDraftPreview.default_engine} · ${roleVoiceLabelFromParams(narratorDraftPreview.default_engine_params, narratorDraftPreview.default_voice)}`;

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
          onSectionChange={setProjectSection}
          onBackToProjects={onBackToProjects}
        >
        {projectSection === 'studio' ? (
        <VoiceStudioLayout
          projectName={project.name}
          chapterName={activeChapter.name}
          engineLabel={engineLabel}
          voiceRoleLabel={voiceRoleLabel}
          segmentCount={activeChapter.segments.length}
          generatedCount={generatedSegmentCount}
          durationSec={activeChapterDuration}
          queueCount={activeChapter.segments.filter(segment => segment.status === 'queued' || segment.status === 'pending').length}
          narratorRoles={narratorRoleSummaries}
          castRoles={castRoleSummaries}
          viewMode={segmentViewMode}
          remotionPath={project.remotion_project_path}
          onViewModeChange={setSegmentViewMode}
          onBatchSynthesize={handleRegenerateAll}
          onExport={() => setExportOpen(true)}
          onPlayAll={playAllActive ? handleStopAll : handlePlayAll}
        >
        <div className={styles.workbenchMain}>
          <div className={styles.toolbar}>
            <div className={styles.projectTitleCluster}>
              <span className={styles.toolbarTitle}>分段配音工作台</span>
              <span className={styles.projectSubtitle}>{isScratchpadProject ? '草稿项目 · 快速试稿' : '项目制 · 章节分段'}</span>
            </div>
            <div className={styles.toolbarDivider} />
            <div className={styles.toolbarGroup}>
              <button className={`${styles.toolbarPill} ${engine === 'edge_tts' ? styles.toolbarPillActive : ''}`} onClick={() => setEngine('edge_tts')}>Edge-TTS</button>
              <button className={`${styles.toolbarPill} ${engine === 'cosyvoice' ? styles.toolbarPillActive : ''}`} onClick={() => setEngine('cosyvoice')}>CosyVoice</button>
              <button className={`${styles.toolbarPill} ${engine === 'mimo_tts' ? styles.toolbarPillActive : ''}`} onClick={() => setEngine('mimo_tts')}>MiMo</button>
              <button className={`${styles.toolbarPill} ${engine === 'voxcpm' ? styles.toolbarPillActive : ''}`} onClick={() => setEngine('voxcpm')}>VoxCPM</button>
            </div>
          </div>

          <div className={styles.segmentedContent}>
            <div className={styles.segmentedToolbar}>
              <input
                className={styles.segmentedNameInput}
                value={project.name}
                disabled={isScratchpadProject}
                onChange={(e) => dispatch({ type: 'RENAME_PROJECT', name: e.target.value })}
              />
              {isScratchpadProject && <span className={styles.scratchpadBadge}>默认草稿</span>}
              <label className={styles.inlineMetaField} title="关联 Remotion 项目路径；导出文件优先写入 public/audio，目录不存在则写入项目根目录">
                <span>Remotion</span>
                <input
                  value={project.remotion_project_path ?? ''}
                  disabled={isScratchpadProject}
                  placeholder="/path/to/remotion-project"
                  onChange={(e) => dispatch({ type: 'SET_PROJECT_META', meta: { remotion_project_path: e.target.value || null } })}
                />
              </label>
              {project.remotion_project_path && <span className={styles.exportHint}>导出→Remotion</span>}
              <div className={styles.chapterGroup}>
                <select
                  className={styles.chapterSelect}
                  value={project.active_chapter_id || ''}
                  onChange={(e) => handleSelectChapter(e.target.value)}
                >
                  {project.chapters.map(ch => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name} ({ch.segments.length}段)
                    </option>
                  ))}
                </select>
                <button className={styles.chapterBtn} onClick={handleAddChapter} title="新建章节">+</button>
                {project.chapters.length > 1 && (
                  <button className={styles.chapterBtnDanger} onClick={() => handleDeleteChapter(project.active_chapter_id || '')} title="删除当前章节">✕</button>
                )}
              </div>
              <span className={styles.segmentedStats}>
                {activeChapter.segments.length} 段 · {activeChapter.segments.reduce((a, s) => a + (s.duration_sec ?? 0), 0).toFixed(1)}s
                {activeChapter.segments.filter(s => s.status === 'ready').length > 0 && ` · ${activeChapter.segments.filter(s => s.status === 'ready').length}/${activeChapter.segments.length} 已生成`}
              </span>
              <div className={styles.toolbarGroup}>
                <button className={`${styles.toolbarPill} ${srtDurationMode === 'chapter' ? styles.toolbarPillActive : ''}`} onClick={() => setSrtDurationMode('chapter')}>章节时间</button>
                <button className={`${styles.toolbarPill} ${srtDurationMode === 'global' ? styles.toolbarPillActive : ''}`} onClick={() => setSrtDurationMode('global')}>全局时间</button>
              </div>
              <label className={styles.inlineMetaField} title="视觉设计/Remotion 场景标题，可与朗读章节名不同">
                <span>设计标题</span>
                <input
                  value={activeChapter.design_title ?? activeChapter.name}
                  placeholder={activeChapter.name}
                  onChange={(e) => dispatch({ type: 'SET_CHAPTER_META', meta: { design_title: e.target.value } })}
                />
              </label>
              <div className={styles.segmentedActions}>
                <button className={styles.segmentedActionBtn} onClick={handleRegenerateAll} disabled={generating}>
                  {generating ? '生成中...' : '⚡ 全部生成'}
                </button>
                <button className={styles.segmentedActionBtn} onClick={playAllActive ? handleStopAll : handlePlayAll} disabled={!!playingId && !playAllActive}>
                  {playAllActive ? '■ 停止' : '▶ 全部播放'}
                </button>
                {engine === 'cosyvoice' && (
                  <button className={styles.segmentedActionBtn} onClick={() => handleAnnotateSSML()}>✨ 标注</button>
                )}
                <button className={styles.segmentedActionBtn} onClick={() => setExportOpen(true)}>⬇ 导出</button>
                <button className={styles.segmentedActionBtn} onClick={() => setRoleLibraryOpen(true)}>
                  🎭 角色库{roles.length > 0 ? ` (${roles.length})` : ''}
                </button>
                {!isScratchpadProject && <button className={styles.segmentedActionBtnDanger} onClick={() => handleDeleteProject(project.id)}>🗑 删除</button>}
              </div>
            </div>

            <CollapsiblePanel
              title={({cosyvoice: 'CosyVoice', edge_tts: 'Edge-TTS', mimo_tts: 'MiMo', voxcpm: 'VoxCPM'} as Record<Engine, string>)[engine] || engine}
              summary={
                engine === 'cosyvoice'
                  ? (selectedVoice?.description || selectedVoice?.name || '未选择')
                  : engine === 'edge_tts'
                    ? (edgeVoice ? edgeVoice.split('-').pop()?.replace(/Neural$|V\d+$/i, '') || edgeVoice : '未选择')
                    : (mimoMode === 'voiceclone' ? '自定义音色' : mimoPresetVoice || '未选择')
              }
              open={panelOpen}
              onToggle={() => setPanelOpen(!panelOpen)}
            >
            {engine === 'cosyvoice' ? (
              <GlobalControlBar
                selectedVoiceId={selectedVoiceId} onVoiceSelect={setSelectedVoiceId}
                speed={params.speed ?? 1.0} volume={params.volume ?? 80} pitch={params.pitch ?? 1.0} language={params.language || 'Chinese'}
                instruction={params.instruction} enableSsml={params.enable_ssml} enableMarkdownFilter={params.enable_markdown_filter}
                onSpeedChange={v => setParams(p => ({ ...p, speed: v }))}
                onVolumeChange={v => setParams(p => ({ ...p, volume: v }))}
                onPitchChange={v => setParams(p => ({ ...p, pitch: v }))}
                onLanguageChange={v => setParams(p => ({ ...p, language: v as any }))}
                onInstructionChange={v => setParams(p => ({ ...p, instruction: v }))}
                onSsmlToggle={() => setParams(p => ({ ...p, enable_ssml: !p.enable_ssml }))}
                onMarkdownFilterToggle={() => setParams(p => ({ ...p, enable_markdown_filter: !p.enable_markdown_filter }))}
                onNavigateToClone={onNavigateToClone}
              />
            ) : engine === 'edge_tts' ? (
              <EdgeTTSPanel selectedVoice={edgeVoice} onVoiceSelect={setEdgeVoice} rate={edgeRate} volume={edgeVolume} onRateChange={setEdgeRate} onVolumeChange={setEdgeVolume} />
            ) : engine === 'mimo_tts' ? (
              <MiMoTTSPanel mode={mimoMode} onModeChange={setMimoMode} onPresetVoiceSelect={setMimoPresetVoice} selectedPresetVoice={mimoPresetVoice} onInstructionChange={setMimoInstruction} instruction={mimoInstruction} onCloneVoiceSelect={setMimoCloneVoiceId} selectedCloneVoiceId={mimoCloneVoiceId} />
            ) : (
              <VoxCPMPanel
                mode={voxcpmMode} onModeChange={setVoxcpmMode}
                voiceDescription={voxcpmVoiceDescription} onVoiceDescriptionChange={setVoxcpmVoiceDescription}
                styleControl={voxcpmStyleControl} onStyleControlChange={setVoxcpmStyleControl}
                promptText={voxcpmPromptText} onPromptTextChange={setVoxcpmPromptText}
                selectedVoiceId={selectedVoiceId} onVoiceSelect={setSelectedVoiceId}
                cfgValue={voxcpmCfgValue} onCfgValueChange={setVoxcpmCfgValue}
                inferenceTimesteps={voxcpmInferenceTimesteps} onInferenceTimestepsChange={setVoxcpmInferenceTimesteps}
              />
            )}
            </CollapsiblePanel>

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
              segmentTexts={activeChapter.segments.map(s => s.text)}
              segmentCount={activeChapter.segments.length}
            />

            <div className={styles.segmentedEditor}>
              <div className={styles.viewToggle}>
                <button className={`${styles.viewToggleBtn} ${compactMode ? styles.viewToggleActive : ''}`}
                  onClick={() => setCompactMode(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
                  紧凑
                </button>
                <button className={`${styles.viewToggleBtn} ${!compactMode ? styles.viewToggleActive : ''}`}
                  onClick={() => setCompactMode(false)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18"/></svg>
                  展开
                </button>
              </div>

              <div className={styles.viewSwitch}>
                <button type="button" onClick={() => setSegmentViewMode('list')} aria-pressed={segmentViewMode === 'list'}>列表视图</button>
                <button type="button" onClick={() => setSegmentViewMode('dialogue')} aria-pressed={segmentViewMode === 'dialogue'}>对话视图</button>
              </div>
              {segmentViewMode === 'dialogue' ? (
                <>
                  <div className={styles.roleControls}>
                    <RolePicker
                      roles={roles}
                      label="旁白角色"
                      value={project.default_narrator_role_id}
                      onChange={(roleId, roleSnapshot) => dispatch({ type: 'SET_PROJECT_NARRATOR', roleId, roleSnapshot })}
                      onManage={() => setRoleLibraryOpen(true)}
                    />
                    {activeChapter.selected_segment_id && (() => {
                      const selectedSegment = activeChapter.segments.find(s => s.id === activeChapter.selected_segment_id);
                      if (!selectedSegment) return null;
                      return (
                        <RolePicker
                          roles={roles}
                          label="当前段角色"
                          value={selectedSegment.role_id}
                          onChange={(roleId, roleSnapshot) => dispatch({ type: 'SET_SEGMENT_ROLE', id: selectedSegment.id, roleId, roleSnapshot })}
                          onManage={() => setRoleLibraryOpen(true)}
                        />
                      );
                    })()}
                  </div>
                  <ChatSegmentView
                    segments={activeChapter.segments}
                    roles={roles}
                    selectedId={activeChapter.selected_segment_id}
                    playingId={playingId}
                    hasNarratorVoice={!!project.default_narrator_snapshot?.default_voice || !!project.default_narrator_snapshot?.default_engine_params?.edge_voice}
                    onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
                    onAppend={handleAppendByKind}
                    onRegenerate={handleRegenerate}
                    onPlay={handlePlaySegment}
                    onUpdateRole={(id, roleId, roleSnapshot) => dispatch({ type: 'SET_SEGMENT_ROLE', id, roleId, roleSnapshot })}
                    onUpdateProsodyMarks={(id, prosodyMarks) => dispatch({ type: 'UPDATE_PROSODY_MARKS', id, prosodyMarks })}
                  />
                </>
              ) : (
              <SegmentList
                segments={activeChapter.segments}
                layout={project.layout}
                selectedId={activeChapter.selected_segment_id}
                playingId={playingId}
                isPaused={isPaused}
                compact={compactMode}
                voices={voices}
                globalVoiceId={selectedVoiceId}
                globalVoiceName={selectedVoice?.description || selectedVoice?.name}
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
                onInsertAfter={(afterId) => dispatch({ type: 'INSERT_SEGMENT', afterId })}
                onAppend={() => dispatch({ type: 'APPEND_SEGMENT' })}
                onReorder={(from, to) => dispatch({ type: 'REORDER', fromIndex: from, toIndex: to })}
                onEdit={(id) => {
                  const currentSelected = activeChapter.selected_segment_id;
                  dispatch({ type: 'SELECT_SEGMENT', id: currentSelected === id ? undefined : id });
                }}
                onRegenerate={handleRegenerate}
                onPlay={handlePlaySegment}
                onTrimSilence={handleTrimSilence}
                onUndo={(id) => dispatch({ type: 'UNDO_REGENERATE', id })}
                onDuplicate={(id) => {
                  const seg = activeChapter.segments.find(s => s.id === id);
                  if (seg) dispatch({ type: 'INSERT_SEGMENT', afterId: id, text: seg.text });
                }}
                onAnnotateSSML={(id) => handleAnnotateSSML([id])}
                onUpdateText={(id, text) => dispatch({ type: 'UPDATE_TEXT', id, text })}
                onUpdateSSML={(id, ssml) => dispatch({ type: 'UPDATE_SSML', id, ssml })}
                onUpdateParams={(id, params) => dispatch({ type: 'UPDATE_PARAMS', id, params })}
                onUpdateEmotion={(id, emotion) => dispatch({ type: 'UPDATE_EMOTION', id, emotion })}
                onToggleIndependentVoice={handleToggleIndependentVoice}
                onMerge={handleMerge}
                onSplit={handleSplit}
              />
              )}

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
            onSelectChapter={handleSelectChapter}
            onRenameChapter={(id, name) => dispatch({ type: 'RENAME_CHAPTER', id, name })}
            onUpdateChapterText={(id, text) => {
              if (id !== activeChapter.id) handleSelectChapter(id);
              dispatch({ type: 'SET_CHAPTER_META', meta: { original_text: text } });
            }}
            onAddChapter={handleAddChapter}
            onEnterStudio={(chapterId) => {
              handleSelectChapter(chapterId);
              setProjectSection('studio');
            }}
          />
        ) : projectSection === 'voices' ? (
          <ProjectVoices
            roles={roles}
            defaultNarratorRoleId={project.default_narrator_role_id}
            onSetDefaultNarrator={(roleId, roleSnapshot) => dispatch({ type: 'SET_PROJECT_NARRATOR', roleId, roleSnapshot })}
            onCreateDefaultNarrator={handleCreateDefaultNarrator}
            onCreateCast={handleCreateCastRole}
            onSaveRole={handleSaveRole}
            onDeleteRole={handleDeleteRole}
            onPreviewRole={handlePreviewRole}
            onManageRoles={() => setRoleLibraryOpen(true)}
            defaultNarratorPreviewLabel={defaultNarratorPreviewLabel}
          />
        ) : (
          <div className={styles.projectSectionPlaceholder}>
            <span className={styles.projectSectionKicker}>Coming next</span>
            <h2>{projectSection === 'settings' ? '项目设置' : '项目总览'}</h2>
            <p>
              {projectSection === 'settings'
                    ? '这里将配置项目默认参数、Remotion 路径和导出目标。'
                    : '这里将展示项目状态、章节进度、最近导出和待处理事项。'}
            </p>
          </div>
        )}
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
