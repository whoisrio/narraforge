import { enUS } from './en-US';
import { zhCN } from './zh-CN';
import type { Messages } from './zh-CN';

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
  return (key: TranslationKey): string => readPath(dictionary, key) ?? key;
}

export const t = createTranslator('zh-CN');
