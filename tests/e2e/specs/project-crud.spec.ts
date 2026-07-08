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
import { collectErrors, setLocaleToZhCN, readIndexedDBProjects, validateChapter, enterWorkspace } from '../helpers';

test.describe('Project CRUD', () => {
  // @feature §4.1 Project Structure — create new project
  // @feature §4.2 ProjectHub — new project card appears in grid
  test('creates a new project from the hub', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocaleToZhCN(page);

    await page.goto('/');
    await enterWorkspace(page);
    await expect(page.getByText('项目工作台')).toBeVisible({ timeout: 10_000 });

    // ── Step 1: BEFORE action — snapshot backend state ──

    const projectsBefore = await readIndexedDBProjects(page);
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
    const projectsAfter = await readIndexedDBProjects(page);

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

    expect(errors).toEqual([]);
  });

  // @feature §4.1 Project Structure — rename project
  // @feature §4.2 ProjectHub — rename via card menu
  test('renames a project', async ({ page }) => {
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
    const projects = await readIndexedDBProjects(page);
    const renamedProject = projects.find((p) => p.name === 'test-renamed');
    expect(renamedProject).toBeTruthy();

    // Restore original name
    const renamedCard = page.locator('[aria-label*="项目 test-renamed"]').first();
    await renamedCard.locator('[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: '重命名' }).click();
    await page.locator('[id*="project-name"]').fill('test');
    await page.getByRole('button', { name: '保存项目名称' }).click();
    await expect(page.getByText('test').first()).toBeVisible({ timeout: 5_000 });

    // Verify restoration in IndexedDB
    await page.waitForTimeout(1_500);
    const projectsRestored = await readIndexedDBProjects(page);
    const restoredProject = projectsRestored.find((p) => p.name === 'test');
    expect(restoredProject).toBeTruthy();

    expect(errors).toEqual([]);
  });

  // @feature §4.1 Project Structure — delete project
  // @feature §4.2 ProjectHub — delete via card menu with confirmation
  test('deletes a project with confirmation', async ({ page }) => {
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
    const projectsBefore = await readIndexedDBProjects(page);
    const countBefore = projectsBefore.length;
    const targetProject = projectsBefore.find((p) => p.name === 'E2E-待删除项目');
    expect(targetProject).toBeTruthy();
    const targetId = targetProject!.id;

    // Set up dialog handler BEFORE triggering the delete action
    const dialogPromise = page.waitForEvent('dialog', { timeout: 10_000 });

    // Open the menu for the new project and click delete
    const projectCard = page.locator('[aria-label*="E2E-待删除项目"]').first();
    await expect(projectCard).toBeVisible({ timeout: 5_000 });
    await projectCard.locator('[aria-haspopup="menu"]').click();
    await page.waitForTimeout(500); // wait for menu animation

    // Use evaluate to click the delete menu item directly
    await page.evaluate(() => {
      const menuItems = document.querySelectorAll('[role="menuitem"]');
      for (const item of menuItems) {
        if (item.textContent?.includes('删除')) {
          (item as HTMLElement).click();
          break;
        }
      }
    });

    // Handle the native window.confirm() dialog
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain('确定删除项目');
    await dialog.accept();

    // ── Step 2: POST-COMMIT — project no longer exists, count -1 ──

    // Verify the project card is gone (UI)
    await expect(page.getByText('E2E-待删除项目')).not.toBeVisible({ timeout: 10_000 });

    // Backend verification
    await page.waitForTimeout(1_500);
    const projectsAfter = await readIndexedDBProjects(page);

    // Verify the project no longer exists in backend
    const deletedProject = projectsAfter.find((p) => p.id === targetId);
    expect(deletedProject).toBeUndefined();

    // Verify project count decreased
    expect(projectsAfter.length).toBe(countBefore - 1);

    // Verify the total count decreased
    expect(projectsAfter.length).toBe(countBefore - 1);

    expect(errors).toEqual([]);
  });
});
