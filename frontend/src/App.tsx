import { useState, useEffect, useContext } from 'react';
import Landing from './pages/Landing';
import { VoiceClone } from './pages/VoiceClone';
import { TTSSynthesis } from './pages/TTSSynthesis';
import { SpeechToText } from './pages/SpeechToText';
import { ModelConfig } from './pages/ModelConfig';
import { ProjectHub } from './components/ProjectHub/ProjectHub';
import { configApi } from './services/api';
import { indexedDBStorage, type SegmentedProjectStorage } from './services/segmentedProjectStorage';
import { backendStorage } from './services/backendSegmentedProjectStorage';
import { createInitialProject } from './hooks/useSegmentedProject';
import { StorageModeContext, type StorageMode } from './hooks/useStorageMode';
import { VoiceRefreshProvider } from './hooks/useVoiceRefresh';
import { ThemeProvider } from './hooks/useTheme';
import { AppShell, type GlobalNavId } from './components/AppShell/AppShell';
import type { SegmentedProject } from './types';
import styles from './App.module.css';

type Page = 'home';
type Tab = 'tts-synthesis' | 'voice-clone' | 'speech-to-text' | 'model-config';
type View = Page | Tab;

function SettingsSelect() {
  const { mode, setMode } = useStorageModeContext();
  return (
    <select value={mode} onChange={(e) => setMode(e.target.value as StorageMode)}>
      <option value="backend">后端存储</option>
      <option value="frontend">浏览器存储</option>
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
  const [activeView, setActiveView] = useState<View>('tts-synthesis');
  const [activeTab, setActiveTab] = useState<Tab>('tts-synthesis');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<SegmentedProject[]>([]);
  const [storageMode, setStorageMode] = useState<StorageMode>('frontend');

  const projectStorage = storageForMode(storageMode);

  useEffect(() => {
    configApi.getStorageMode().then(
      (data) => setStorageMode(data.storage_mode as StorageMode),
      () => console.warn('Failed to load storage mode, using default frontend'),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    projectStorage.listProjects()
      .then(list => {
        if (!cancelled) setProjects(list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
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

  const handleCreateProject = async () => {
    const project = createInitialProject();
    project.name = `新项目 ${projects.length + 1}`;
    await projectStorage.saveProject(project, { mode: 'immediate' });
    const list = await projectStorage.listProjects();
    setProjects(list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
    setActiveTab('tts-synthesis');
    setActiveView('tts-synthesis');
    setActiveProjectId(project.id);
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
      <span className={styles.storageLabel}>存储</span>
      <SettingsSelect />
    </div>
  );

  const isHome = activeView === 'home';
  const inProjectWorkspace = activeTab === 'tts-synthesis' && !!activeProjectId;

  return (
    <StorageModeContext.Provider value={{ mode: storageMode, setMode: handleSetStorageMode }}>
      <div className={styles.app}>
        {isHome && <Landing onNavigate={handleNavigate} />}

        {!isHome && (
          <AppShell
            activeNavId={activeGlobalNav}
            onNavigate={handleGlobalNavigate}
            rightSlot={settingsSlot}
            hideSidebar={inProjectWorkspace}
          >
            <VoiceRefreshProvider>
              <main className={styles.main}>
                {activeTab === 'tts-synthesis' && !activeProjectId && (
                  <ProjectHub
                    projects={projects}
                    onOpenProject={(projectId) => setActiveProjectId(projectId)}
                    onCreateProject={() => { void handleCreateProject(); }}
                  />
                )}
                {activeTab === 'tts-synthesis' && activeProjectId && (
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
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
