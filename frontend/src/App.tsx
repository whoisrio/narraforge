import { useState } from 'react';
import { VoiceClone } from './pages/VoiceClone';
import { TTSSynthesis } from './pages/TTSSynthesis';
import styles from './App.module.css';

type Tab = 'voice-clone' | 'tts-synthesis';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('voice-clone');

  return (
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
        </nav>
      </header>

      <main className={styles.main}>
        {activeTab === 'voice-clone' && <VoiceClone />}
        {activeTab === 'tts-synthesis' && <TTSSynthesis />}
      </main>
    </div>
  );
}
