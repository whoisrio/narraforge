import { describe, it, expect } from 'vitest';
import { TRY_TEXT_MAX_CHARS, validateTryText } from './tryLimits';

describe('validateTryText', () => {
  it('rejects empty text', () => {
    expect(validateTryText('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateTryText('   \n ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects text over the limit', () => {
    const tooLong = 'a'.repeat(TRY_TEXT_MAX_CHARS + 1);
    expect(validateTryText(tooLong)).toEqual({ ok: false, reason: 'too_long' });
  });

  it('accepts text at exactly the limit', () => {
    const atLimit = 'a'.repeat(TRY_TEXT_MAX_CHARS);
    expect(validateTryText(atLimit)).toEqual({ ok: true });
  });

  it('accepts normal text', () => {
    expect(validateTryText('Hello world')).toEqual({ ok: true });
  });
});
