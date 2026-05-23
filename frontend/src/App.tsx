import { useState, useEffect } from 'react';
import { VoiceClone } from './pages/VoiceClone';
import { TTSSynthesis } from './pages/TTSSynthesis';
import { SpeechToText } from './pages/SpeechToText';
import { configApi } from './services/api';
import { StorageModeContext, type StorageMode } from './hooks/useStorageMode';
import styles from './App.module.css';

type Tab = 'voice-clone' | 'tts-synthesis' | 'speech-to-text';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('voice-clone');
  const [storageMode, setStorageMode] = useState<StorageMode>('backend');
  const [showSettings, setShowSettings] = useState(false);

  // 启动时从后端加载存储模式配置
  useEffect(() => {
    configApi.getStorageMode().then(
      (data) => setStorageMode(data.storage_mode as StorageMode),
      () => console.warn('Failed to load storage mode, using default backend'),
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

  return (
    <StorageModeContext.Provider value={{ mode: storageMode, setMode: handleSetStorageMode }}>
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.logo}>
            <span>🎙️</span>
            <span>Voice Clone Studio</span>
          </div>

          <nav className={styles.tabs}>
            <button
              data-testid="tab-voice-clone"
              className={`${styles.tab} ${activeTab === 'voice-clone' ? styles.active : ''}`}
              onClick={() => setActiveTab('voice-clone')}
            >
              声音克隆
            </button>
            <button
              data-testid="tab-tts-synthesis"
              className={`${styles.tab} ${activeTab === 'tts-synthesis' ? styles.active : ''}`}
              onClick={() => setActiveTab('tts-synthesis')}
            >
              文字转语音
            </button>
            <button
              data-testid="tab-speech-to-text"
              className={`${styles.tab} ${activeTab === 'speech-to-text' ? styles.active : ''}`}
              onClick={() => setActiveTab('speech-to-text')}
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
              ⚙️
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

        <main className={styles.main}>
          {/* 三页面全挂载，CSS 控制显隐，切换时不丢失状态 */}
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
      </div>
    </StorageModeContext.Provider>
  );
}