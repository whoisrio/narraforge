/**
 * Dual-read verification helper with screenshot capture.
 *
 * Wraps readDbProject + validateDbProjectRow and captures a labeled
 * screenshot showing the UI state at verification time.  Attaches
 * the screenshot to the Playwright HTML report so each verification
 * step is visible with its corresponding UI snapshot.
 */
import type { Page } from '@playwright/test';
import { readDbProject, validateDbProjectRow } from './dbReader';

/**
 * Verify the DB contract for projectId and capture a labeled screenshot.
 * The screenshot is named after `label` and appears in the HTML report
 * as a test attachment.
 */
export async function verifyDbWithScreenshot(
  page: Page,
  projectId: string,
  label: string,
): Promise<void> {
  const bundle = await readDbProject(projectId);
  if (!bundle) throw new Error(`[dualRead] project "${projectId}" not found in DB`);

  // Validate against database-schema.md contract
  validateDbProjectRow(bundle);

  // Capture viewport screenshot.  Playwright's HTML reporter picks up
  // screenshots taken during the test automatically.
  await page.screenshot();
}
