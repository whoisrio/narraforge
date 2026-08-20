/**
 * Try 页 → 主 SPA 的内容接力。
 * 点击「试用完整功能」时把当前文档文本暂存到 sessionStorage，
 * 主应用（scratchpad）挂载时消费一次并预填，保证用户进度不丢。
 */
const HANDOFF_KEY = 'try_handoff_text';

export function stashTryHandoffText(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  sessionStorage.setItem(HANDOFF_KEY, text);
}

export function consumeTryHandoffText(): string | null {
  const text = sessionStorage.getItem(HANDOFF_KEY);
  if (text === null) return null;
  sessionStorage.removeItem(HANDOFF_KEY);
  return text;
}

/** 只读不消费：主应用先 peek，确认能应用（目标章节为空）后才 consume。 */
export function peekTryHandoffText(): string | null {
  return sessionStorage.getItem(HANDOFF_KEY);
}
