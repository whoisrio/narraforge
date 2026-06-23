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

  it('translates redesigned Subtitle Studio and Voice Design workspace copy', () => {
    const zh = createTranslator('zh-CN');
    const en = createTranslator('en-US');

    expect(zh('subtitles.studioKicker')).toBe('Subtitle Studio');
    expect(zh('subtitles.ingest')).toBe('素材导入');
    expect(zh('subtitles.transcriptEditor')).toBe('字幕文本');
    expect(zh('subtitles.reviewExport')).toBe('校准与导出');
    expect(zh('subtitles.boundaryMap')).toBe('Boundary Map');

    expect(en('subtitles.studioKicker')).toBe('Subtitle Studio');
    expect(en('subtitles.ingest')).toBe('Ingest');
    expect(en('subtitles.transcriptEditor')).toBe('Transcript Editor');
    expect(en('subtitles.reviewExport')).toBe('Review & Export');
    expect(en('subtitles.boundaryMap')).toBe('Boundary Map');

    expect(zh('voiceDesign.backendPreview')).toBe('后端试听');
    expect(zh('voiceDesign.saveProfile')).toBe('保存为 Voice Profile');
    expect(en('voiceDesign.backendPreview')).toBe('Backend Preview');
    expect(en('voiceDesign.saveProfile')).toBe('Save as Voice Profile');
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
