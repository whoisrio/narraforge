/**
 * File-system assertion helpers for E2E tests.
 *
 * Used to verify that destructive operations (delete project, delete segment,
 * regenerate all) actually remove associated files from disk.
 *
 * Layout (plan B): data/projects/{project-slug}/chapters/{chapter-id}/segments/{segment-id}.{ext}
 * The project dir is the name slug — resolve it from the manifest, which
 * records the DB id (`projectDirNameForId`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from '@playwright/test';

const E2E_SEGMENTED_DIR = path.resolve(__dirname, '..', '..', '..', 'backend', 'data', 'projects');

/**
 * Resolve a project's asset dir name (its name slug) by scanning manifests
 * for the given DB project id. Returns undefined when not found.
 */
export function projectDirNameForId(projectId: string): string | undefined {
  if (!fs.existsSync(E2E_SEGMENTED_DIR)) return undefined;
  for (const dirName of fs.readdirSync(E2E_SEGMENTED_DIR)) {
    const manifestPath = path.join(E2E_SEGMENTED_DIR, dirName, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (manifest?.id === projectId) return dirName;
    } catch { /* ignore unreadable manifest */ }
  }
  return undefined;
}

/**
 * Assert that a project asset directory has been fully removed from disk.
 * Pass the dir NAME (slug) — resolve it via projectDirNameForId BEFORE the
 * project is deleted.
 */
export function expectProjectDirGone(dirName: string): void {
  const dir = path.join(E2E_SEGMENTED_DIR, dirName);
  expect(
    retryUntilGone(dir, 5000),
    `Project directory should be deleted: ${dir}`
  ).toBe(true);
}

/**
 * Assert that a segment's audio file has been removed from disk.
 */
export function expectSegmentFileGone(projectDirName: string, chapterId: string, segmentId: string): void {
  const candidates = ['mp3', 'wav'].map(ext =>
    path.join(E2E_SEGMENTED_DIR, projectDirName, 'chapters', chapterId, 'segments', `${segmentId}.${ext}`)
  );
  for (const f of candidates) {
    expect(
      retryUntilGone(f, 5000),
      `Segment audio file should be deleted: ${f}`
    ).toBe(true);
  }
}

/**
 * Poll every 200ms for up to `maxWaitMs` until the path no longer exists.
 * Returns true if gone, false if still there after timeout.
 */
function retryUntilGone(p: string, maxWaitMs: number): boolean {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(p)) return true;
    // Brief sleep — in ESM Playwright we can't do sync sleep, but fs check is cheap
    const start = Date.now();
    while (Date.now() - start < 200) { /* spin-wait, acceptable for 5s max */ }
  }
  return !fs.existsSync(p);
}

/**
 * Assert that a segment's audio file EXISTS on disk (verify synthesis actually wrote it).
 */
export function expectSegmentFileExists(projectDirName: string, chapterId: string, segmentId: string): void {
  const candidates = ['mp3', 'wav'].map(ext =>
    path.join(E2E_SEGMENTED_DIR, projectDirName, 'chapters', chapterId, 'segments', `${segmentId}.${ext}`)
  );
  const found = candidates.find(f => fs.existsSync(f));
  expect(found,
    `Segment audio file should exist (${candidates.join(' or ')})`
  ).toBeTruthy();
}

/**
 * List audio files currently on disk for a segment.
 * Returns array of paths (empty if no files yet).
 */
export function listSegmentFiles(projectDirName: string, chapterId: string, segmentId: string): string[] {
  const segDir = path.join(E2E_SEGMENTED_DIR, projectDirName, 'chapters', chapterId, 'segments');
  if (!fs.existsSync(segDir)) return [];
  const prefix = `${segmentId}.`;
  return fs.readdirSync(segDir)
    .filter(f => f.startsWith(prefix))
    .map(f => path.join(segDir, f));
}
