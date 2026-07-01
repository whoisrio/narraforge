import { describe, expect, it } from 'vitest';
import type { EngineParams } from '../types';
import { createVoiceRoleDraft, DEFAULT_EDGE_NARRATOR_VOICE } from './voiceRoleDefaults';

describe('voiceRoleDefaults', () => {
  it('creates a usable Edge-TTS narrator when the current voice is empty', () => {
    const currentParams: EngineParams = {
      engine: 'edge_tts',
      edge_voice: '',
      edge_rate: '+0%',
      edge_volume: '+0%',
    };

    const draft = createVoiceRoleDraft({
      name: '默认旁白',
      roleKind: 'Narrator',
      currentParams,
    });

    expect(draft.description).toBe('Narrator');
    expect(draft.default_engine).toBe('edge_tts');
    expect(draft.default_voice).toBe(DEFAULT_EDGE_NARRATOR_VOICE);
    expect(draft.default_engine_params).toMatchObject({
      engine: 'edge_tts',
      edge_voice: DEFAULT_EDGE_NARRATOR_VOICE,
      edge_rate: '+0%',
      edge_volume: '+0%',
    });
  });

  it('keeps the selected Edge-TTS voice when creating a Cast role', () => {
    const draft = createVoiceRoleDraft({
      name: '嘉宾1',
      roleKind: 'Cast',
      currentParams: {
        engine: 'edge_tts',
        edge_voice: 'zh-CN-YunyangNeural',
        edge_rate: '+8%',
        edge_volume: '+0%',
      },
    });

    expect(draft.description).toBe('Cast');
    expect(draft.default_voice).toBe('zh-CN-YunyangNeural');
    expect(draft.default_engine_params.edge_voice).toBe('zh-CN-YunyangNeural');
  });

  it('falls back from unusable CosyVoice params to Edge-TTS for narrator creation', () => {
    const draft = createVoiceRoleDraft({
      name: '默认旁白',
      roleKind: 'Narrator',
      currentParams: {
        engine: 'cosyvoice',
        voice_id: '',
        speed: 1,
        volume: 80,
        pitch: 1,
        language: 'Chinese',
      },
    });

    expect(draft.default_engine).toBe('edge_tts');
    expect(draft.default_voice).toBe(DEFAULT_EDGE_NARRATOR_VOICE);
    expect(draft.default_engine_params.edge_voice).toBe(DEFAULT_EDGE_NARRATOR_VOICE);
  });
});
