import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RoleSnapshot } from '../types';
import { mimoTtsApi, ttsApi, voxcpmApi } from './api';
import { synthesizeVoiceRolePreview } from './voiceRolePreview';

vi.mock('./api', () => ({
  ttsApi: { synthesize: vi.fn() },
  mimoTtsApi: {
    synthesizePreset: vi.fn(),
    synthesizeVoiceClone: vi.fn(),
    synthesizeVoiceDesign: vi.fn(),
  },
  voxcpmApi: {
    tts: vi.fn(),
    design: vi.fn(),
    clone: vi.fn(),
    ultimateClone: vi.fn(),
  },
}));

const baseRole: RoleSnapshot = {
  id: 'role-1',
  name: '角色',
  description: 'Cast',
  default_engine: 'edge_tts',
  default_voice: 'zh-CN-YunyangNeural',
  default_engine_params: { engine: 'edge_tts', voice: 'zh-CN-YunyangNeural', rate: '+0%', volume: '+0%' },
  favorite_styles: [],
};

describe('synthesizeVoiceRolePreview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes Edge-TTS role preview to backend /tts/synthesize with edge params', async () => {
    vi.mocked(ttsApi.synthesize).mockResolvedValue({ audio_id: 'a1', audio_base64: 'abc', audio_format: 'mp3', text: 'hello', params: {} });

    await synthesizeVoiceRolePreview(baseRole, 'hello');

    expect(ttsApi.synthesize).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      engine: 'edge_tts',
      voice_id: '',
      edge_voice: 'zh-CN-YunyangNeural',
      edge_rate: '+0%',
      edge_volume: '+0%',
      format: 'mp3',
    }));
  });

  it('routes MiMo preset previews through the MiMo backend endpoint', async () => {
    vi.mocked(mimoTtsApi.synthesizePreset).mockResolvedValue({ audio_id: 'm1', audio_base64: 'abc', audio_format: 'mp3', text: 'hello', params: {} });

    await synthesizeVoiceRolePreview({
      ...baseRole,
      default_engine: 'mimo_tts',
      default_voice: '冰糖',
      default_engine_params: { engine: 'mimo_tts', mode: 'preset', voice_id: '冰糖', instruction: '活泼' },
    }, 'hello');

    expect(mimoTtsApi.synthesizePreset).toHaveBeenCalledWith({ text: 'hello', voice: '冰糖', instruction: '活泼', format: 'mp3' });
  });

  it('routes VoxCPM design previews through the VoxCPM backend endpoint', async () => {
    vi.mocked(voxcpmApi.design).mockResolvedValue({ audio_id: 'v1', audio_base64: 'abc', audio_format: 'wav', text: 'hello', params: {} });

    await synthesizeVoiceRolePreview({
      ...baseRole,
      default_engine: 'voxcpm',
      default_voice: '低沉纪录片男声',
      default_engine_params: { engine: 'voxcpm', mode: 'tts_design', voice_id: '', voice_description: '低沉纪录片男声', cfg_value: 2.2, inference_timesteps: 12 },
    }, 'hello');

    expect(voxcpmApi.design).toHaveBeenCalledWith({
      text: 'hello',
      voice_description: '低沉纪录片男声',
      cfg_value: 2.2,
      inference_timesteps: 12,
      format: 'wav',
    });
  });
});
