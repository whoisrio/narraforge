/* eslint-disable react-refresh/only-export-components */
import { enUS } from './en-US';
import { zhCN } from './zh-CN';
import type { Messages } from './zh-CN';
import { createContext, useContext, useState, useMemo, useCallback } from 'react';

export type Locale = 'zh-CN' | 'en-US';
export type TranslationKey = string;

export const locales: Locale[] = ['zh-CN', 'en-US'];

export const messages: Record<Locale, Messages> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export interface NavItem {
  id: string;
  labelKey: TranslationKey;
  path: string;
}

export const navItems: NavItem[] = [
  { id: 'projects', labelKey: 'nav.projects', path: '/projects' },
  { id: 'subtitles', labelKey: 'nav.subtitles', path: '/subtitles' },
  { id: 'voice-design', labelKey: 'nav.voiceDesign', path: '/voice-design' },
  { id: 'settings', labelKey: 'nav.settings', path: '/settings' },
];

export const projectNavItems: NavItem[] = [
  { id: 'overview', labelKey: 'projectNav.overview', path: 'overview' },
  { id: 'library', labelKey: 'projectNav.library', path: 'library' },
  { id: 'studio', labelKey: 'projectNav.studio', path: 'studio' },
  { id: 'voices', labelKey: 'projectNav.voices', path: 'voices' },
  { id: 'workflow', labelKey: 'projectNav.workflow', path: 'workflow' },
  { id: 'settings', labelKey: 'projectNav.settings', path: 'settings' },
];

export function isSupportedLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

function readPath(source: unknown, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((node, part) => {
    if (!node || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[part];
  }, source);
  return typeof value === 'string' ? value : undefined;
}

export function createTranslator(locale: Locale = 'zh-CN') {
  const dictionary = messages[locale] ?? messages['zh-CN'];
  
  return (key: TranslationKey, variables?: Record<string, string | number>): string => {
    let message = readPath(dictionary, key) ?? key;
    
    // Replace variables if provided
    if (variables) {
      for (const [varName, varValue] of Object.entries(variables)) {
        message = message.replace(`{${varName}}`, String(varValue));
      }
    }
    
    return message;
  };
}

// Default translator for direct imports (prefer useTranslation() in React components)
export const t = createTranslator('en-US');

// Translation Context — shared locale state across all components
interface TranslationContextValue {
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
  locale: Locale;
  setLocale: (newLocale: Locale) => void;
}

const TranslationContext = createContext<TranslationContextValue | null>(null);

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'en-US';
    const saved = localStorage.getItem('narraforge-locale');
    if (saved && isSupportedLocale(saved)) return saved;
    return 'en-US';
  });

  const t = useMemo(() => createTranslator(locale), [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    localStorage.setItem('narraforge-locale', newLocale);
    setLocaleState(newLocale);
  }, []);

  const value = useMemo<TranslationContextValue>(
    () => ({ t, locale, setLocale }),
    [t, locale, setLocale],
  );

  return (
    <TranslationContext.Provider value={value}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    // Fallback: if not wrapped in provider, use module-level translator
    return { t: createTranslator('en-US'), locale: 'en-US' as Locale, setLocale: () => {} };
  }
  return ctx;
}
