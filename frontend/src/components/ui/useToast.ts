import { useContext } from 'react';
import { ToastContext, type ToastApi } from './toastContext';

/**
 * Access the toast API. Falls back to a no-op when no `ToastProvider` is
 * present (e.g. isolated component tests), mirroring the `useTranslation`
 * fallback convention. In the app the provider is mounted at the root.
 */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}
