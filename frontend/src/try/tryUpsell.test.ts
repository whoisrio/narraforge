import { describe, it, expect, beforeEach } from 'vitest';
import {
  DOWNLOAD_UPSELL_INTERVAL,
  recordDownloadAndCheckUpsell,
  resetDownloadUpsellCounter,
} from './tryUpsell';
import { stashTryHandoffText, consumeTryHandoffText, peekTryHandoffText } from './tryHandoff';

describe('tryUpsell', () => {
  beforeEach(() => {
    resetDownloadUpsellCounter();
  });

  it('upsell interval is 5 downloads', () => {
    expect(DOWNLOAD_UPSELL_INTERVAL).toBe(5);
  });

  it('does not show upsell for the first four downloads', () => {
    expect(recordDownloadAndCheckUpsell()).toBe(false);
    expect(recordDownloadAndCheckUpsell()).toBe(false);
    expect(recordDownloadAndCheckUpsell()).toBe(false);
    expect(recordDownloadAndCheckUpsell()).toBe(false);
  });

  it('shows upsell on every 5th download', () => {
    for (let i = 0; i < 4; i++) recordDownloadAndCheckUpsell();
    expect(recordDownloadAndCheckUpsell()).toBe(true);

    for (let i = 0; i < 4; i++) recordDownloadAndCheckUpsell();
    expect(recordDownloadAndCheckUpsell()).toBe(true);
  });

  it('counter resets to zero (page refresh semantics)', () => {
    for (let i = 0; i < 4; i++) recordDownloadAndCheckUpsell();
    resetDownloadUpsellCounter();
    expect(recordDownloadAndCheckUpsell()).toBe(false);
  });
});

describe('tryHandoff', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('consume returns stashed text', () => {
    stashTryHandoffText('some document');
    expect(consumeTryHandoffText()).toBe('some document');
  });

  it('consume clears the stash (one-shot)', () => {
    stashTryHandoffText('some document');
    consumeTryHandoffText();
    expect(consumeTryHandoffText()).toBeNull();
  });

  it('consume returns null when nothing stashed', () => {
    expect(consumeTryHandoffText()).toBeNull();
  });

  it('peek reads without consuming', () => {
    stashTryHandoffText('doc');
    expect(peekTryHandoffText()).toBe('doc');
    expect(peekTryHandoffText()).toBe('doc');
    expect(consumeTryHandoffText()).toBe('doc');
    expect(peekTryHandoffText()).toBeNull();
  });

  it('stash ignores empty text', () => {
    stashTryHandoffText('   ');
    expect(consumeTryHandoffText()).toBeNull();
  });
});
