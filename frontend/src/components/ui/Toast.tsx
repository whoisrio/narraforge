import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { ToastContext, type ToastApi, type ToastItem, type ToastType } from './toastContext';
import styles from './Toast.module.css';

const DEFAULT_DURATION_MS: Record<ToastType, number> = {
  success: 3000,
  info: 3000,
  error: 5000,
};

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `toast-${_idCounter}-${Date.now()}`;
}

/**
 * Toast feedback channel.
 *
 * Replaces the scattered native `alert()` calls and the two hand-rolled
 * `setTimeout`-based toasts. Fixes the audit bugs (U2): each toast owns its
 * own timer id (rapid triggers no longer clear each other), and all pending
 * timers are cleared on unmount (no setState-after-unmount). Success/info use
 * `role="status" aria-live="polite"`; errors use `role="alert"` so screen
 * readers announce them assertively.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ToastItem[]>([]);
  // timerId -> toast id, so dismiss/unmount can clear the right timer.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const handle = timers.current.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    clearTimer(id);
    setItems(prev => prev.filter(t => t.id !== id));
  }, [clearTimer]);

  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId();
    setItems(prev => [...prev, { id, message, type }]);
    const duration = DEFAULT_DURATION_MS[type];
    const handle = setTimeout(() => {
      timers.current.delete(id);
      setItems(prev => prev.filter(t => t.id !== id));
    }, duration);
    timers.current.set(id, handle);
  }, []);

  const success = useCallback((m: string) => show(m, 'success'), [show]);
  const error = useCallback((m: string) => show(m, 'error'), [show]);
  const info = useCallback((m: string) => show(m, 'info'), [show]);

  // Clear all pending timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const handle of map.values()) clearTimeout(handle);
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, success, error, info, dismiss }), [show, success, error, info, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} aria-label="Notifications">
        {items.map(item => (
          <div
            key={item.id}
            className={`${styles.toast} ${styles[item.type]}`}
            role={item.type === 'error' ? 'alert' : 'status'}
            aria-live={item.type === 'error' ? 'assertive' : 'polite'}
          >
            <span className={styles.message}>{item.message}</span>
            <button
              type="button"
              className={styles.closeBtn}
              aria-label={t('common.dismissNotification')}
              onClick={() => dismiss(item.id)}
            >×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
