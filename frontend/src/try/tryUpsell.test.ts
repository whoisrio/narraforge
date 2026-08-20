import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldShowDownloadUpsell,
  markDownloadUpsellShown,
} from './tryUpsell';
import { stashTryHandoffText, consumeTryHandoffText, peekTryHandoffText } from './tryHandoff';

describe('tryUpsell', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('shows upsell on first download of the session', () => {
    expect(shouldShowDownloadUpsell()).toBe(true);
  });

  it('does not show upsell again after marked shown', () => {
    markDownloadUpsellShown();
    expect(shouldShowDownloadUpsell()).toBe(false);
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
