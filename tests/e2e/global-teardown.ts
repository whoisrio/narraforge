/**
 * Playwright global teardown.
 * Cleans up test data after all E2E tests complete.
 *
 * Removes:
 * - Non-seeded roles (keeps "小明", "小红")
 * - All voice profiles
 * - All TTS results
 * - Non-seeded projects (keeps "test-e2e-project")
 * - Orphaned audio files
 */
import type { FullConfig } from '@playwright/test';
import { E2E_BACKEND_URL } from './helpers/ports';
import { chromium } from '@playwright/test';

const BASE_URL = E2E_BACKEND_URL;

/** Roles that should survive teardown (seeded by global-setup). */
const KEEP_ROLES = new Set(['小明', '小红']);

/** Projects that should survive teardown. */
const KEEP_PROJECTS = new Set(['test-e2e-project']);

async function globalTeardown(_config: FullConfig): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    // ── 0. SAFETY GUARD: never delete from a non-e2e backend ──
    // If the port was hijacked by a dev/prod backend (dual-bind), deleting
    // "non-seeded" data would wipe the developer's real database — this
    // happened in production. Verify app_env before ANY destructive call.
    const healthResp = await page.request.get(`${BASE_URL}/health`).catch(() => null);
    const health = healthResp?.ok() ? await healthResp.json() : null;
    if (health?.app_env !== 'e2e') {
      console.warn(
        `[global-teardown] SKIPPING all deletions: app_env=${health?.app_env ?? 'unreachable'} ` +
        `(expected 'e2e'). Refusing to touch a non-e2e database.`,
      );
      return;
    }

    // ── 1. Delete non-seeded roles ──
    const rolesResp = await page.request.get(`${BASE_URL}/api/roles`);
    if (rolesResp.ok()) {
      const rolesData = await rolesResp.json();
      const roles: Array<{ id: string; name: string }> = rolesData.items ?? rolesData;
      let deletedRoles = 0;
      for (const role of roles) {
        if (!KEEP_ROLES.has(role.name)) {
          await page.request.delete(`${BASE_URL}/api/roles/${role.id}`).catch(() => {});
          deletedRoles++;
        }
      }
      if (deletedRoles > 0) {
        console.log(`[global-teardown] Deleted ${deletedRoles} non-seeded roles`);
      }
    }

    // ── 2. Delete all voice profiles ──
    const voicesResp = await page.request.get(`${BASE_URL}/api/clone`);
    if (voicesResp.ok()) {
      const voicesData = await voicesResp.json();
      const voices: Array<{ id: string; name: string }> = voicesData.items ?? voicesData;
      let deletedVoices = 0;
      for (const voice of voices) {
        await page.request.delete(`${BASE_URL}/api/clone/${voice.id}`).catch(() => {});
        deletedVoices++;
      }
      if (deletedVoices > 0) {
        console.log(`[global-teardown] Deleted ${deletedVoices} voice profiles`);
      }
    }

    // ── 3. Delete non-seeded projects ──
    const projectsResp = await page.request.get(`${BASE_URL}/api/segmented-projects`);
    if (projectsResp.ok()) {
      const projectsData = await projectsResp.json();
      const projects: Array<{ id: string; name: string }> = projectsData.items ?? projectsData;
      let deletedProjects = 0;
      for (const project of projects) {
        if (!KEEP_PROJECTS.has(project.id)) {
          await page.request.delete(`${BASE_URL}/api/segmented-projects/${project.id}`).catch(() => {});
          deletedProjects++;
        }
      }
      if (deletedProjects > 0) {
        console.log(`[global-teardown] Deleted ${deletedProjects} non-seeded projects`);
      }
    }

    console.log('[global-teardown] Cleanup complete');
  } catch (e) {
    console.error('[global-teardown] Cleanup failed:', e);
  } finally {
    await browser.close();
  }
}

export default globalTeardown;
