import { useState, useEffect, useContext } from 'react';
import Landing from './pages/Landing';
import { VoiceClone } from './pages/VoiceClone';
import { TTSSynthesis } from './pages/TTSSynthesis';
import { SpeechToText } from './pages/SpeechToText';
import { ModelConfig } from './pages/ModelConfig';
import { ProjectHub } from './components/ProjectHub/ProjectHub';
import { configApi, segmentedProjectApi } from './services/api';
import { indexedDBStorage, type SegmentedProjectStorage } from './services/segmentedProjectStorage';
import { downloadProjectBundle, importProjectBundleFromFile } from './services/projectBundle';
import { backendStorage } from './services/backendSegmentedProjectStorage';
import { createInitialProject } from './hooks/useSegmentedProject';
import { StorageModeContext, type StorageMode } from './hooks/useStorageMode';
import { CapabilitiesProvider } from './hooks/CapabilitiesProvider';
import { useCapabilities } from './hooks/useCapabilities';
import { VoiceRefreshProvider } from './hooks/VoiceRefreshProvider';
import { ThemeProvider } from './hooks/useTheme';
import { TranslationProvider, useTranslation } from './i18n';
import { ToastProvider } from './components/ui/Toast';
import { useToast } from './components/ui/useToast';
import { ConfirmProvider } from './components/ui/Confirm';
import { useConfirm } from './components/ui/useConfirm';
import { AppShell, type GlobalNavId } from './components/AppShell/AppShell';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { AuthPage } from './pages/Auth';
import { Admin } from './pages/Admin';
import { AuthProvider } from './hooks/AuthProvider';
import { useAuth } from './hooks/authContext';
import { isAuthRequired } from './services/auth';
import type { SegmentedProject } from './types';
import styles from './App.module.css';

const SCRATCHPAD_PROJECT_ID = '__scratchpad__';

/** 联系管理员邮箱（构建期 VITE_ADMIN_EMAIL 注入；未配置则不在侧栏展示入口） */
const ADMIN_CONTACT_EMAIL =
  (import.meta.env.VITE_ADMIN_EMAIL as string | undefined)?.trim() || undefined;

type Page = 'home' | 'auth';
type Tab = 'tts-synthesis' | 'voice-clone' | 'speech-to-text' | 'model-config' | 'admin';
type View = Page | Tab;

function SettingsSelect() {
  const { mode, setMode } = useStorageModeContext();
  const { features } = useCapabilities();
  const { isAnonymous } = useAuth();
  const { t } = useTranslation();
  return (
    <select
      value={mode}
      onChange={(e) => setMode(e.target.value as StorageMode)}
      title={isAnonymous ? t('auth.loginRequired') : undefined}
    >
      {/* workers 模式无后端存储（spec 第 4 节），固定 frontend，不给出 backend 选项；
          匿名用户同样只保留浏览器存储（后端持久化端点不在匿名 allowlist 内） */}
      {features.backend_storage && !isAnonymous && <option value="backend">{t('settings.backend')}</option>}
      <option value="frontend">{t('settings.frontend')}</option>
    </select>
  );
}

function useStorageModeContext() {
  return useContext(StorageModeContext);
}

function storageForMode(mode: StorageMode): SegmentedProjectStorage {
  return mode === 'backend' ? backendStorage : indexedDBStorage;
}

