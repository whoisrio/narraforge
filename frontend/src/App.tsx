import { useState, useEffect, useContext } from 'react';
import Landing from './pages/Landing';
import { VoiceClone } from './pages/VoiceClone';
import { TTSSynthesis } from './pages/TTSSynthesis';
import { SpeechToText } from './pages/SpeechToText';
import { ModelConfig } from './pages/ModelConfig';
import { configApi } from './services/api';
import { StorageModeContext, type StorageMode } from './hooks/useStorageMode';
import { VoiceRefreshProvider } from './hooks/useVoiceRefresh';
import { ThemeProvider } from './hooks/useTheme';
import { AppShell, type GlobalNavId } from './components/AppShell/AppShell';
import styles from './App.module.css';

/** 页面状态：主页 或 三个工具页 + 设置 */
type Page = 'home';
type Tab = 'tts-synthesis' | 'voice-clone' | 'speech-to-text' | 'model-config';
type View = Page | Tab;

/** 导航栏 + 主题切换 */
function AppHeader({
  activeTab,
  onTabClick,
  onBack,
}: {
  activeTab: Tab;
  onTabClick: (tab: Tab) => void;
  onBack: () => void;
}) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <header className={styles.header}>
      <button
        className={styles.backButton}
        onClick={onBack}
        title="返回首页"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M11 4L6 9L11 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className={styles.logoText}>Narra Forge</span>
      </button>

      <nav className={styles.tabs}>
        <button
          data-testid="tab-tts-synthesis"
          className={`${styles.tab} ${activeTab === 'tts-synthesis' ? styles.active : ''}`}
          onClick={() => onTabClick('tts-synthesis')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15V6"/>
            <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/>
            <path d="M12 12H3"/>
            <path d="M16 6H3"/>
            <path d="M12 18H3"/>
          </svg>
          文字转语音
        </button>
        <button
          data-testid="tab-voice-clone"
          className={`${styles.tab} ${activeTab === 'voice-clone' ? styles.active : ''}`}
          onClick={() => onTabClick('voice-clone')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" x2="12" y1="19" y2="22"/>
          </svg>
          音色设计
        </button>
        <button
          data-testid="tab-speech-to-text"
          className={`${styles.tab} ${activeTab === 'speech-to-text' ? styles.active : ''}`}
          onClick={() => onTabClick('speech-to-text')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7V4h16v3"/>
            <path d="M9 20h6"/>
            <path d="M12 4v16"/>
          </svg>
          语音转字幕
        </button>
      </nav>

      <div className={styles.headerActions}>
        <div className={styles.settingsArea}>
          <button
            className={styles.settingsButton}
            onClick={() => setShowSettings(!showSettings)}
            title="设置"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
          {showSettings && (
            <div className={styles.settingsPanel}>
              <button
                className={styles.settingsNavBtn}
                onClick={() => { onTabClick('model-config'); setShowSettings(false); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                模型配置
              </button>
              <div className={styles.settingsDivider} />
              <div className={styles.settingsItem}>
                <label>存储模式</label>
                <SettingsSelect />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/** 设置面板中的存储模式选择器 */
function SettingsSelect() {
  const { mode, setMode } = useStorageModeContext();
  return (
    <select
      value={mode}
      onChange={(e) => setMode(e.target.value as StorageMode)}
    >
      <option value="backend">后端存储</option>
      <option value="frontend">浏览器存储</option>
    </select>
  );
}

function useStorageModeContext() {
  return useContext(StorageModeContext);
}

/** 应用主体 */
function AppContent() {
  const [activeView, setActiveView] = useState<View>('tts-synthesis');
  const [activeTab, setActiveTab] = useState<Tab>('tts-synthesis');
  const [storageMode, setStorageMode] = useState<StorageMode>('frontend');

  useEffect(() => {
    configApi.getStorageMode().then(
      (data) => setStorageMode(data.storage_mode as StorageMode),
      () => console.warn('Failed to load storage mode, using default frontend'),
    );
  }, []);

  const handleSetStorageMode = async (mode: StorageMode) => {
    try {
      await configApi.setStorageMode(mode);
      setStorageMode(mode);
    } catch {
      console.error('Failed to save storage mode');
    }
  };

  const handleNavigate = (tab: Tab) => {
    setActiveTab(tab);
    setActiveView(tab);
  };

  const handleTabClick = (tab: Tab) => {
    setActiveTab(tab);
    setActiveView(tab);
  };

  const activeGlobalNav: GlobalNavId =
    activeTab === 'speech-to-text' ? 'subtitles'
      : activeTab === 'voice-clone' ? 'voice-design'
        : activeTab === 'model-config' ? 'settings'
          : 'projects';

  const handleGlobalNavigate = (id: GlobalNavId) => {
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

  return (
    <StorageModeContext.Provider value={{ mode: storageMode, setMode: handleSetStorageMode }}>
      <div className={styles.app}>
        {isHome && <Landing onNavigate={handleNavigate} />}

        {!isHome && (
          <AppShell activeNavId={activeGlobalNav} onNavigate={handleGlobalNavigate} rightSlot={settingsSlot}>
            <VoiceRefreshProvider>
              <main className={styles.main}>
                <div style={{ display: activeTab === 'tts-synthesis' ? 'block' : 'none' }}>
                  <TTSSynthesis onNavigateToClone={() => handleTabClick('voice-clone')} />
                </div>
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
