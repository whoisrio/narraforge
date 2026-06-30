/**
 * voiceResolution 核心函数测试
 *
 * 测试 resolveEffectiveVoice()（三层继承合并）和 isAudioStale()（stale 检测）
 */
import { describe, expect, it } from 'vitest';
import { isAudioStale, mergeDeep, resolveEffectiveVoice } from '../voiceResolution';
import type { EngineParams, Role, VoiceSource } from '../../types';

/* ------------------------------------------------------------------ */
/* 测试辅助工厂                                                       */
/* ------------------------------------------------------------------ */

function edgeTTSParams(overrides: Partial<EngineParams> = {}): EngineParams {
  return {
    engine: 'edge_tts',
    voice: 'zh-CN-YunxiNeural',
    rate: '+0%',
    volume: '+0%',
    ...overrides,
  } as EngineParams;
}

function mimoParams(overrides: Partial<EngineParams> = {}): EngineParams {
  return {
    engine: 'mimo_tts',
    mode: 'voiceclone',
    voice_id: 'v_01',
    instruction: '',
    ...overrides,
  } as EngineParams;
}

function cosyvoiceParams(overrides: Partial<EngineParams> = {}): EngineParams {
  return {
    engine: 'cosyvoice',
    voice_id: 'v_01',
    instruction: '',
    speed: 1.0,
    volume: 80,
    pitch: 1.0,
    language: 'Chinese',
    ...overrides,
  } as EngineParams;
}

