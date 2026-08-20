/** Try 页文本限制（详见 docs/superpowers/specs/2026-08-20-try-page-seo-acquisition-design.md） */
export const TRY_TEXT_MAX_CHARS = 3000;

export type TryTextValidation =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'too_long' };

export function validateTryText(text: string): TryTextValidation {
  if (!text.trim()) return { ok: false, reason: 'empty' };
  if (text.length > TRY_TEXT_MAX_CHARS) return { ok: false, reason: 'too_long' };
  return { ok: true };
}
