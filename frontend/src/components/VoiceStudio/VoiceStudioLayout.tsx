import { useState, type CSSProperties, type ReactNode } from 'react';
import styles from './VoiceStudioLayout.module.css';

export type StudioViewMode = 'list' | 'dialogue';

interface VoiceStudioLayoutProps {
  segmentCount: number;
  generatedCount: number;
  durationSec: number;
  remotionPath?: string | null;
  children: ReactNode;
  sidebarContent?: ReactNode;
  onSidebarCollapseChange?: (collapsed: boolean) => void;
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
  segmentCount,
  generatedCount,
  durationSec,
  remotionPath,
  children,
  sidebarContent,
  onSidebarCollapseChange,
  onExport,
  onPlayAll,
}: VoiceStudioLayoutProps) {
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);

  const toggleCollapsed = (next: boolean) => {
    setSidePanelCollapsed(next);
    onSidebarCollapseChange?.(next);
  };
  const progress = segmentCount === 0 ? 0 : Math.round((generatedCount / segmentCount) * 100);
  const rightPanelWidth = sidePanelCollapsed ? '48px' : '300px';
  const transportBarStyle = { right: 'calc(var(--studio-right-panel-width) + 28px)' } as CSSProperties;

  return (
    <section
      className={styles.root}
      data-testid="voice-studio-layout"
      data-side-panel-collapsed={sidePanelCollapsed ? 'true' : 'false'}
      style={{ '--studio-right-panel-width': rightPanelWidth } as CSSProperties}
    >
      <main className={styles.mainContent} data-testid="voice-studio-main-content">
        <div className={styles.segmentCanvas}>{children}</div>
      </main>

      <aside className={styles.sidePanel}>
        {!sidePanelCollapsed && (
          <>
            <div className={styles.sidePanelHeader}>
              <span className={styles.sidePanelTitle}>语音设置</span>
            </div>
            <div className={styles.sidePanelBody}>
              {sidebarContent}
            </div>
          </>
        )}
        <button
          type="button"
          className={styles.collapseButton}
          data-testid="voice-studio-side-panel-toggle"
          aria-label={sidePanelCollapsed ? '展开右侧面板' : '收起右侧面板'}
          onClick={() => toggleCollapsed(!sidePanelCollapsed)}
        >
          <span>{sidePanelCollapsed ? '‹' : '›'}</span>
          {!sidePanelCollapsed && <span>收起</span>}
        </button>
      </aside>

      <footer className={styles.transportBar} data-testid="voice-studio-transport-bar" style={transportBarStyle}>
        <div className={styles.transportControls}>
          <button type="button" className={styles.roundButton}>‹</button>
          <button type="button" className={styles.playButton} onClick={onPlayAll}>播放</button>
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
