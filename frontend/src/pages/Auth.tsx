import { useState, type FormEvent } from 'react';
import { useTranslation } from '../i18n';
import { useAuth } from '../hooks/authContext';
import { authErrorCode } from '../services/authSession';
import styles from './Auth.module.css';

/** Supabase AuthError code → i18n key（静态映射，避免动态 key 泄漏原始字符串）。 */
const AUTH_ERROR_KEYS: Record<string, string> = {
  weak_password: 'auth.errorWeakPassword',
  user_already_exists: 'auth.errorUserExists',
  email_address_invalid: 'auth.errorEmailInvalid',
  invalid_credentials: 'auth.errorInvalidCredentials',
  over_request_rate_limit: 'auth.errorRateLimited',
};

/**
 * 登录 / 注册页（spec 5.2c · M6）：替代旧的共享口令 UnlockGate。
 * 邮箱+密码走 Supabase Auth；注册后若服务端开启邮箱验证则提示先验证。
 */
export function AuthPage({ onSuccess, onBack }: { onSuccess: () => void; onBack?: () => void }) {
  const { t } = useTranslation();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !email.trim() || !password) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password);
        onSuccess();
      } else {
        const needConfirm = await signUp(email.trim(), password);
        if (needConfirm) {
          setMode('login');
          setNotice(t('auth.signupNeedConfirm'));
        } else {
          onSuccess();
        }
      }
    } catch (err) {
      // 注册时 Supabase 会做密码策略校验（长度/弱密码库），把真实原因亮出来，
      // 不要吞成通用失败——否则用户分不清是"密码不合格"还是"服务挂了"。
      const code = authErrorCode(err);
      const key = code ? AUTH_ERROR_KEYS[code] : undefined;
      setError(key ? t(key) : t('auth.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.gate} data-testid="auth-page">
      <form className={styles.card} onSubmit={(e) => { void handleSubmit(e); }}>
        <h1 className={styles.title}>{mode === 'login' ? t('auth.loginTitle') : t('auth.signupTitle')}</h1>
        <p className={styles.description}>
          {mode === 'login' ? t('auth.loginDescription') : t('auth.signupDescription')}
        </p>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('auth.email')}</span>
          <input
            type="email"
            className={styles.input}
            data-testid="auth-email-input"
            placeholder={t('auth.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t('auth.password')}</span>
          <input
            type="password"
            className={styles.input}
            data-testid="auth-password-input"
            placeholder={t('auth.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p className={styles.error}>{error}</p>}
        {notice && <p className={styles.notice}>{notice}</p>}
        <button type="submit" className={styles.submit} disabled={submitting || !email.trim() || !password}>
          {submitting ? t('auth.submitting') : mode === 'login' ? t('auth.submitLogin') : t('auth.submitSignup')}
        </button>
        <button
          type="button"
          className={styles.switchMode}
          onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setNotice(''); }}
        >
          {mode === 'login' ? t('auth.switchToSignup') : t('auth.switchToLogin')}
        </button>
        {onBack && (
          <button type="button" className={styles.back} onClick={onBack}>
            {t('auth.backHome')}
          </button>
        )}
      </form>
    </div>
  );
}
