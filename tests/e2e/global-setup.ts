/**
 * Playwright global setup.
 * Seeds test data after the backend server is ready.
 */
import type { FullConfig } from '@playwright/test';
import { chromium } from '@playwright/test';

async function globalSetup(_config: FullConfig): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // Wait for backend to be ready
    const maxWait = 30_000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const resp = await page.request.get('http://127.0.0.1:8002/health');
        if (resp.ok()) break;
      } catch {
        // Backend not ready yet
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // Set storage mode to backend so the frontend reads projects from SQLite (not IndexedDB)
    const modeResp = await page.request.put('http://127.0.0.1:8002/api/config/storage-mode', {
      data: { storage_mode: 'backend' },
    });
    if (modeResp.ok()) {
      console.log('[global-setup] Storage mode set to backend');
    } else {
      console.warn('[global-setup] Failed to set storage mode:', modeResp.status());
    }

    // Seed test data
    const { seedTestProject } = await import('./helpers/seed');
    await seedTestProject(page);
    console.log('[global-setup] Test project seeded successfully');
  } catch (e) {
    console.error('[global-setup] Failed to seed test data:', e);
  } finally {
    await browser.close();
  }
}

export default globalSetup;
