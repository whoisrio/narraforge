import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function readAgentThread(page: Page, threadId: string): Promise<any> {
  return page.evaluate(async (tid) => {
    const r = await fetch(`/agent/threads/${tid}/state`);
    return r.json();
  }, threadId);
}

export function validateThreadState(
  thread: any,
  expected: {
    currentStage?: string;
    status?: string;
    hasKey?: string;
    notHasKey?: string;
  },
) {
  if (expected.currentStage)
    expect(thread.values?.current_stage).toBe(expected.currentStage);
  if (expected.status) expect(thread.status).toBe(expected.status);
  if (expected.hasKey) expect(thread.values?.[expected.hasKey]).toBeTruthy();
  if (expected.notHasKey)
    expect(thread.values?.[expected.notHasKey]).toBeUndefined();
}

export async function verifyAgentStateWithScreenshot(
  page: Page,
  threadId: string,
  label: string,
  expected: { currentStage?: string; status?: string; hasKey?: string },
) {
  const thread = await readAgentThread(page, threadId);
  validateThreadState(thread, expected);
  await page.screenshot({
    path: `test-results/${label}.png`,
    fullPage: true,
  });
}