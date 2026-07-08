/**
 * Console error collection helper for E2E tests.
 */
import type { Page } from '@playwright/test';

/** Known React warnings that should not be treated as test failures. */
const IGNORED_WARNINGS = [
  'An empty string ("") was passed to the',
];

/** Attach a console error listener and return the collected errors array. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Filter out known React warnings that are promoted to errors in dev mode
      if (IGNORED_WARNINGS.some(w => text.includes(w))) return;
      errors.push(text);
    }
  });
  return errors;
}
