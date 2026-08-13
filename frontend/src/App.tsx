import { useState, useEffect, useContext } from 'react';
import Landing from './pages/Landing';
import { VoiceClone } from './pages/VoiceClone';
import { TTSSynthesis } from './pages/TTSSynthesis';
import { SpeechToText } from './pages/SpeechToText';
import { ModelConfig } from './pages/ModelConfig';
import { ProjectHub } from './components/ProjectHub/ProjectHub';
import { configApi, segmentedProjectApi } from './services/api';
import { indexedDBStorage, type SegmentedProjectStorage } from './services/segmentedProjectStorage';
import { downloadProjectBundle, importProjectBundleFromFile } from './services/projectBundle';
import { backendStorage } from './services/backendSegmentedProjectStorage';
import { createInitialProject } from './hooks/useSegmentedProject';
import { StorageModeContext, type StorageMode } from './hooks/useStorageMode';
import { CapabilitiesProvider } from './hooks/CapabilitiesProvider';
import { useCapabilities } from './hooks/useCapabilities';
import { VoiceRefreshProvider } from './hooks/VoiceRefreshProvider';
import { ThemeProvider } from './hooks/useTheme';
import { TranslationProvider, useTranslation } from './i18n';
import { ToastProvider } from './components/ui/Toast';
import { useToast } from './components/ui/useToast';
import { ConfirmProvider } from './components/ui/Confirm';
import { useConfirm } from './components/ui/useConfirm';
import { AppShell, type GlobalNavId } from './components/AppShell/AppShell';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { UnlockGate } from './components/Auth/UnlockGate';
import { getToken, isAuthRequired, reloadPage } from './services/auth';
import type { SegmentedProject } from './types';
import styles from './App.module.css';

const SCRATCHPAD_PROJECT_ID = '__scratchpad__';

type Page = 'home';
type Tab = 'tts-synthesis' | 'voice-clone' | 'speech-to-text' | 'model-config';
type View = Page | Tab;

function SettingsSelect() {
  const { mode, setMode } = useStorageModeContext();
  const { features } = useCapabilities();
  const { t } = useTranslation();
  return (
    <select value={mode} onChange={(e) => setMode(e.target.value as StorageMode)}>
      {/* workers 模式无后端存储（spec 第 4 节），固定 frontend，不给出 backend 选项 */}
      {features.backend_storage && <option value="backend">{t('settings.backend')}</option>}
      <option value="frontend">{t('settings.frontend')}</option>
    </select>
  );
}

function useStorageModeContext() {
  return useContext(StorageModeContext);
}

function storageForMode(mode: StorageMode): SegmentedProjectStorage {
  return mode === 'backend' ? backendStorage : indexedDBStorage;
}

