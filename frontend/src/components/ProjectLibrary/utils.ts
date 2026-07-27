/**
 * Shared text helpers for the ProjectLibrary family of components.
 * Kept here so the narration-document view and the chapter editor stay DRY.
 */

export function countTextChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

export function estimateDurationSec(text: string): number {
  return countTextChars(text) / 5;
}

export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}
