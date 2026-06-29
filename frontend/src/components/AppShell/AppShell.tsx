import { useState, type ReactNode } from 'react';
import { useTranslation, navItems } from '../../i18n';
import styles from './AppShell.module.css';

export type GlobalNavId = 'projects' | 'subtitles' | 'voice-design' | 'settings';

interface AppShellProps {
  activeNavId: GlobalNavId;
  children: ReactNode;
  rightSlot?: ReactNode;
  hideSidebar?: boolean;
  onNavigate: (id: GlobalNavId) => void;
}

const NAV_ICONS: Record<GlobalNavId, string> = {
  projects: '▦',
  subtitles: '▤',
  'voice-design': '◉',
  settings: '⚙',
};

export function AppShell({
  activeNavId,
  children,
  rightSlot,
  hideSidebar = false,
  onNavigate,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useTranslation();

  return (
    <div className={styles.shell} data-collapsed={collapsed ? 'true' : 'false'} data-testid="app-shell">
      <header className={styles.header}>
        <div className={styles.brandArea}>
          <button type="button" className={styles.brandMark} onClick={() => onNavigate('projects')}>
            NF
          </button>
          <div className={styles.brandTextBlock}>
            <div className={styles.brandText}>NarraForge</div>
            <div className={styles.brandSubtext}>{t('appShell.studioWorkspace')}</div>
          </div>
        </div>

        <div className={styles.headerActions}>{rightSlot}</div>
      </header>

      {!hideSidebar && (
      <aside className={styles.sidebar} aria-label="Global navigation">
        <div className={styles.sidebarTitle}>
          <span className={styles.sidebarIcon}>✦</span>
          {!collapsed && <span>{t('appShell.workspaceHub')}</span>}
        </div>

        <nav className={styles.navList}>
          {navItems.map(item => {
            const id = item.id as GlobalNavId;
            const active = id === activeNavId;
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? t(item.labelKey) : undefined}
                title={collapsed ? t(item.labelKey) : undefined}
                onClick={() => onNavigate(id)}
              >
                <span className={styles.navIcon}>{NAV_ICONS[id]}</span>
                {!collapsed && <span className={styles.navLabel}>{t(item.labelKey)}</span>}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          className={styles.collapseButton}
          aria-label={collapsed ? t('appShell.expandNav') : t('appShell.collapseNav')}
          onClick={() => setCollapsed(value => !value)}
        >
          <span>{collapsed ? '›' : '‹'}</span>
          {!collapsed && <span>{t('appShell.collapseNav')}</span>}
        </button>
      </aside>
      )}

      <main className={`${styles.content} ${hideSidebar ? styles.contentFull : ''}`}>{children}</main>
    </div>
  );
}