/** 登录用户菜单：邮箱 + 管理后台入口（isAdmin）+ 登出。 */
function UserMenu({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const { user, isAdmin, signOut } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className={styles.userMenu}>
      <button
        type="button"
        className={styles.userMenuTrigger}
        data-testid="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        {user.email}
      </button>
      {open && (
        <div className={styles.userMenuDropdown}>
          {isAdmin && (
            <button
              type="button"
              className={styles.userMenuItem}
              onClick={() => { setOpen(false); onOpenAdmin(); }}
            >
              {t('auth.adminEntry')}
            </button>
          )}
          <button
            type="button"
            className={styles.userMenuItem}
            onClick={() => { setOpen(false); void signOut(); }}
          >
            {t('auth.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

/** 匿名用户访问受限功能时的占位提示。 */
function LoginRequired({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.loginRequired} data-testid="login-required">
      <p className={styles.loginRequiredTitle}>{t('auth.loginRequired')}</p>
      <p className={styles.loginRequiredDesc}>{t('auth.loginRequiredDesc')}</p>
      <button type="button" className={styles.loginRequiredButton} onClick={onLogin}>
        {t('auth.login')}
      </button>
    </div>
  );
}

function AppContent() {
  const [activeView, setActiveView] = useState<View>('home');
  const [activeTab, setActiveTab] = useState<Tab>('tts-synthesis');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<SegmentedProject[]>([]);
  const [storageMode, setStorageMode] = useState<StorageMode>('frontend');
  const [storageModeLoaded, setStorageModeLoaded] = useState(false);
  const [anonBannerDismissed, setAnonBannerDismissed] = useState(false);
  const capabilities = useCapabilities();
  const { user, isAnonymous, loading: authLoading, sessionExpired, clearSessionExpired } = useAuth();

  // workers 模式固定 frontend 存储（spec 第 4 节）：即使后端配置残留 backend 也强制走 IndexedDB；
  // 匿名用户同样强制 frontend（后端持久化端点不在匿名 allowlist 内）
  const effectiveStorageMode: StorageMode =
    capabilities.features.backend_storage && !isAnonymous ? storageMode : 'frontend';
  const projectStorage = storageForMode(effectiveStorageMode);
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();

  // 会话彻底失效（refresh 失败）→ 跳登录页
  useEffect(() => {
    if (sessionExpired) {
      clearSessionExpired();
      setActiveView('auth');
    }
  }, [sessionExpired, clearSessionExpired]);

  useEffect(() => {
    configApi.getStorageMode().then(
      (data) => { setStorageMode(data.storage_mode as StorageMode); setStorageModeLoaded(true); },
      () => { console.warn('Failed to load storage mode, using default frontend'); setStorageModeLoaded(true); },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    projectStorage.listProjects()
      .then(list => {
        if (!cancelled) {
          const filtered = list.filter(p => p.id !== SCRATCHPAD_PROJECT_ID);
          setProjects(filtered.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
        }
      })
      .catch(error => console.warn('Failed to load project hub list:', error));
    return () => { cancelled = true; };
  }, [projectStorage]);

  const handleSetStorageMode = async (mode: StorageMode) => {
    if (mode === 'backend' && isAnonymous) return;
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

  const refreshProjects = async () => {
    const list = await projectStorage.listProjects();
    setProjects(list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()));
  };

  const handleCreateProject = async (name?: string, logo?: string | null) => {
    try {
      const project = createInitialProject(t);
      project.name = name || `${t('project.createDefault')} ${projects.length + 1}`;
      if (logo) project.logo = logo;
      await projectStorage.saveProject(project, { mode: 'immediate' });
      await refreshProjects();
      setActiveTab('tts-synthesis');
      setActiveView('tts-synthesis');
      setActiveProjectId(project.id);
    } catch (err) {
      console.error('Create project failed:', err);
      toast.error(t('projectHub.createFailed'));
    }
  };

  const handleDeleteProjectFromHub = async (projectId: string) => {
    const target = projects.find(project => project.id === projectId);
    const targetName = target?.name ?? t('project.unknownProject');
    const ok = await confirm({
      title: t('tts.deleteProject'),
      message: t('tts.deleteProjectConfirm', { name: targetName }),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await projectStorage.deleteProject(projectId);
      await refreshProjects();
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
      }
    } catch (err) {
      console.error('Delete project failed:', err);
      toast.error(t('projectHub.deleteFailed'));
    }
  };

  const handleRenameProjectFromHub = async (projectId: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) return;
    try {
      // Always fetch full project data (with chapters) to avoid overwriting with summary data
      const existingProject = await projectStorage.getProject(projectId);
      if (!existingProject) return;
      await projectStorage.saveProject({
        ...existingProject,
        name: nextName,
        updated_at: new Date().toISOString(),
      }, { mode: 'immediate' });
      await refreshProjects();
    } catch (err) {
      console.error('Rename project failed:', err);
      toast.error(t('projectHub.renameFailed'));
    }
  };

  const handleExportProject = async (projectId: string) => {
    try {
      if (effectiveStorageMode === 'frontend') {
        // 前端模式：本地打包（与后端同构 .narraforge.zip），不依赖后端导出端点
        const project = await projectStorage.getProject(projectId);
        if (!project) throw new Error('project_not_found');
        await downloadProjectBundle(project);
      } else {
        await segmentedProjectApi.exportProject(projectId);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('projectHub.import.failed'));
    }
  };

  const handleImportProject = async (file: File) => {
    try {
      if (effectiveStorageMode === 'frontend') {
        // 前端模式：解包适配为 IndexedDB 项目（后端包同样可导）
        await importProjectBundleFromFile(file);
      } else {
        await segmentedProjectApi.importProject(file);
      }
      await refreshProjects();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: unknown } } };
      const rawDetail = e?.response?.data?.detail;
      const detail = typeof rawDetail === 'string' ? rawDetail
        : (typeof rawDetail === 'object' && rawDetail !== null && 'message' in rawDetail)
          ? (rawDetail as { message: string }).message
          : undefined;
      toast.error(detail ? `${t('projectHub.import.failed')}: ${detail}` : t('projectHub.import.failed'));
    }
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

  const handleOpenAuth = () => {
    setActiveProjectId(null);
    setActiveView('auth');
  };

  const handleAuthSuccess = () => {
    setActiveView('home');
  };

  const handleOpenAdmin = () => {
    setActiveProjectId(null);
    setActiveTab('admin');
    setActiveView('admin');
  };

  const settingsSlot = (
    <div className={styles.shellSettings}>
      <span className={styles.storageLabel}>{t('settings.storage')}</span>
      <SettingsSelect />
      <LanguageSwitcher />
      {isAuthRequired() && !user && (
        <button
          type="button"
          className={styles.loginButton}
          data-testid="header-login-button"
          onClick={handleOpenAuth}
        >
          {t('auth.login')}
        </button>
      )}
      {isAuthRequired() && user && <UserMenu onOpenAdmin={handleOpenAdmin} />}
    </div>
  );

  const isHome = activeView === 'home';
  const inProjectWorkspace = activeTab === 'tts-synthesis' && !!activeProjectId;

  // 首次会话恢复中：避免匿名横幅/登录按钮闪烁
  if (isAuthRequired() && authLoading) {
    return <div className={styles.app} data-testid="auth-loading" />;
  }

  if (activeView === 'auth') {
    return (
      <AuthPage
        onSuccess={handleAuthSuccess}
        onBack={() => setActiveView('home')}
      />
    );
  }

  // 匿名用户：allowlist 之外的页面整体隐藏入口（语音克隆上传、语音转写均需登录）
  const hiddenNavIds: GlobalNavId[] = [
    ...(!capabilities.features.speech_to_text || isAnonymous ? ['subtitles' as GlobalNavId] : []),
    ...(isAnonymous ? ['voice-design' as GlobalNavId] : []),
    // 在线部署（workers）：模型凭据由服务端环境变量管理，设置页无可配置项，隐藏入口
    ...(capabilities.deploy_target !== 'local' ? ['settings' as GlobalNavId] : []),
  ];

  return (
    <StorageModeContext.Provider value={{ mode: effectiveStorageMode, setMode: handleSetStorageMode }}>
      <div className={styles.app}>
        {isHome && (
          <>
            {isAnonymous && !anonBannerDismissed && (
              <div className={styles.anonBanner} data-testid="anon-banner">
                <div className={styles.anonBannerText}>
                  <span className={styles.anonBannerTitle}>{t('auth.anonBannerTitle')}</span>
                  <span className={styles.anonBannerDesc}>{t('auth.anonBannerDesc')}</span>
                </div>
                <div className={styles.anonBannerActions}>
                  <button type="button" className={styles.anonBannerLogin} onClick={handleOpenAuth}>
                    {t('auth.login')}
                  </button>
                  <button
                    type="button"
                    className={styles.anonBannerDismiss}
                    onClick={() => setAnonBannerDismissed(true)}
                  >
                    {t('auth.continueAnon')}
                  </button>
                </div>
              </div>
            )}
            <Landing onNavigate={handleNavigate} />
          </>
        )}

        {!isHome && (
          <AppShell
            activeNavId={activeGlobalNav}
            onNavigate={handleGlobalNavigate}
            rightSlot={settingsSlot}
            hideSidebar={inProjectWorkspace}
            hiddenNavIds={hiddenNavIds}
            contactEmail={ADMIN_CONTACT_EMAIL}
          >
            <VoiceRefreshProvider>
              <main className={styles.main}>
                {activeTab === 'tts-synthesis' && !activeProjectId && (
                  <ProjectHub
                    projects={projects}
                    onOpenProject={(projectId) => setActiveProjectId(projectId)}
                    onCreateProject={(name, logo) => { void handleCreateProject(name, logo); }}
                    onDeleteProject={(projectId) => { void handleDeleteProjectFromHub(projectId); }}
                    onRenameProject={(projectId, name) => { void handleRenameProjectFromHub(projectId, name); }}
                    onExportProject={(projectId) => { void handleExportProject(projectId); }}
                    onImportProject={(file) => { void handleImportProject(file); }}
                  />
                )}
                {activeTab === 'tts-synthesis' && activeProjectId && storageModeLoaded && (
                  <TTSSynthesis
                    key={activeProjectId}
                    initialProjectId={activeProjectId}
                    hideProjectSidebar
                    onBackToProjects={() => setActiveProjectId(null)}
                    onNavigateToClone={() => handleTabClick('voice-clone')}
                  />
                )}
                {activeTab === 'admin' && <Admin />}
                <div style={{ display: activeTab === 'voice-clone' ? 'block' : 'none' }}>
                  {isAnonymous ? <LoginRequired onLogin={handleOpenAuth} /> : <VoiceClone />}
                </div>
                <div style={{ display: activeTab === 'speech-to-text' ? 'block' : 'none' }}>
                  {isAnonymous ? <LoginRequired onLogin={handleOpenAuth} /> : <SpeechToText />}
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
  // Supabase Auth 门控（spec 5.2c）：auth 开启时包 AuthProvider —— 恢复会话后
  // 未登录用户可继续匿名使用（allowlist 内的无状态端点）或去登录页；
  // 本地开发不设 VITE_AUTH_REQUIRED，isAuthRequired() 恒 false，行为完全不变。
  if (!isAuthRequired()) {
    return (
      <ThemeProvider>
        <TranslationProvider>
          <ToastProvider>
            <ConfirmProvider>
              <CapabilitiesProvider>
                <AppContent />
              </CapabilitiesProvider>
            </ConfirmProvider>
          </ToastProvider>
        </TranslationProvider>
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider>
      <TranslationProvider>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <CapabilitiesProvider>
                <AppContent />
              </CapabilitiesProvider>
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </TranslationProvider>
    </ThemeProvider>
  );
}