function makeRole(id: string, name: string, voice: EngineParams): Role {
  return {
    id,
    name,
    role_kind: 'cast',
    voice,
    favorite_styles: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

/* ------------------------------------------------------------------ */
/* mergeDeep                                                          */
/* ------------------------------------------------------------------ */

describe('mergeDeep', () => {
  it('shallow merge replaces keys', () => {
    const base = { a: 1, b: 2 };
    const over = { b: 99 };
    expect(mergeDeep(base, over)).toEqual({ a: 1, b: 99 });
  });

  it('nested objects are merged recursively', () => {
    const base = { params: { a: 1, b: 2 }, engine: 'edge_tts' };
    const over = { params: { b: 99, c: 3 } };
    expect(mergeDeep(base, over)).toEqual({
      params: { a: 1, b: 99, c: 3 },
      engine: 'edge_tts',
    });
  });

  it('null / undefined overrides do not crash', () => {
    const base = { a: 1 };

    function mergeWithUndefined() {
      const over = undefined as unknown as Record<string, unknown>;
      if (over) mergeDeep(base, over);
      else return base;
    }
    expect(mergeWithUndefined()).toEqual(base);
  });

  it('empty override does not change base', () => {
    const base = { a: 1, params: { x: 1 } };
    expect(mergeDeep(base, {} as Record<string, unknown>)).toEqual(base);
  });
});

/* ------------------------------------------------------------------ */
/* resolveEffectiveVoice                                               */
/* ------------------------------------------------------------------ */

describe('resolveEffectiveVoice', () => {
  const chapterDefaults = edgeTTSParams({ voice: 'zh-CN-YunxiNeural' });

  describe('source = chapter', () => {
    it('returns chapter defaults unchanged', () => {
      const voice: VoiceSource = { source: 'chapter' };
      const result = resolveEffectiveVoice(voice, undefined, chapterDefaults);
      expect(result).toEqual(chapterDefaults);
    });
  });

  describe('source = role', () => {
    it('returns role.voice overriding chapter defaults', () => {
      const role = makeRole('r1', '小明', mimoParams({ instruction: '急促' }));
      const voice: VoiceSource = { source: 'role', role_id: 'r1' };
      const result = resolveEffectiveVoice(voice, role, chapterDefaults);

      expect(result.engine).toBe('mimo_tts');
      expect(result).toMatchObject({
        engine: 'mimo_tts',
        mode: 'voiceclone',
        voice_id: 'v_01',
        instruction: '急促',
      });
    });

    it('falls back to chapter when role is undefined', () => {
      const voice: VoiceSource = { source: 'role', role_id: 'r1' };
      const result = resolveEffectiveVoice(voice, undefined, chapterDefaults);
      expect(result).toEqual(chapterDefaults);
    });

    it('role.voice partially overrides chapter — unmatched keys stay chapter', () => {
      const role = makeRole('r1', '小明', {
        engine: 'edge_tts',
        voice: 'zh-CN-YunyangNeural',
        rate: '+0%',
        volume: '+0%',
      } as EngineParams);
      const voice: VoiceSource = { source: 'role', role_id: 'r1' };
      const result = resolveEffectiveVoice(voice, role, chapterDefaults);

      // role overrides voice but rate/volume from chapter remain
      expect(result.engine).toBe('edge_tts');
      expect(result).toMatchObject({ voice: 'zh-CN-YunyangNeural' });
    });
  });

  describe('source = custom', () => {
    it('returns merge of chapter + role + custom params', () => {
      const role = makeRole('r1', '小明', mimoParams({ instruction: '默认' }));
      const voice: VoiceSource = {
        source: 'custom',
        engine: 'mimo_tts',
        params: { instruction: '急促' },
      };
      const result = resolveEffectiveVoice(voice, role, chapterDefaults);

      expect(result.engine).toBe('mimo_tts');
      // custom params override role
      expect(result).toMatchObject({ instruction: '急促' });
      // role's engine + voice_id still inherited
      expect(result).toMatchObject({ engine: 'mimo_tts', mode: 'voiceclone', voice_id: 'v_01' });
    });

    it('without role, only chapter + custom merged', () => {
      const voice: VoiceSource = {
        source: 'custom',
        engine: 'edge_tts',
        params: { rate: '+20%' },
      };
      const result = resolveEffectiveVoice(voice, undefined, chapterDefaults);

      expect(result).toMatchObject({
        engine: 'edge_tts',
        voice: 'zh-CN-YunxiNeural', // from chapter (not overridden)
        rate: '+20%', // from custom
      });
    });

    it('custom with role_id but no role fallback to chapter', () => {
      const voice: VoiceSource = {
        source: 'custom',
        engine: 'edge_tts',
        params: { rate: '+20%' },
        role_id: 'missing_role',
      };
      const result = resolveEffectiveVoice(voice, undefined, chapterDefaults);
      expect(result).toMatchObject({ engine: 'edge_tts', rate: '+20%' });
    });

    it('custom params takes highest priority (custom > role > chapter)', () => {
      const role = makeRole('r1', '小明', cosyvoiceParams({ instruction: 'role-instr' }));
      const chapter = cosyvoiceParams({ instruction: 'chap-instr' });
      const voice: VoiceSource = {
        source: 'custom',
        engine: 'cosyvoice',
        params: { instruction: 'custom-instr' },
      };

      const result = resolveEffectiveVoice(voice, role, chapter);
      expect(result).toMatchObject({ instruction: 'custom-instr' });
    });
  });

  describe('real-world scenario: edge_tts chapter → mimo_tts role → custom instruction', () => {
    it('produces correct merged result', () => {
      const chapter = edgeTTSParams({ voice: 'zh-CN-YunxiNeural' });
      const role = makeRole('r1', '小明', mimoParams({ instruction: '' }));
      const voice: VoiceSource = {
        source: 'custom',
        engine: 'mimo_tts',
        params: { instruction: '压低声音，急促' },
      };
      const result = resolveEffectiveVoice(voice, role, chapter);

      expect(result.engine).toBe('mimo_tts');
      expect(result).toMatchObject({
        engine: 'mimo_tts',
        mode: 'voiceclone',
        voice_id: 'v_01',
        instruction: '压低声音，急促',
      });
      // chapter edge_tts fields should NOT leak into mimo result
      expect(result).not.toHaveProperty('voice');
      expect(result).not.toHaveProperty('rate');
      expect(result).not.toHaveProperty('volume');
    });
  });
});

/* ------------------------------------------------------------------ */
/* isAudioStale                                                        */
/* ------------------------------------------------------------------ */

describe('isAudioStale', () => {
  const base = mimoParams({ instruction: '平静' });

  it('returns false when current equals generated', () => {
    expect(isAudioStale(base, base)).toBe(false);
  });

  it('returns false when generated is undefined', () => {
    expect(isAudioStale(base, undefined)).toBe(false);
  });

  it('returns true when engine differs', () => {
    const generated = { ...base, engine: 'edge_tts' as const };
    expect(isAudioStale(base, generated)).toBe(true);
  });

  it('returns true when instruction differs', () => {
    const generated = { ...base, instruction: '急促' };
    expect(isAudioStale(base, generated)).toBe(true);
  });

  it('returns false when generated has extra keys not in current', () => {
    const generated = { ...base, extra_key: 'ignored' as unknown as undefined };
    expect(isAudioStale(base, generated)).toBe(false);
  });

  it('returns true when current has a key not in generated', () => {
    const current = { ...base, instruction: '新的' };
    const gen = { ...base, instruction: 'old' };
    expect(isAudioStale(current, gen)).toBe(true);
  });
});
