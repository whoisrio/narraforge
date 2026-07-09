/**
 * File-system assertion helpers for E2E tests.
 *
 * Used to verify that destructive operations (delete project, delete segment,
 * regenerate all) actually remove associated files from disk.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from '@playwright/test';

const E2E_SEGMENTED_DIR = path.resolve(__dirname, '..', '..', '..', 'backend', 'uploads', 'segmented');

/**
 * Assert that a segmented project directory has been fully removed from disk.
 */
export function expectProjectDirGone(projectId: string): void {
  const dir = path.join(E2E_SEGMENTED_DIR, projectId);
  expect(
    retryUntilGone(dir, 5000),
    `Project directory should be deleted: ${dir}`
  ).toBe(true);
}

/**
 * Assert that a segment's audio file has been removed from disk.
 */
export function expectSegmentFileGone(projectId: string, chapterId: string, segmentId: string): void {
  const candidates = ['mp3', 'wav'].map(ext =>
    path.join(E2E_SEGMENTED_DIR, projectId, 'chapters', chapterId, 'segments', `${segmentId}.${ext}`)
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
export function expectSegmentFileExists(projectId: string, chapterId: string, segmentId: string): void {
  const candidates = ['mp3', 'wav'].map(ext =>
    path.join(E2E_SEGMENTED_DIR, projectId, 'chapters', chapterId, 'segments', `${segmentId}.${ext}`)
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
export function listSegmentFiles(projectId: string, chapterId: string, segmentId: string): string[] {
  const segDir = path.join(E2E_SEGMENTED_DIR, projectId, 'chapters', chapterId, 'segments');
  if (!fs.existsSync(segDir)) return [];
  const prefix = `${segmentId}.`;
  return fs.readdirSync(segDir)
    .filter(f => f.startsWith(prefix))
    .map(f => path.join(segDir, f));
}
