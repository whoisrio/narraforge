import { useCallback, useState, type ReactNode } from 'react';
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from './confirmContext';
import { ConfirmDialog } from './ConfirmDialog';

interface PendingConfirm {
  id: string;
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

let _idCounter = 0;

/**
 * Imperative confirmation backed by the accessible `ConfirmDialog`.
 *
 * Replaces native `window.confirm()` so the call site reads naturally
 * (`if (!(await confirm({...}))) return;`) while the UI stays a real
 * `role="alertdialog"` with Esc/overlay cancel - not a browser dialog that
 * Playwright must intercept via `page.on('dialog')`.
 *
 * Confirms are queued: a second `confirm()` while one is open waits until the
 * first resolves, then shows. This avoids overlapping dialogs.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PendingConfirm[]>([]);

  const resolveCurrent = useCallback((ok: boolean) => {
    setQueue(prev => {
      const [head, ...rest] = prev;
      head?.resolve(ok);
      return rest;
    });
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>(resolve => {
      setQueue(prev => [...prev, { id: `confirm-${++_idCounter}`, options, resolve }]);
    });
  }, []);

  const current = queue[0];

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {current && (
        <ConfirmDialog
          open
          title={current.options.title}
          message={current.options.message}
          variant={current.options.variant}
          confirmLabel={current.options.confirmLabel}
          cancelLabel={current.options.cancelLabel}
          onConfirm={() => resolveCurrent(true)}
          onCancel={() => resolveCurrent(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}
