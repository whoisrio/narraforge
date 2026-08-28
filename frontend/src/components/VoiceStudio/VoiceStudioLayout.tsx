import { useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { BatchSynthesizeMenu, type BatchSynthesizeMode } from '../SegmentedTTS/BatchSynthesizeMenu';
import styles from './VoiceStudioLayout.module.css';

export type StudioViewMode = 'list' | 'dialogue';

interface VoiceStudioLayoutProps {
  remotionPath?: string | null;
  children: ReactNode;
  sidebarContent?: ReactNode;
  onSidebarCollapseChange?: (collapsed: boolean) => void;
  onExport: () => void;
  onExportAll?: () => void;
  onProduceAll?: (mode: BatchSynthesizeMode) => void;
  /** 一键制作全本下拉的禁用态（通常等于全局 generating） */
  produceAllDisabled?: boolean;
  onAdjustAudio?: () => void;
}

export function VoiceStudioLayout({
  remotionPath,
  children,
  sidebarContent,
  onSidebarCollapseChange,
  onExport,
  onExportAll,
  onProduceAll,
  produceAllDisabled,
  onAdjustAudio,
}: VoiceStudioLayoutProps) {
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
  const [transportCollapsed, setTransportCollapsed] = useState(true);
  const { t } = useTranslation();

  const toggleCollapsed = (next: boolean) => {
    setSidePanelCollapsed(next);
    onSidebarCollapseChange?.(next);
  };
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

      <footer className={`${styles.transportBar} ${transportCollapsed ? styles.transportBarCollapsed : ''}`} data-testid="voice-studio-transport-bar" style={transportBarStyle}>
        <button
          type="button"
          className={styles.transportToggle}
          onClick={() => setTransportCollapsed(!transportCollapsed)}
          aria-label={transportCollapsed ? '展开工具栏' : '收起工具栏'}
        >
          {transportCollapsed ? '▲' : '▼'}
          {transportCollapsed && <span className={styles.transportToggleLabel}>工具栏</span>}
        </button>
        {!transportCollapsed && (
        <div className={styles.exportGroup}>
          <span className={styles.remotionPath}>{remotionPath || '未设置 Remotion 路径'}</span>
          {onProduceAll && (
            <BatchSynthesizeMenu
              label={t('studio.produceAll')}
              disabled={produceAllDisabled}
              onSelect={onProduceAll}
              placement="up"
            />
          )}
          {onAdjustAudio && (
          <button type="button" className={styles.ghostButton ?? styles.primaryButton} onClick={onAdjustAudio}>{t('studio.adjustAudio')}</button>
        )}
          <button type="button" className={styles.primaryButton} onClick={onExport}>{t('studio.exportLabel')}</button>
          {onExportAll && (
          <button type="button" className={styles.ghostButton ?? styles.primaryButton} onClick={onExportAll}>{t('studio.exportAll')}</button>
        )}
        </div>
        )}
      </footer>
    </section>
  );
}
