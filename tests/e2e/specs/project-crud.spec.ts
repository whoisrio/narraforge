/**
 * Project CRUD E2E tests
 *
 * Covers create, rename, and delete flows on the ProjectHub page (/projects).
 * Uses the before → pre-commit → post-commit verification pattern.
 *
 * @feature docs/feature-spec.md §4.1 Project Structure
 * @feature docs/feature-spec.md §4.2 ProjectHub (Default View)
 */
import { expect, test } from '@playwright/test';
import { collectErrors, setLocaleToZhCN, readBackendProjects, validateChapter, enterWorkspace } from '../helpers';
import { readDbProject, readDbProjects, validateDbProjectRow } from '../helpers/dbReader';
import { verifyDbWithScreenshot } from '../helpers/dualReadSnapshot';

test.describe('项目增删改查', () => {
  // @feature §4.1 Project Structure — create new project
  // @feature §4.2 ProjectHub — new project card appears in grid
  test('从工作台创建新项目', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    await page.goto('/');
    await enterWorkspace(page);
    await expect(page.getByText('项目工作台')).toBeVisible({ timeout: 10_000 });

    // ── Step 1: BEFORE action — snapshot backend state ──

    const projectsBefore = await readBackendProjects(page);
    const countBefore = projectsBefore.length;
    const idsBefore = new Set(projectsBefore.map((p) => p.id));

    // ── Step 2: Click new project → fill name → click create ──

    await page.getByRole('button', { name: /新建项目/ }).click();

    // Fill in project name in the dialog
    await expect(page.getByText('新建项目').last()).toBeVisible({ timeout: 5_000 });
    const nameInput = page.getByLabel(/项目名称/);
    await nameInput.fill('E2E-CRUD-测试项目');

    // Click "创建项目"
    await page.getByRole('button', { name: '创建项目' }).click();

    // ── Step 3: POST-COMMIT — project count +1, new project correct ──

    // Verify the new project card appears in the grid
    await expect(page.getByText('E2E-CRUD-测试项目').first()).toBeVisible({ timeout: 10_000 });

    // IndexedDB verification
    await page.waitForTimeout(1_500); // wait for save
    const projectsAfter = await readBackendProjects(page);

    // Dual-read: DB layer
    const dbProjects = await readDbProjects();
    expect(dbProjects.length).toBe(projectsAfter.length);
    expect(dbProjects.some((p) => !idsBefore.has(p.id))).toBe(true);

    // Verify a new project was added
    expect(projectsAfter.length).toBe(countBefore + 1);

    // Find the newly created project
    const newProject = projectsAfter.find((p) => !idsBefore.has(p.id));
    expect(newProject).toBeTruthy();
    expect(newProject!.name).toBe('E2E-CRUD-测试项目');

    // Verify the project has at least one chapter with valid schema
    expect(newProject!.chapters).toBeTruthy();
    expect(newProject!.chapters.length).toBeGreaterThanOrEqual(1);

    // Validate all chapters in the new project
    for (const ch of newProject!.chapters) {
      validateChapter(ch);
    }

    // Dual-read: DB contract validation (full bundle)
    if (newProject!.id) {
      await verifyDbWithScreenshot(page, newProject!.id, 'project-crud-create');
    }

    expect(errors).toEqual([]);
  });

  // @feature §4.1 Project Structure — rename project
  // @feature §4.2 ProjectHub — rename via card menu
  test('重命名项目', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    await page.goto('/');
    await enterWorkspace(page);
    await expect(page.getByText('项目工作台')).toBeVisible({ timeout: 10_000 });

    // Find the test project card and open its menu
    const projectCard = page.locator('[aria-label*="项目 test"]').first();
    await expect(projectCard).toBeVisible({ timeout: 10_000 });

    // Click the menu button (...)
    const menuButton = projectCard.locator('[aria-haspopup="menu"]');
    await menuButton.click();

    // Click rename action
    await page.getByRole('menuitem', { name: '重命名' }).click();

    // Change the name
    const renameInput = page.locator('[id*="project-name"]');
    await renameInput.fill('test-renamed');
    await page.getByRole('button', { name: '保存项目名称' }).click();

    // Verify the name changed
    await expect(page.getByText('test-renamed').first()).toBeVisible({ timeout: 5_000 });

    // ── Data-layer verification: IndexedDB state ──

    await page.waitForTimeout(1_500);
    const projects = await readBackendProjects(page);
    const renamedProject = projects.find((p) => p.name === 'test-renamed');
    expect(renamedProject).toBeTruthy();

    // Dual-read: DB layer
    const dbProjects = await readDbProjects();
    expect(dbProjects.some((p) => p.name === 'test-renamed')).toBe(true);

    // Restore original name
    const renamedCard = page.locator('[aria-label*="项目 test-renamed"]').first();
    await renamedCard.locator('[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: '重命名' }).click();
    await page.locator('[id*="project-name"]').fill('test');
    await page.getByRole('button', { name: '保存项目名称' }).click();
    await expect(page.getByText('test').first()).toBeVisible({ timeout: 5_000 });

    // Verify restoration in IndexedDB
    await page.waitForTimeout(1_500);
    const projectsRestored = await readBackendProjects(page);
    const restoredProject = projectsRestored.find((p) => p.name === 'test');
    expect(restoredProject).toBeTruthy();

    // Dual-read: DB layer
    const dbRestored = await readDbProjects();
    expect(dbRestored.some((p) => p.name === 'test')).toBe(true);

    expect(errors).toEqual([]);
  });

  // @feature §4.1 Project Structure — delete project
  // @feature §4.2 ProjectHub — delete via card menu with confirmation
  test('删除项目（含确认对话框）', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    await page.goto('/');
    await enterWorkspace(page);
    await expect(page.getByText('项目工作台')).toBeVisible({ timeout: 10_000 });

    // First create a temporary project to delete
    await page.getByRole('button', { name: /新建项目/ }).click();
    await expect(page.getByText('新建项目').last()).toBeVisible({ timeout: 5_000 });
    await page.getByLabel(/项目名称/).fill('E2E-待删除项目');
    await page.getByRole('button', { name: '创建项目' }).click();
    // After creation, app navigates to project workspace — wait for it
    await expect(page.getByText('E2E-待删除项目').first()).toBeVisible({ timeout: 10_000 });

    // Navigate back to ProjectHub
    await page.getByRole('button', { name: /返回项目总览/ }).click();
    await expect(page.getByText('项目工作台')).toBeVisible({ timeout: 10_000 });

    // ── Step 1: BEFORE action — snapshot backend state ──

    await page.waitForTimeout(1_500);
    const projectsBefore = await readBackendProjects(page);
    const countBefore = projectsBefore.length;
    const targetProject = projectsBefore.find((p) => p.name === 'E2E-待删除项目');
    expect(targetProject).toBeTruthy();
    const targetId = targetProject!.id;

    // Set up dialog handler BEFORE triggering the delete action
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('确定删除项目');
      await dialog.accept();
    });

    // Open the menu for the new project and click delete
    const projectCard = page.locator('article[aria-label*="项目 E2E-待删除项目"]').first();
    await expect(projectCard).toBeVisible({ timeout: 5_000 });
    await projectCard.locator('[aria-haspopup="menu"]').click();
    await page.waitForTimeout(500); // wait for menu animation

    // Click the delete menu item
    await page.getByRole('menuitem', { name: /删除/ }).click();

    // ── Step 2: POST-COMMIT — project no longer exists, count -1 ──

    // Wait for the hub list to refresh
    await page.waitForTimeout(2_000);

    // Backend verification
    await page.waitForTimeout(1_500);
    const projectsAfter = await readBackendProjects(page);

    // Verify the project no longer exists in backend
    const deletedProject = projectsAfter.find((p) => p.id === targetId);
    expect(deletedProject).toBeUndefined();

    // Dual-read: DB layer — project row must be gone
    const dbProjects = await readDbProjects();
    expect(dbProjects.find((p) => p.id === targetId)).toBeUndefined();

    // Verify project count decreased
    expect(projectsAfter.length).toBe(countBefore - 1);

    // Verify the total count decreased
    expect(projectsAfter.length).toBe(countBefore - 1);

    expect(errors).toEqual([]);
  });
});
