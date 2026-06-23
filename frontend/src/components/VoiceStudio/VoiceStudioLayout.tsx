import type { ReactNode } from 'react';
import styles from './VoiceStudioLayout.module.css';

export type StudioViewMode = 'list' | 'dialogue';

interface VoiceStudioLayoutProps {
  projectName: string;
  chapterName: string;
  engineLabel: string;
  voiceRoleLabel: string;
  segmentCount: number;
  generatedCount: number;
  durationSec: number;
  queueCount: number;
  viewMode: StudioViewMode;
  remotionPath?: string | null;
  children: ReactNode;
  onViewModeChange: (mode: StudioViewMode) => void;
  onBatchSynthesize: () => void;
  onExport: () => void;
  onPlayAll: () => void;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function VoiceStudioLayout({
  projectName,
  chapterName,
  engineLabel,
  voiceRoleLabel,
  segmentCount,
  generatedCount,
  durationSec,
  queueCount,
  viewMode,
  remotionPath,
  children,
  onViewModeChange,
  onBatchSynthesize,
  onExport,
  onPlayAll,
}: VoiceStudioLayoutProps) {
  const progress = segmentCount === 0 ? 0 : Math.round((generatedCount / segmentCount) * 100);

  return (
    <section className={styles.root} data-testid="voice-studio-layout">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <div className={styles.breadcrumbs}>
            <span>{projectName}</span>
            <span>/</span>
            <strong>{chapterName}</strong>
          </div>
          <h2>Voice Studio</h2>
          <p>Production Timeline for segmented narration synthesis.</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.meter} aria-label="Processing Status">
            <span />
            <span />
            <span />
            <span />
          </div>
          <button type="button" className={styles.primaryButton} onClick={onBatchSynthesize}>批量合成</button>
        </div>
      </header>

      <div className={styles.workspaceGrid}>
        <main className={styles.timelinePanel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.kicker}>Production Timeline</span>
              <h3>{chapterName}</h3>
            </div>
            <div className={styles.viewSwitch}>
              <button type="button" aria-pressed={viewMode === 'list'} onClick={() => onViewModeChange('list')}>列表视图</button>
              <button type="button" aria-pressed={viewMode === 'dialogue'} onClick={() => onViewModeChange('dialogue')}>对话视图</button>
            </div>
          </div>
          <div className={styles.segmentCanvas}>{children}</div>
        </main>

        <aside className={styles.sidePanel}>
          <section className={styles.sideCard}>
            <div className={styles.sideTitle}>Session Monitor</div>
            <div className={styles.statGrid}>
              <div><span>分段</span><strong>{segmentCount} 段</strong></div>
              <div><span>完成</span><strong>{generatedCount} 已生成</strong></div>
              <div><span>时长</span><strong>{formatDuration(durationSec)}</strong></div>
              <div><span>进度</span><strong>{progress}%</strong></div>
            </div>
          </section>

          <section className={styles.sideCard}>
            <div className={styles.sideTitle}>Synthesis Queue</div>
            <div className={styles.queueRow}>
              <span>{queueCount} active</span>
              <div className={styles.queueTrack}><span style={{ width: `${Math.min(100, queueCount * 28)}%` }} /></div>
            </div>
          </section>

          <section className={styles.sideCard}>
            <div className={styles.sideTitle}>Global Engine</div>
            <div className={styles.engineRow}><span>Engine</span><strong>{engineLabel}</strong></div>
            <div className={styles.engineRow}><span>Voice Role</span><strong>{voiceRoleLabel}</strong></div>
          </section>
        </aside>
      </div>

      <footer className={styles.transportBar}>
        <div className={styles.transportControls}>
          <button type="button" className={styles.roundButton}>‹</button>
          <button type="button" className={styles.playButton} onClick={onPlayAll}>全部播放</button>
          <button type="button" className={styles.roundButton}>›</button>
        </div>
        <div className={styles.masterTimeline}>
          <span>Master Transport</span>
          <div className={styles.masterTrack}><span style={{ width: `${progress}%` }} /></div>
          <strong>{formatDuration(durationSec)}</strong>
        </div>
        <div className={styles.exportGroup}>
          <span className={styles.remotionPath}>{remotionPath || '未设置 Remotion 路径'}</span>
          <button type="button" className={styles.primaryButton} onClick={onExport}>导出</button>
        </div>
      </footer>
    </section>
  );
}
