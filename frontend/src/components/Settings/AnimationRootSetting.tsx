import { useState, useEffect, useCallback } from 'react';
import { configApi } from '../../services/api';
import { useTranslation } from '../../i18n';
import styles from './AnimationRootSetting.module.css';

interface Status {
  type: 'success' | 'error';
  message: string;
}

function extractDetail(err: unknown): string {
  const resp = (err as { response?: { data?: { detail?: unknown } } })?.response;
  const detail = resp?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (typeof detail === 'object' && detail !== null && 'message' in detail) return (detail as { message: string }).message;
  return String(err);
}

export function AnimationRootSetting() {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    let alive = true;
    configApi
      .getAnimationRoot()
      .then((res) => {
        if (alive) setValue(res.value ?? '');
      })
      .catch(() => {
        /* leave empty; user can still input */
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleSave = useCallback(async () => {
    setBusy('save');
    setStatus(null);
    try {
      await configApi.setAnimationRoot(value);
      setStatus({ type: 'success', message: t('settings.animationRoot.saveSuccess') });
    } catch (err) {
      setStatus({ type: 'error', message: extractDetail(err) });
    } finally {
      setBusy(null);
    }
  }, [value, t]);

  const handleTest = useCallback(async () => {
    setBusy('test');
    setStatus(null);
    try {
      const res = await configApi.testAnimationRoot(value);
      if (res.ok) {
        setStatus({ type: 'success', message: t('settings.animationRoot.testOk') });
      } else {
        setStatus({ type: 'error', message: res.error ?? t('settings.animationRoot.testFailed') });
      }
    } catch (err) {
      setStatus({ type: 'error', message: extractDetail(err) });
    } finally {
      setBusy(null);
    }
  }, [value, t]);

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>{t('settings.animationRoot.kicker')}</span>
          <h2 className={styles.title}>{t('settings.animationRoot.title')}</h2>
          <p className={styles.desc}>{t('settings.animationRoot.description')}</p>
        </div>
      </header>
      <div className={styles.body}>
        <label className={styles.field}>
          <span className={styles.label}>{t('settings.animationRoot.label')}</span>
          <input
            aria-label={t('settings.animationRoot.label')}
            className={styles.input}
            value={value}
            placeholder={t('settings.animationRoot.placeholder')}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={handleSave}
            disabled={busy !== null}
          >
            {busy === 'save' ? t('settings.animationRoot.saving') : t('settings.animationRoot.save')}
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={handleTest}
            disabled={busy !== null}
          >
            {busy === 'test' ? t('settings.animationRoot.testing') : t('settings.animationRoot.test')}
          </button>
        </div>
        {status && (
          <p className={status.type === 'success' ? styles.success : styles.error} role="status">
            {status.message}
          </p>
        )}
      </div>
    </section>
  );
}
