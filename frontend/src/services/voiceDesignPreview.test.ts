import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mimoTtsApi, ttsApi, voxcpmApi } from './api';
import { synthesizeVoiceDesignPreview } from './voiceDesignPreview';

vi.mock('./api', () => ({
  ttsApi: { synthesize: vi.fn() },
  mimoTtsApi: { synthesizeVoiceDesign: vi.fn() },
  voxcpmApi: { design: vi.fn() },
}));

describe('voiceDesignPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes MiMo voice design previews to the MiMo backend endpoint', async () => {
    vi.mocked(mimoTtsApi.synthesizeVoiceDesign).mockResolvedValue({
      audio_id: 'mimo-design-1',
      audio_base64: 'abc',
      audio_format: 'mp3',
      text: 'preview',
      params: {},
    });

    await synthesizeVoiceDesignPreview({
      engine: 'mimo',
      voiceDescription: '温暖、沉稳、有纪录片感的中文男声',
      sampleText: '这是一段试听文本。',
      intensity: 72,
      stability: 68,
    });

    expect(mimoTtsApi.synthesizeVoiceDesign).toHaveBeenCalledWith({
      voice_description: '温暖、沉稳、有纪录片感的中文男声',
      text: '这是一段试听文本。',
      optimize_text_preview: false,
      format: 'mp3',
    });
  });

  it('routes VoxCPM voice design previews to the VoxCPM backend endpoint with tuned params', async () => {
    vi.mocked(voxcpmApi.design).mockResolvedValue({
      audio_id: 'voxcpm-design-1',
      audio_base64: 'abc',
      audio_format: 'wav',
      text: 'preview',
      params: {},
    });

    await synthesizeVoiceDesignPreview({
      engine: 'voxcpm',
      voiceDescription: '低沉纪录片男声',
      sampleText: '这是一段试听文本。',
      intensity: 80,
      stability: 50,
    });

    expect(voxcpmApi.design).toHaveBeenCalledWith({
      voice_description: '低沉纪录片男声',
      text: '这是一段试听文本。',
      cfg_value: 2.6,
      inference_timesteps: 12,
      format: 'wav',
    });
  });

  it('uses CosyVoice synthesis for Qwen design fallback previews', async () => {
    vi.mocked(ttsApi.synthesize).mockResolvedValue({
      audio_id: 'qwen-design-1',
      audio_base64: 'abc',
      audio_format: 'mp3',
      text: 'preview',
      params: {},
    });

    await synthesizeVoiceDesignPreview({
      engine: 'qwen',
      voiceDescription: '温暖旁白',
      sampleText: '这是一段试听文本。',
      intensity: 60,
      stability: 70,
    });

    expect(ttsApi.synthesize).toHaveBeenCalledWith(expect.objectContaining({
      engine: 'cosyvoice',
      text: '这是一段试听文本。',
      instruction: '温暖旁白',
      format: 'mp3',
    }));
  });
});
