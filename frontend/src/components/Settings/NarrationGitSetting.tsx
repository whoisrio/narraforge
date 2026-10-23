import { useState, useEffect, useCallback, useRef } from 'react';
import { configApi } from '../../services/api';
import { useTranslation } from '../../i18n';
import styles from './AnimationRootSetting.module.css';

interface SnapshotResult {
  commit_sha: string | null;
  projects: number;
  pushed: boolean;
  push_error: string | null;
  remote_configured: boolean;
}

interface Status {
  type: 'success' | 'error';
  message: string;
}

export function NarrationGitSetting() {
  const [remote, setRemote] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(null);
  const [busy, setBusy] = useState<'save' | 'snapshot' | null>(null);
  const editedRef = useRef(false);
  const { t } = useTranslation();

  useEffect(() => {
    let alive = true;
    configApi
      .getNarrationGitRemote()
      .then((res) => {
        // A late initial GET must never overwrite what the user is editing
        // (or has already saved) on this screen.
        if (alive && !editedRef.current) setRemote(res.value ?? '');
      })
      .catch(() => { /* leave empty */ });
    return () => { alive = false; };
  }, []);

  const handleSave = useCallback(async () => {
    setBusy('save');
    setStatus(null);
    try {
      const result = await configApi.setNarrationGitRemote(remote.trim());
      setRemote(result.value ?? '');
      setStatus({ type: 'success', message: t('settings.narrationGit.saveSuccess') });
    } catch {
      setStatus({ type: 'error', message: t('settings.narrationGit.saveFailed') });
    } finally {
      setBusy(null);
    }
  }, [remote, t]);

  const handleSnapshot = useCallback(async () => {
    setBusy('snapshot');
    setStatus(null);
    setSnapshot(null);
    try {
      const target = remote.trim();
      const result = await configApi.snapshotNarrationGit(target);
      setRemote(target);
      setSnapshot(result);
      if (result.push_error) {
        setStatus({ type: 'error', message: result.push_error });
      } else if (result.pushed) {
        setStatus({ type: 'success', message: t('settings.narrationGit.pushed') });
      } else if (result.remote_configured) {
        setStatus({ type: 'error', message: t('settings.narrationGit.notPushed') });
      } else {
        setStatus({ type: 'success', message: t('settings.narrationGit.committedLocal') });
      }
    } catch {
      setStatus({ type: 'error', message: t('settings.narrationGit.snapshotFailed') });
    } finally {
      setBusy(null);
    }
  }, [remote, t]);

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>{t('settings.narrationGit.kicker')}</span>
          <h2 className={styles.title}>{t('settings.narrationGit.title')}</h2>
          <p className={styles.desc}>{t('settings.narrationGit.description')}</p>
        </div>
      </header>
      <div className={styles.body}>
        <label className={styles.field}>
          <span className={styles.label}>{t('settings.narrationGit.label')}</span>
          <input
            aria-label={t('settings.narrationGit.label')}
            className={styles.input}
            value={remote}
            placeholder={t('settings.narrationGit.placeholder')}
            onChange={(e) => {
              editedRef.current = true;
              setRemote(e.target.value);
            }}
          />
        </label>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={handleSave} disabled={busy !== null}>
            {busy === 'save' ? t('settings.narrationGit.saving') : t('common.save')}
          </button>
          <button type="button" className={styles.primary} onClick={handleSnapshot} disabled={busy !== null}>
            {busy === 'snapshot' ? t('settings.narrationGit.snapshotting') : t('settings.narrationGit.snapshot')}
          </button>
        </div>
        {snapshot?.commit_sha && (
          <p className={styles.success} role="status">
            {t('settings.narrationGit.sha')}: {snapshot.commit_sha.slice(0, 8)} · {snapshot.projects} {t('settings.narrationGit.projects')}
          </p>
        )}
        {status && (
          <p className={status.type === 'success' ? styles.success : styles.error} role="status">
            {status.message}
          </p>
        )}
      </div>
    </section>
  );
}
