import { describe, expect, it } from 'vitest';
import { createTranslator, isSupportedLocale, locales, navItems } from './index';

describe('i18n', () => {
  it('translates global and project navigation in Chinese and English', () => {
    expect(locales).toEqual(['zh-CN', 'en-US']);

    const zh = createTranslator('zh-CN');
    const en = createTranslator('en-US');

    expect(zh('nav.projects')).toBe('项目');
    expect(zh('nav.subtitles')).toBe('字幕识别');
    expect(zh('nav.voiceDesign')).toBe('音色设计');
    expect(zh('projectNav.library')).toBe('文本库');
    expect(zh('projectNav.voices')).toBe('声音角色');

    expect(en('nav.projects')).toBe('Projects');
    expect(en('nav.subtitles')).toBe('Subtitles');
    expect(en('nav.voiceDesign')).toBe('Voice Design');
    expect(en('projectNav.library')).toBe('Library');
    expect(en('projectNav.voices')).toBe('Voices');
  });

  it('falls back to the key for missing translations without crashing', () => {
    const t = createTranslator('zh-CN');
    expect(t('missing.key')).toBe('missing.key');
  });

  it('exposes stable route metadata for global nav', () => {
    expect(navItems.map(item => item.path)).toEqual(['/projects', '/subtitles', '/voice-design', '/settings']);
    expect(navItems.map(item => item.labelKey)).toEqual([
      'nav.projects',
      'nav.subtitles',
      'nav.voiceDesign',
      'nav.settings',
    ]);
  });

  it('detects supported locales', () => {
    expect(isSupportedLocale('zh-CN')).toBe(true);
    expect(isSupportedLocale('en-US')).toBe(true);
    expect(isSupportedLocale('fr-FR')).toBe(false);
  });
});
