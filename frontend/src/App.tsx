import { useState, useEffect } from 'react';
import Landing from './pages/Landing';
import { VoiceClone } from './pages/VoiceClone';
import { TTSSynthesis } from './pages/TTSSynthesis';
import { SpeechToText } from './pages/SpeechToText';
import { configApi } from './services/api';
import { StorageModeContext, type StorageMode } from './hooks/useStorageMode';
import { VoiceRefreshProvider, useVoiceRefresh } from './hooks/useVoiceRefresh';
import styles from './App.module.css';

/** 页面状态：主页 或 三个工具页 */
type Page = 'home';
type Tab = 'voice-clone' | 'tts-synthesis' | 'speech-to-text';
type View = Page | Tab;

export default function App() {
  const [activeView, setActiveView] = useState<View>('home');
  const [activeTab, setActiveTab] = useState<Tab>('voice-clone');
  const [storageMode, setStorageMode] = useState<StorageMode>('frontend');
  const [showSettings, setShowSettings] = useState(false);

  // 启动时从后端加载存储模式配置
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

  /** 从 Landing 页跳转到指定工具页 */
  const handleNavigate = (tab: Tab) => {
    setActiveTab(tab);
    setActiveView(tab);
  };

  /** 工具页顶部 Tab 点击 */
  const handleTabClick = (tab: Tab) => {
    setActiveTab(tab);
    setActiveView(tab);
  };

  const isHome = activeView === 'home';

  return (
    <StorageModeContext.Provider value={{ mode: storageMode, setMode: handleSetStorageMode }}>
      <div className={styles.app}>
        {/* 主页时不显示顶部导航栏 */}
        {!isHome && (
          <header className={styles.header}>
            <button
              className={styles.backButton}
              onClick={() => setActiveView('home')}
              title="返回首页"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M11 4L6 9L11 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className={styles.logoText}>Voice Studio</span>
            </button>

            <nav className={styles.tabs}>
              <button
                data-testid="tab-voice-clone"
                className={`${styles.tab} ${activeTab === 'voice-clone' ? styles.active : ''}`}
                onClick={() => handleTabClick('voice-clone')}
              >
                声音克隆
              </button>
              <button
                data-testid="tab-tts-synthesis"
                className={`${styles.tab} ${activeTab === 'tts-synthesis' ? styles.active : ''}`}
                onClick={() => handleTabClick('tts-synthesis')}
              >
                文字转语音
              </button>
              <button
                data-testid="tab-speech-to-text"
                className={`${styles.tab} ${activeTab === 'speech-to-text' ? styles.active : ''}`}
                onClick={() => handleTabClick('speech-to-text')}
              >
                语音转字幕
              </button>
            </nav>

            {/* 设置入口 */}
            <div className={styles.settingsArea}>
              <button
                className={styles.settingsButton}
                onClick={() => setShowSettings(!showSettings)}
                title="设置"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M8 1V3.5M8 12.5V15M15 8H12.5M3.5 8H1M12.95 3.05L11.18 4.82M4.82 11.18L3.05 12.95M12.95 12.95L11.18 11.18M4.82 4.82L3.05 3.05" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </button>
              {showSettings && (
                <div className={styles.settingsPanel}>
                  <div className={styles.settingsItem}>
                    <label>存储模式</label>
                    <select
                      value={storageMode}
                      onChange={(e) => handleSetStorageMode(e.target.value as StorageMode)}
                    >
                      <option value="backend">后端存储</option>
                      <option value="frontend">浏览器存储</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </header>
        )}

        {/* 主页 */}
        {isHome && <Landing onNavigate={handleNavigate} />}

        {/* 工具页 —— 三页面全挂载，CSS 控制显隐，切换时不丢失状态 */}
        {!isHome && (
          <VoiceRefreshProvider>
            <main className={styles.main}>
              <div style={{ display: activeTab === 'voice-clone' ? 'block' : 'none' }}>
                <VoiceClone />
              </div>
              <div style={{ display: activeTab === 'tts-synthesis' ? 'block' : 'none' }}>
                <TTSSynthesis />
              </div>
              <div style={{ display: activeTab === 'speech-to-text' ? 'block' : 'none' }}>
                <SpeechToText />
              </div>
            </main>
          </VoiceRefreshProvider>
        )}
      </div>
    </StorageModeContext.Provider>
  );
}