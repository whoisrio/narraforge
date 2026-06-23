import { useState, type ReactNode } from 'react';
import { createTranslator, navItems, type Locale } from '../../i18n';
import styles from './AppShell.module.css';

export type GlobalNavId = 'projects' | 'subtitles' | 'voice-design' | 'settings';

interface AppShellProps {
  activeNavId: GlobalNavId;
  locale?: Locale;
  children: ReactNode;
  rightSlot?: ReactNode;
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
  locale = 'zh-CN',
  children,
  rightSlot,
  onNavigate,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const t = createTranslator(locale);

  return (
    <div className={styles.shell} data-collapsed={collapsed ? 'true' : 'false'} data-testid="app-shell">
      <header className={styles.header}>
        <div className={styles.brandArea}>
          <button type="button" className={styles.brandMark} onClick={() => onNavigate('projects')}>
            NF
          </button>
          <div className={styles.brandTextBlock}>
            <div className={styles.brandText}>NarraForge</div>
            <div className={styles.brandSubtext}>Studio Workspace</div>
          </div>
        </div>

        <div className={styles.headerCenter}>
          <span className={styles.headerPill}>Warm Amber Studio</span>
          <span className={styles.headerStatus}>
            <span className={styles.statusDot} />
            Local workspace
          </span>
        </div>

        <div className={styles.headerActions}>{rightSlot}</div>
      </header>

      <aside className={styles.sidebar} aria-label="Global navigation">
        <div className={styles.sidebarTitle}>
          <span className={styles.sidebarIcon}>✦</span>
          {!collapsed && <span>Workspace Hub</span>}
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
          aria-label={collapsed ? '展开导航' : '收起导航'}
          onClick={() => setCollapsed(value => !value)}
        >
          <span>{collapsed ? '›' : '‹'}</span>
          {!collapsed && <span>收起</span>}
        </button>
      </aside>

      <main className={styles.content}>{children}</main>
    </div>
  );
}
