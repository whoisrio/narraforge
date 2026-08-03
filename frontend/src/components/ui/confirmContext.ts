import { createContext } from 'react';

export type ConfirmVariant = 'warning' | 'danger';

export interface ConfirmOptions {
  title: string;
  message: string;
  variant?: ConfirmVariant;
  confirmLabel?: string;
  cancelLabel?: string;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

/**
 * Imperative confirmation channel.
 *
 * The provider is mounted at the app root; consumers access it via
 * `useConfirm()`. Outside a provider (isolated tests) the hook falls back to
 * a resolver that returns `false` (cancel), so a missing provider never
 * silently performs a destructive action.
 */
export const ConfirmContext = createContext<ConfirmFn>(async () => false);
