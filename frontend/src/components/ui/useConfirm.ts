import { useContext } from 'react';
import { ConfirmContext, type ConfirmFn } from './confirmContext';

/**
 * Access the imperative confirm API. Falls back to a resolver that returns
 * `false` (cancel) when no `ConfirmProvider` is present (e.g. isolated tests),
 * so a missing provider never silently performs a destructive action.
 */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}
