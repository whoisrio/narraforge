/**
 * 音色头像工具
 * 使用本地 PNG 头像，支持性别回退
 */

import defaultMan from '../assets/avatars/default_man.png';
import defaultWoman from '../assets/avatars/default_woman.png';
import steampunk from '../assets/avatars/steampunk_9436366.png';
import artist from '../assets/avatars/artist_1338036.png';
import pilot from '../assets/avatars/pilot_5101588.png';
import yunyang from '../assets/avatars/yunyang.png';
import yunjian from '../assets/avatars/yunjian.png';

/** 特定音色的专属头像 */
const VOICE_MAP: Record<string, string> = {
  'yunyang': yunyang,
  'yunjian': yunjian,
  'steampunk': steampunk,
  'artist': artist,
  'pilot': pilot,
};

/**
 * 根据音色名和性别获取头像图片路径
 */
export function getVoiceAvatarSrc(name: string, gender?: string): string {
  const key = (name || '').toLowerCase().trim();

  // 1. 精确匹配特定音色
  for (const [k, v] of Object.entries(VOICE_MAP)) {
    if (key.includes(k)) return v;
  }

  // 2. 按性别分配默认头像
  const g = (gender || '').toLowerCase();
  if (g === 'female' || g === '女') return defaultWoman;
  return defaultMan;
}
