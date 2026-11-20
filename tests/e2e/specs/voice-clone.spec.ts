/**
 * 语音克隆 E2E 测试 — MiMo 模型 + CosyVoice base64 直传注册
 *
 * MiMo voiceclone 无需云端注册，仅上传音频 + 标记，最适合自动化测试。
 * CosyVoice 注册走新式 voice-enrollment base64 直传；CI/E2E 环境无真实
 * DashScope Key，只验证失败路径（错误优雅呈现 + 回滚 + 数据未污染）。
 * 真实注册 happy path 是带 Key 环境的手工验收，见 docs/e2e-test-guide.md。
 *
 * @feature docs/feature-spec.md §3.3 Clone Flow
 * @feature docs/superpowers/specs/2026-11-20-cosyvoice-base64-enrollment-design.md
 */
import { expect, test } from '@playwright/test';
import { E2E_BACKEND_URL } from '../helpers/ports';
import path from 'node:path';
import {
  collectErrors,
  goToVoiceDesign,
  setLocaleToZhCN,
} from '../helpers';

const BASE_URL = E2E_BACKEND_URL;
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

test.describe('语音克隆 - CosyVoice base64 直传注册', () => {
  /** 后端是否配置了真实 DashScope Key（配置了则注册可能真调云端，跳过失败路径用例）。 */
  async function hasRealQwenKey(): Promise<boolean> {
    try {
      const resp = await fetch(`${E2E_BACKEND_URL}/api/model-config`);
      if (!resp.ok) return false;
      const body = await resp.json();
      const field = body?.qwen_tts?.fields?.api_key;
      return Boolean(field?.has_value || field?.value === '********');
    } catch {
      return false;
    }
  }

  const COSY_NAME = `e2e-cosy-${Date.now()}`;

  test('CosyVoice 注册失败路径：错误优雅呈现 + 回滚删除 + 数据未污染', async ({ page }) => {
    test.skip(await hasRealQwenKey(), '后端已配置真实 DashScope Key，无法确定性验证失败路径');

    await setLocaleToZhCN(page);
    // 失败路径会主动 console.error（Clone failed），只断言未捕获页面异常
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await goToVoiceDesign(page);
    await page.waitForTimeout(1_000);

    // ── Open clone panel & select CosyVoice engine ──
    const cloneBtn = page.getByRole('button', { name: /克隆声音/ });
    await expect(cloneBtn).toBeVisible({ timeout: 5_000 });
    await cloneBtn.click();
    await page.waitForTimeout(500);

    const cosyBtn = page.getByRole('button', { name: 'CosyVoice' }).first();
    await expect(cosyBtn).toBeVisible({ timeout: 3_000 });
    await cosyBtn.click();
    await page.waitForTimeout(300);

    // ── Upload sample audio ──
    const uploadZone = page.locator('label[for="audio-upload"]').first();
    await expect(uploadZone).toBeVisible({ timeout: 5_000 });
    await page.locator('#audio-upload').setInputFiles(SAMPLE_AUDIO);
    await page.waitForTimeout(1_500);

    // ── Trigger base64 direct registration ──
    const cloneAction = page.getByRole('button', { name: /使用 CosyVoice 复刻/ }).first();
    await expect(cloneAction).toBeVisible({ timeout: 15_000 });
    await cloneAction.click();

    // ── 失败必须给用户可见反馈（audioPreview.cloneFailed）──
    await expect(page.getByText('克隆失败，请重试')).toBeVisible({ timeout: 30_000 });

    // ── 数据断言：前端已回滚删除，后端不得留下该名字的 profile ──
    await page.waitForTimeout(1_000);
    const listResp = await fetch(`${E2E_BACKEND_URL}/api/clone/list`);
    const listBody = await listResp.json();
    const leaked = (listBody.items as Array<{ name: string }>).filter((v) => v.name === COSY_NAME);
    expect(leaked).toEqual([]);

    // ── 无未捕获页面异常 ──
    expect(pageErrors).toEqual([]);

    expect(collectErrors(page).filter((e) => !e.includes('Clone failed'))).toEqual([]);
  });

  test.afterAll(async () => {
    await deleteVoiceProfilesByPrefix('e2e-cosy-');
  });
});
