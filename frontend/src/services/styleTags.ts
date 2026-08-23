/**
 * 风格 tag 能力矩阵与清洗工具。
 *
 * 与后端 backend/app/services/engine_capabilities.py 互为镜像——
 * 修改任一侧的矩阵/白名单时必须同步另一侧。
 *
 * tag 形式：
 * - inline（位置 tag）：正文内嵌 `[laughing]` 形式，仅 voxcpm 支持（白名单见 STYLE_TAG_CATEGORIES）。
 * - leading（开头风格标签）：文本开头的 `(风格)` 标签，括号可为 () / （） / []。
 */
import type { EngineParams } from '../types';

export type StyleTagEngine = EngineParams['engine'];

export interface EngineStyleCapability {
  /** 正文内嵌 [laughing] 形式位置 tag */
  inline: boolean;
  /** 开头 (风格) 风格标签 */
  leading: boolean;
  /** 自然语言风格指令（instruction / style_control） */
  instruction: boolean;
}

export const ENGINE_CAPABILITIES: Record<StyleTagEngine, EngineStyleCapability> = {
  mimo_tts: { inline: false, leading: true, instruction: true },
  voxcpm: { inline: true, leading: true, instruction: true },
  cosyvoice: { inline: false, leading: false, instruction: true },
  edge_tts: { inline: false, leading: false, instruction: false },
  indextts: { inline: false, leading: false, instruction: false },
};

export function getStyleCapability(engine: string): EngineStyleCapability {
  return ENGINE_CAPABILITIES[engine as StyleTagEngine] ?? { inline: false, leading: false, instruction: false };
}

/** 引擎 tag 能力一句话描述（引擎选择面板用）。 */
export function describeEngineCapability(engine: string): string {
  const cap = getStyleCapability(engine);
  if (cap.inline && cap.leading) return '位置 tag + 开头风格';
  if (cap.leading) return '开头风格标签';
  if (cap.instruction) return '仅指令';
  return '不支持';
}

/** emotion → 开头风格标签（mimo/voxcpm leading tag 用）。 */
export const EMOTION_LEADING_TAG: Record<string, string> = {
  happy: '开心',
  sad: '悲伤',
  angry: '愤怒',
  calm: '平静',
  excited: '兴奋',
};

/**
 * 构造开头风格标签，与后端 engine_capabilities.py 规则一致：
 * 半角括号、多个风格逗号拼接，如 `(开心,兴奋)`。
 */
export function buildLeadingStyleTag(styles: string[]): string {
  return `(${styles.filter(Boolean).join(',')})`;
}

/**
 * voxcpm mode 别名归一化（与后端一致）：'tts' 是 'tts_design' 的别名。
 */
export function normalizeVoxcpmMode(mode: string): 'tts_design' | 'clone' | 'ultimate' {
  if (mode === 'tts' || mode === 'tts_design') return 'tts_design';
  if (mode === 'ultimate') return 'ultimate';
  return 'clone';
}

/** voxcpm inline tag 白名单（分类菜单与清洗共用）。 */
export interface StyleTagCategory {
  key: string;
  label: string;
  tags: string[];
}

export const STYLE_TAG_CATEGORIES: StyleTagCategory[] = [
  { key: 'laugh_cry', label: '哭笑', tags: ['[laughing]'] },
  { key: 'sigh', label: '叹息', tags: ['[sigh]'] },
  { key: 'pause', label: '停顿思考', tags: ['[Uhm]', '[Shh]'] },
  { key: 'question', label: '疑问', tags: ['[Question-ah]', '[Question-ei]', '[Question-en]', '[Question-oh]'] },
  { key: 'emotion', label: '情绪', tags: ['[Surprise-wa]', '[Surprise-yo]', '[Dissatisfaction-hnn]'] },
];

export const VOXCPM_INLINE_TAGS: string[] = STYLE_TAG_CATEGORIES.flatMap((c) => c.tags);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const INLINE_TAG_RE = new RegExp(
  `\\s*(?:${VOXCPM_INLINE_TAGS.map(escapeRegExp).join('|')})`,
  'g',
);

/** 开头风格标签：() / （） / [] 一对括号，内容不含括号字符，最长 30 字。 */
const LEADING_TAG_RE = /^\s*(?:\([^()（）]{1,30}\)|（[^()（）]{1,30}）|\[[^[\]]{1,30}\])\s*/;

/** 移除正文中内嵌的 voxcpm 位置 tag（连同其前导空白）。 */
export function stripInlineTags(text: string): string {
  return text.replace(INLINE_TAG_RE, '');
}

/** 移除文本开头的一个 (风格) 标签。 */
export function stripLeadingStyleTag(text: string): string {
  return text.replace(LEADING_TAG_RE, '');
}

/** 组合清洗：开头风格标签 + 内嵌位置 tag（字幕导出等展示场景用）。 */
export function stripStyleTags(text: string): string {
  return stripInlineTags(stripLeadingStyleTag(text));
}

/** 成对的非嵌套括号：半角 (...) 或全角 （...）（与后端 engine_capabilities.py 同规则）。 */
const PAREN_PAIR_RE = /\([^()（）]*\)|（[^()（）]*）/g;

/**
 * 移除成对的半角 (...) / 全角 （...）括号及其内容，并清理多余空白。
 * 只处理非嵌套的成对括号；不匹配的括号原样保留。
 * 与后端 strip_parenthesized 互为镜像（双空格合并、标点前空格去掉）。
 */
export function stripParenthesized(text: string): string {
  if (!text) return '';
  return text
    .replace(PAREN_PAIR_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +(?=[，。！？；：、,.!?;:])/g, '')
    .trim();
}

/**
 * 合成前文本清洗（frontend 存储模式直调引擎端点时用，只影响合成语音，
 * seg.text、历史记录、字幕保持原文）。规则与后端 prepare_text_for_engine
 * 的 skip_parenthesized / underscore_to_space 一致，顺序相同：
 * 先移除括号内容，再把下划线/斜杠替换为空格。
 */
export function applyEngineTextCleaning(
  text: string,
  opts: { skipParenthesized?: boolean; underscoreToSpace?: boolean },
): string {
  let out = text;
  if (opts.skipParenthesized) out = stripParenthesized(out);
  if (opts.underscoreToSpace) out = out.replaceAll('_', ' ').replaceAll('/', ' ');
  return out;
}
