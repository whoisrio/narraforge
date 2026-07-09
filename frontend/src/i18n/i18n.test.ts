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
    expect(zh('projectNav.voices')).toBe('角色');

    expect(en('nav.projects')).toBe('Projects');
    expect(en('nav.subtitles')).toBe('Subtitles');
    expect(en('nav.voiceDesign')).toBe('Voice Design');
    expect(en('projectNav.library')).toBe('Library');
    expect(en('projectNav.voices')).toBe('Characters');
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

  it('regenerates audio dialog copy with interpolation (regression: raw i18n keys must not leak)', () => {
    const zh = createTranslator('zh-CN');
    const en = createTranslator('en-US');

    // Correct keys used by TTSSynthesis handleRegenerateAll — must interpolate {count}.
    expect(zh('tts.willRegenerateN', { count: 3 })).toBe('将重新生成 3 个片段。');
    expect(zh('tts.nExistingAudioWillBeDeleted', { count: 2 })).toBe('其中 2 个已有音频将被删除后重新生成。');
    expect(zh('tts.nLockedSegmentsUnchanged', { count: 1 })).toBe('已锁定独立音色的 1 个片段将保持不变。');

    expect(en('tts.willRegenerateN', { count: 3 })).toBe('Will regenerate 3 segments.');
    expect(en('tts.nExistingAudioWillBeDeleted', { count: 2 })).toBe('2 existing audio files will be deleted and regenerated.');
    expect(en('tts.nLockedSegmentsUnchanged', { count: 1 })).toBe('1 segments with locked independent voices will remain unchanged.');
  });

  it('never treats the deprecated regenerate keys as real translations', () => {
    // These keys were previously used by mistake (raw key leaked into the UI).
    // Assert they fall back to the key itself so the bug cannot silently return.
    const zh = createTranslator('zh-CN');
    const en = createTranslator('en-US');
    expect(zh('tts.regenerateCount')).toBe('tts.regenerateCount');
    expect(zh('tts.existingAudioWillBeDeleted')).toBe('tts.existingAudioWillBeDeleted');
    expect(zh('tts.lockedSegmentsUnchanged')).toBe('tts.lockedSegmentsUnchanged');
    expect(en('tts.regenerateCount')).toBe('tts.regenerateCount');
    expect(en('tts.existingAudioWillBeDeleted')).toBe('tts.existingAudioWillBeDeleted');
    expect(en('tts.lockedSegmentsUnchanged')).toBe('tts.lockedSegmentsUnchanged');
  });
});
