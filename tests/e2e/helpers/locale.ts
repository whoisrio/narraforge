/**
 * Locale helper for E2E tests.
 * Sets the UI language to zh-CN so Chinese selectors work correctly.
 */
import type { Page } from '@playwright/test';

/** Set locale to zh-CN via localStorage before navigating. */
export async function setLocaleToZhCN(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('narraforge-locale', 'zh-CN');
  });
}
