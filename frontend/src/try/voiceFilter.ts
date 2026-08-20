import type { EdgeVoice } from '../types';

/** 从音色列表提取去重语言（保持首次出现顺序，便于下拉展示）。 */
export function distinctLanguages(voices: EdgeVoice[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of voices) {
    if (v.language && !seen.has(v.language)) {
      seen.add(v.language);
      out.push(v.language);
    }
  }
  return out;
}

export interface VoiceFilter {
  /** 空串 = 不过滤 */
  language: string;
  /** 空串 = 不过滤；取值 'Female' | 'Male' */
  gender: string;
}

export function filterEdgeVoices(voices: EdgeVoice[], filter: VoiceFilter): EdgeVoice[] {
  return voices.filter(
    (v) =>
      (!filter.language || v.language === filter.language) &&
      (!filter.gender || v.gender === filter.gender),
  );
}
