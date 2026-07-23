import { describe, expect, it } from 'vitest';
import { insertTagAtSelection } from './styleTagInsert';

describe('insertTagAtSelection', () => {
  it('inserts at the cursor when there is no selection', () => {
    const r = insertTagAtSelection('你好世界', 2, 2, '[laughing]');
    expect(r.text).toBe('你好[laughing]世界');
    expect(r.selectionStart).toBe(2 + '[laughing]'.length);
    expect(r.selectionEnd).toBe(r.selectionStart);
  });

  it('inserts at the start of empty text', () => {
    const r = insertTagAtSelection('', 0, 0, '[sigh]');
    expect(r.text).toBe('[sigh]');
    expect(r.selectionStart).toBe('[sigh]'.length);
  });

  it('wraps a selection with the tag prepended', () => {
    // 选区 [2,5) = 「的太好」
    const r = insertTagAtSelection('他真的太好了', 2, 5, '[Surprise-wa]');
    expect(r.text).toBe('他真[Surprise-wa]的太好了');
    expect(r.selectionStart).toBe(2);
    expect(r.selectionEnd).toBe(2 + '[Surprise-wa]'.length + 3);
  });

  it('wraps a full-text selection', () => {
    const r = insertTagAtSelection('全部', 0, 2, '[Uhm]');
    expect(r.text).toBe('[Uhm]全部');
    expect(r.selectionStart).toBe(0);
    expect(r.selectionEnd).toBe('[Uhm]'.length + 2);
  });
});
