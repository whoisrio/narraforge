import { useState, type FormEvent } from 'react';
import axios from 'axios';
import { apiUrl } from '../../services/apiBase';
import { clearToken, setToken } from '../../services/auth';
import { useTranslation } from '../../i18n';
import styles from './UnlockGate.module.css';

/**
 * 全屏解锁页（无域名部署的共享口令认证，spec 5.2b）。
 *
 * 提交时先带口令直接请求 capabilities 端点验证（裸 axios，不走共享实例的
 * 401 拦截器，避免验证失败触发整页刷新）；验证通过才写入 localStorage 并
 * 回调 onUnlocked（App 整页刷新，Capabilities 等启动探测随之带口令重试）。
 */
export function UnlockGate({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useTranslation();
  const [token, setTokenInput] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const value = token.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await axios.get(apiUrl('/config/capabilities'), {
        headers: { Authorization: `Bearer ${value}` },
      });
      setToken(value);
      onUnlocked();
    } catch (err) {
      clearToken();
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 401 ? t('auth.wrongToken') : t('auth.verifyFailed'));
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.gate} data-testid="unlock-gate">
      <form className={styles.card} onSubmit={(e) => { void handleSubmit(e); }}>
        <h1 className={styles.title}>{t('auth.title')}</h1>
        <p className={styles.description}>{t('auth.description')}</p>
        <input
          type="password"
          className={styles.input}
          data-testid="unlock-token-input"
          placeholder={t('auth.placeholder')}
          value={token}
          onChange={(e) => setTokenInput(e.target.value)}
          autoFocus
        />
        {error && <p className={styles.error}>{error}</p>}
        <button type="submit" className={styles.submit} disabled={submitting || !token.trim()}>
          {submitting ? t('auth.verifying') : t('auth.submit')}
        </button>
      </form>
    </div>
  );
}
