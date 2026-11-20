/**
 * VoiceClone 声音卡片可见性过滤。
 *
 * 云端同步（sync-from-qwen）的音色本地没有 source/preview 音频，
 * 旧过滤会全部隐藏导致无法管理 —— 必须按 cosyvoice voice_id 放行。
 */
import { describe, expect, it } from 'vitest';
import { isManageableVoice } from '../voiceManageability';
import type { VoiceProfile } from '../../types';

function makeVoice(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: 'v1',
    name: 'voice',
    voice: { model: '', voice_type: 'upload' },
    voice_params: {},
    created_at: '2026-01-01',
    has_preview: false,
    has_source: false,
    ...overrides,
  } as VoiceProfile;
}

describe('isManageableVoice', () => {
  it('本地有源音频的音色可见（上传/注册）', () => {
    expect(isManageableVoice(makeVoice({ has_source: true }))).toBe(true);
  });

  it('本地有试听音频的音色可见', () => {
    expect(isManageableVoice(makeVoice({ has_preview: true }))).toBe(true);
  });

  it('云端同步音色（cosyvoice voice_id，无本地音频）可见', () => {
    const v = makeVoice({
      voice: { model: 'cosyvoice', voice_type: 'clone' },
      voice_params: {
        cosyvoice: { params: { voice_id: 'cosyvoice-v3.5-plus-guanyu-abc' } },
      },
    });
    expect(isManageableVoice(v)).toBe(true);
  });

  it('无音频也无 voice_id 的记录不可见', () => {
    expect(isManageableVoice(makeVoice())).toBe(false);
  });
});
