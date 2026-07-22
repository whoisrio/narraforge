export interface InsertResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * 在 [start, end) 选区处插入 tag（纯函数，便于单测）：
 * - 无选区：tag 插入光标处，光标落到 tag 之后；
 * - 有选区：tag 包裹到选区前（tag 紧贴选区文本），新选区覆盖 tag+原文本。
 */
export function insertTagAtSelection(
  text: string,
  start: number,
  end: number,
  tag: string,
): InsertResult {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  if (start === end) {
    const next = before + tag + after;
    const caret = start + tag.length;
    return { text: next, selectionStart: caret, selectionEnd: caret };
  }
  const next = before + tag + selected + after;
  return { text: next, selectionStart: start, selectionEnd: start + tag.length + selected.length };
}
