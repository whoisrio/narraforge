import { useCallback, useRef, useState, type ReactNode } from 'react';
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
 *
 * The queue lives in a ref (mutated outside React's state updater) and a
 * dummy state bumps the render to show/hide the dialog. This keeps the
 * updater pure - resolving the promise is a side effect and must not happen
 * inside `setState` (StrictMode double-invokes updaters).
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const queueRef = useRef<PendingConfirm[]>([]);
  const [, bump] = useState(0);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>(resolve => {
      queueRef.current.push({ id: `confirm-${++_idCounter}`, options, resolve });
      bump(n => n + 1);
    });
  }, []);

  const resolveCurrent = useCallback((ok: boolean) => {
    const [head, ...rest] = queueRef.current;
    queueRef.current = rest;
    head?.resolve(ok);
    bump(n => n + 1);
  }, []);

  const current = queueRef.current[0];

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
