import { describe, it, expect } from 'vitest';
import { distinctLanguages, filterEdgeVoices } from './voiceFilter';
import type { EdgeVoice } from '../types';

const VOICES: EdgeVoice[] = [
  { name: 'Ava', short_name: 'en-US-AvaNeural', display_name: 'Ava', gender: 'Female', locale: 'en-US', language: 'English' },
  { name: 'Andrew', short_name: 'en-US-AndrewNeural', display_name: 'Andrew', gender: 'Male', locale: 'en-US', language: 'English' },
  { name: 'Sonia', short_name: 'en-GB-SoniaNeural', display_name: 'Sonia', gender: 'Female', locale: 'en-GB', language: 'English' },
  { name: 'Xiaoxiao', short_name: 'zh-CN-XiaoxiaoNeural', display_name: 'Xiaoxiao', gender: 'Female', locale: 'zh-CN', language: 'Chinese' },
];

describe('distinctLanguages', () => {
  it('returns unique languages in first-seen order', () => {
    expect(distinctLanguages(VOICES)).toEqual(['English', 'Chinese']);
  });

  it('returns empty list for no voices', () => {
    expect(distinctLanguages([])).toEqual([]);
  });
});

describe('filterEdgeVoices', () => {
  it('filters by language', () => {
    const out = filterEdgeVoices(VOICES, { language: 'Chinese', gender: '' });
    expect(out.map((v) => v.short_name)).toEqual(['zh-CN-XiaoxiaoNeural']);
  });

  it('filters by gender', () => {
    const out = filterEdgeVoices(VOICES, { language: '', gender: 'Male' });
    expect(out.map((v) => v.short_name)).toEqual(['en-US-AndrewNeural']);
  });

  it('filters by language and gender combined', () => {
    const out = filterEdgeVoices(VOICES, { language: 'English', gender: 'Female' });
    expect(out.map((v) => v.short_name)).toEqual(['en-US-AvaNeural', 'en-GB-SoniaNeural']);
  });

  it('empty filters return all voices', () => {
    expect(filterEdgeVoices(VOICES, { language: '', gender: '' })).toHaveLength(4);
  });
});
