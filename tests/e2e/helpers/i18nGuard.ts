/**
 * Generic guard that fails the test if any raw (untranslated) i18n key leaks
 * into the visible UI text.
 *
 * Why this exists: the app uses a key-based translator where a missing key
 * falls back to returning the key string itself. A typo'd key therefore
 * silently renders as e.g. "tts.regenerateCount" instead of the intended
 * copy. This guard catches that class of bug app-wide, not just one dialog.
 */

import type { Page } from '@playwright/test';

// Top-level namespaces declared in src/i18n/{zh-CN,en-US}.ts. A leaked key is
// always prefixed by one of these, which keeps the matcher precise and avoids
// false positives on ordinary punctuation such as "e.g." or version strings.
const KNOWN_NAMESPACES = [
  'appShell', 'audioDropzone', 'audioPlayer', 'audioPreview', 'audioRecorder',
  'audioUploader', 'bilingualCard', 'common', 'confirmDialog', 'correctionPanel',
  'export', 'exportPanel', 'generateNarration', 'imageUpload', 'landing',
  'mimoTts', 'modelConfig', 'modelSelector', 'multiAudioSelector',
  'narrationBlock', 'narrationFullView', 'nav', 'parameterControls', 'project',
  'projectHub', 'projectLibrary', 'projectNav', 'projectOverview',
  'projectSettings', 'projectShell', 'projectVoices', 'qualityReport',
  'roleSync', 'scriptAnalysis', 'segment', 'segmentEdit', 'segmentList',
  'segmentedProject', 'settings', 'sourceLibrary', 'sourceUploadZone', 'ssml',
  'studio', 'stylePresets', 'subtitles', 'textInput', 'transcription',
  'transcriptionConfig', 'transcriptionHistory', 'tts', 'ttsControls',
  'urlInput', 'voiceClone', 'voiceDesign', 'voiceDesignPreview', 'voiceList',
  'voiceRole', 'voiceRoleDefaults', 'voiceRolePreview', 'voiceSelector', 'voxcpm',
];

// Matches a full token shaped like `namespace.Segment` or `namespace.A.B.C`.
const RAW_KEY_RE = new RegExp(
  `^(?:${KNOWN_NAMESPACES.join('|')})(?:\\.[a-zA-Z][a-zA-Z0-9]*)+$`,
);

// Strip surrounding punctuation/brackets so "「tts.foo」" is still detected.
const TRIM_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/u;

/** Returns the list of raw i18n keys found in the page's visible text. */
export async function findRawI18nKeys(page: Page): Promise<string[]> {
  const bodyText = await page.locator('body').innerText();
  const tokens = bodyText.split(/\s+/);
  const found = new Set<string>();
  for (const raw of tokens) {
    const token = raw.replace(TRIM_RE, '');
    if (RAW_KEY_RE.test(token)) found.add(token);
  }
  return [...found];
}

/**
 * Asserts that no raw i18n key is visible on the page.
 * @throws if any leaked key is detected.
 */
export async function expectNoRawI18nKey(page: Page): Promise<void> {
  const leaked = await findRawI18nKeys(page);
  if (leaked.length > 0) {
    throw new Error(
      `Raw i18n keys leaked into UI: ${leaked.join(', ')}`,
    );
  }
}