function AppContent() {
  const [activeView, setActiveView] = useState<View>('home');
  const [activeTab, setActiveTab] = useState<Tab>('tts-synthesis');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<SegmentedProject[]>([]);
  const [storageMode, setStorageMode] = useState<StorageMode>('frontend');
  const [storageModeLoaded, setStorageModeLoaded] = useState(false);
  const capabilities = useCapabilities();

  // workers 模式固定 frontend 存储（spec 第 4 节）：即使后端配置残留 backend 也强制走 IndexedDB
  const effectiveStorageMode: StorageMode = capabilities.features.backend_storage ? storageMode : 'frontend';
  const projectStorage = storageForMode(effectiveStorageMode);
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    configApi.getStorageMode().then(
      (data) => { setStorageMode(data.storage_mode as StorageMode); setStorageModeLoaded(true); },
      () => { console.warn('Failed to load storage mode, using default frontend'); setStorageModeLoaded(true); },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    projectStorage.listProjects()
      .then(list => {
        if (!cancelled) {
          const filtered = list.filter(p => p.id !== SCRATCHPAD_PROJECT_ID);
          setProjects(filtered.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
        }
      })
      .catch(error => console.warn('Failed to load project hub list:', error));
    return () => { cancelled = true; };
  }, [projectStorage]);

  const handleSetStorageMode = async (mode: StorageMode) => {
    try {
      await configApi.setStorageMode(mode);
      setStorageMode(mode);
      setActiveProjectId(null);
    } catch {
      console.error('Failed to save storage mode');
    }
  };

  const handleNavigate = (tab: Tab) => {
    setActiveProjectId(null);
    setActiveTab(tab);
    setActiveView(tab);
  };

  const handleTabClick = (tab: Tab) => {
    setActiveProjectId(null);
    setActiveTab(tab);
    setActiveView(tab);
  };

  const refreshProjects = async () => {
    const list = await projectStorage.listProjects();
    setProjects(list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
  };

  const handleCreateProject = async (name?: string, logo?: string | null) => {
    try {
      const project = createInitialProject(t);
      project.name = name || `${t('project.createDefault')} ${projects.length + 1}`;
      if (logo) project.logo = logo;
      await projectStorage.saveProject(project, { mode: 'immediate' });
      await refreshProjects();
      setActiveTab('tts-synthesis');
      setActiveView('tts-synthesis');
      setActiveProjectId(project.id);
    } catch (err) {
      console.error('Create project failed:', err);
      toast.error(t('projectHub.createFailed'));
    }
  };

  const handleDeleteProjectFromHub = async (projectId: string) => {
    const target = projects.find(project => project.id === projectId);
    const targetName = target?.name ?? t('project.unknownProject');
    const ok = await confirm({
      title: t('tts.deleteProject'),
      message: t('tts.deleteProjectConfirm', { name: targetName }),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await projectStorage.deleteProject(projectId);
      await refreshProjects();
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
      }
    } catch (err) {
      console.error('Delete project failed:', err);
      toast.error(t('projectHub.deleteFailed'));
    }
  };

  const handleRenameProjectFromHub = async (projectId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) return;
    try {
      // Always fetch full project data (with chapters) to avoid overwriting with summary data
      const existingProject = await projectStorage.getProject(projectId);
      if (!existingProject) return;
      await projectStorage.saveProject({
        ...existingProject,
        name: nextName,
        updated_at: new Date().toISOString(),
      }, { mode: 'immediate' });
      await refreshProjects();
    } catch (err) {
      console.error('Rename project failed:', err);
      toast.error(t('projectHub.renameFailed'));
    }
  };

  const handleExportProject = async (projectId: string) => {
    try {
      if (effectiveStorageMode === 'frontend') {
        // 前端模式：本地打包（与后端同构 .narraforge.zip），不依赖后端导出端点
        const project = await projectStorage.getProject(projectId);
        if (!project) throw new Error('project_not_found');
        await downloadProjectBundle(project);
      } else {
        await segmentedProjectApi.exportProject(projectId);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('projectHub.import.failed'));
    }
  };

  const handleImportProject = async (file: File) => {
    try {
      if (effectiveStorageMode === 'frontend') {
        // 前端模式：解包适配为 IndexedDB 项目（后端包同样可导）
        await importProjectBundleFromFile(file);
      } else {
        await segmentedProjectApi.importProject(file);
      }
      await refreshProjects();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: unknown } } };
      const rawDetail = e?.response?.data?.detail;
      const detail = typeof rawDetail === 'string' ? rawDetail
        : (typeof rawDetail === 'object' && rawDetail !== null && 'message' in rawDetail)
          ? (rawDetail as { message: string }).message
          : undefined;
      toast.error(detail ? `${t('projectHub.import.failed')}: ${detail}` : t('projectHub.import.failed'));
    }
  };

  const activeGlobalNav: GlobalNavId =
    activeTab === 'speech-to-text' ? 'subtitles'
      : activeTab === 'voice-clone' ? 'voice-design'
        : activeTab === 'model-config' ? 'settings'
          : 'projects';

  const handleGlobalNavigate = (id: GlobalNavId) => {
    setActiveProjectId(null);
    const nextTab: Tab =
      id === 'subtitles' ? 'speech-to-text'
        : id === 'voice-design' ? 'voice-clone'
          : id === 'settings' ? 'model-config'
            : 'tts-synthesis';
    handleTabClick(nextTab);
  };

  const settingsSlot = (
    <div className={styles.shellSettings}>
      <span className={styles.storageLabel}>{t('settings.storage')}</span>
      <SettingsSelect />
      <LanguageSwitcher />
    </div>
  );

  const isHome = activeView === 'home';
  const inProjectWorkspace = activeTab === 'tts-synthesis' && !!activeProjectId;

  return (
    <StorageModeContext.Provider value={{ mode: effectiveStorageMode, setMode: handleSetStorageMode }}>
      <div className={styles.app}>
        {isHome && <Landing onNavigate={handleNavigate} />}

        {!isHome && (
          <AppShell
            activeNavId={activeGlobalNav}
            onNavigate={handleGlobalNavigate}
            rightSlot={settingsSlot}
            hideSidebar={inProjectWorkspace}
            hiddenNavIds={capabilities.features.speech_to_text ? [] : ['subtitles']}
          >
            <VoiceRefreshProvider>
              <main className={styles.main}>
                {activeTab === 'tts-synthesis' && !activeProjectId && (
                  <ProjectHub
                    projects={projects}
                    onOpenProject={(projectId) => setActiveProjectId(projectId)}
                    onCreateProject={(name, logo) => { void handleCreateProject(name, logo); }}
                    onDeleteProject={(projectId) => { void handleDeleteProjectFromHub(projectId); }}
                    onRenameProject={(projectId, name) => { void handleRenameProjectFromHub(projectId, name); }}
                    onExportProject={(projectId) => { void handleExportProject(projectId); }}
                    onImportProject={(file) => { void handleImportProject(file); }}
                  />
                )}
                {activeTab === 'tts-synthesis' && activeProjectId && storageModeLoaded && (
                  <TTSSynthesis
                    key={activeProjectId}
                    initialProjectId={activeProjectId}
                    hideProjectSidebar
                    onBackToProjects={() => setActiveProjectId(null)}
                    onNavigateToClone={() => handleTabClick('voice-clone')}
                  />
                )}
                <div style={{ display: activeTab === 'voice-clone' ? 'block' : 'none' }}>
                  <VoiceClone />
                </div>
                <div style={{ display: activeTab === 'speech-to-text' ? 'block' : 'none' }}>
                  <SpeechToText />
                </div>
                <div style={{ display: activeTab === 'model-config' ? 'block' : 'none' }}>
                  <ModelConfig />
                </div>
              </main>
            </VoiceRefreshProvider>
          </AppShell>
        )}
      </div>
    </StorageModeContext.Provider>
  );
}

export default function App() {
  // 无域名部署的共享口令门控（spec 5.2b）：auth 开启且本地无口令时只渲染解锁页；
  // 解锁成功后整页刷新，Capabilities 等启动探测带口令重试。
  // 本地开发不设 VITE_AUTH_REQUIRED，isAuthRequired() 恒 false，行为不变。
  const [locked] = useState(() => isAuthRequired() && !getToken());
  if (locked) {
    return (
      <ThemeProvider>
        <TranslationProvider>
          <UnlockGate onUnlocked={reloadPage} />
        </TranslationProvider>
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider>
      <TranslationProvider>
        <ToastProvider>
          <ConfirmProvider>
            <CapabilitiesProvider>
              <AppContent />
            </CapabilitiesProvider>
          </ConfirmProvider>
        </ToastProvider>
      </TranslationProvider>
    </ThemeProvider>
  );
}
