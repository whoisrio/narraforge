/**
 * 语音克隆 E2E 测试 — MiMo 模型
 *
 * MiMo voiceclone 无需云端注册，仅上传音频 + 标记，最适合自动化测试。
 *
 * @feature docs/feature-spec.md §3.3 Clone Flow
 * @feature G3: voice clone E2E
 */
import { expect, test } from '@playwright/test';
import path from 'node:path';
import {
  collectErrors,
  goToVoiceDesign,
  setLocaleToZhCN,
} from '../helpers';

const BASE_URL = 'http://127.0.0.1:8002';
const SAMPLE_AUDIO = path.resolve(__dirname, '..', 'fixtures', 'sample-audio', 'temp_audio.mp3');
const CLONE_NAME = `e2e-mimo-${Date.now()}`;

/** Delete voice profiles by name prefix via backend API. */
async function deleteVoiceProfilesByPrefix(prefix: string): Promise<void> {
  const resp = await fetch(`${BASE_URL}/api/clone`);
  if (!resp.ok) return;
  const voices: Array<{ id: string; name: string }> = await resp.json();
  for (const voice of voices) {
    if (voice.name.startsWith(prefix)) {
      await fetch(`${BASE_URL}/api/clone/${voice.id}`, { method: 'DELETE' }).catch(() => {});
    }
  }
}

test.describe('语音克隆', () => {
  test('使用 MiMo-TTS 克隆声音：上传音频 → 复刻 → 验证音色出现在列表中', async ({ page }) => {
    await setLocaleToZhCN(page);
    const errors = collectErrors(page);

    await goToVoiceDesign(page);
    await page.waitForTimeout(1_000);

    // ── Open clone panel ──
    const cloneBtn = page.getByRole('button', { name: /克隆声音/ });
    await expect(cloneBtn).toBeVisible({ timeout: 5_000 });
    await cloneBtn.click();
    await page.waitForTimeout(500);

    // ── Select MiMo-TTS engine ──
    const mimoBtn = page.getByRole('button', { name: 'MiMo-TTS' });
    await expect(mimoBtn).toBeVisible({ timeout: 3_000 });
    await mimoBtn.click();
    await page.waitForTimeout(300);

    // ── Click "上传文件" method card ──
    const uploadCard = page.getByText(/上传文件/).first();
    await expect(uploadCard).toBeVisible({ timeout: 3_000 });
    await uploadCard.click();
    await page.waitForTimeout(500);

    // ── Upload file via the file input or drag-drop zone ──
    // AudioUploader renders <input id="audio-upload" style="display:none">
    // and a visible <label htmlFor="audio-upload"> as the upload zone.
    const uploadZone = page.locator('label[for="audio-upload"]').first();
    await expect(uploadZone).toBeVisible({ timeout: 5_000 });

    // Set the file on the hidden input — this triggers the React onChange handler
    const fileInput = page.locator('#audio-upload');
    await fileInput.setInputFiles(SAMPLE_AUDIO);
    await page.waitForTimeout(1_500);

    // ── Wait for AudioPreview to render with «使用 MiMo-TTS 复刻» ──
    const cloneAction = page.getByRole('button', { name: /使用 MiMo-TTS 复刻/ }).first();
    await expect(cloneAction).toBeVisible({ timeout: 15_000 });

    // Fill voice name. The label is 「音色名称」, input placeholder is the filename.
    // Use the label to locate the input:
    const nameLabel = page.getByText('音色名称').first();
    const nameInput = nameLabel.locator('..').locator('input').first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill(CLONE_NAME);

    // ── Click clone ──
    await cloneAction.click();
    await page.waitForTimeout(3_000);

    // ── Verify voice card appears ──
    const voiceCard = page.locator('[class*="card"], [class*="Card"]').filter({ hasText: CLONE_NAME }).first();
    await expect(voiceCard).toBeVisible({ timeout: 10_000 });

    expect(errors).toEqual([]);
  });

  // Cleanup: delete the voice profile created by this test
  test.afterAll(async () => {
    await deleteVoiceProfilesByPrefix('e2e-mimo-');
  });
});
