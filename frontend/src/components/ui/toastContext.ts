import { createContext } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

export interface ToastApi {
  /** Show a toast. Defaults to `info`. */
  show: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  /** Dismiss a specific toast by id. */
  dismiss: (id: string) => void;
}

const NOOP_TOAST: ToastApi = {
  show: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
  dismiss: () => {},
};

/**
 * Toast feedback channel.
 *
 * The provider is mounted at the app root; consumers access it via
 * `useToast()`. Outside a provider (isolated tests) the hook falls back to a
 * no-op, mirroring the `useTranslation` fallback convention.
 */
export const ToastContext = createContext<ToastApi>(NOOP_TOAST);
