import { describe, expect, it } from 'vitest';
import {
  ENGINE_CAPABILITIES,
  EMOTION_LEADING_TAG,
  STYLE_TAG_CATEGORIES,
  VOXCPM_INLINE_TAGS,
  buildLeadingStyleTag,
  describeEngineCapability,
  getStyleCapability,
  normalizeVoxcpmMode,
  stripInlineTags,
  stripLeadingStyleTag,
  stripStyleTags,
} from './styleTags';

describe('ENGINE_CAPABILITIES', () => {
  it('matches the backend engine_capabilities mirror', () => {
    expect(ENGINE_CAPABILITIES.mimo_tts).toEqual({ inline: false, leading: true, instruction: true });
    expect(ENGINE_CAPABILITIES.voxcpm).toEqual({ inline: true, leading: true, instruction: true });
    expect(ENGINE_CAPABILITIES.cosyvoice).toEqual({ inline: false, leading: false, instruction: true });
    expect(ENGINE_CAPABILITIES.edge_tts).toEqual({ inline: false, leading: false, instruction: false });
  });

  it('getStyleCapability falls back to all-false for unknown engines', () => {
    expect(getStyleCapability('unknown')).toEqual({ inline: false, leading: false, instruction: false });
  });

  it('describeEngineCapability summarizes each engine', () => {
    expect(describeEngineCapability('voxcpm')).toBe('位置 tag + 开头风格');
    expect(describeEngineCapability('mimo_tts')).toBe('开头风格标签');
    expect(describeEngineCapability('cosyvoice')).toBe('仅指令');
    expect(describeEngineCapability('edge_tts')).toBe('不支持');
  });
});

describe('EMOTION_LEADING_TAG', () => {
  it('maps the five primary emotions', () => {
    expect(EMOTION_LEADING_TAG).toEqual({
      happy: '开心', sad: '悲伤', angry: '愤怒', calm: '平静', excited: '兴奋',
    });
  });
});

describe('buildLeadingStyleTag', () => {
  it('joins multiple styles with half-width parens and commas (backend rule)', () => {
    expect(buildLeadingStyleTag(['开心'])).toBe('(开心)');
    expect(buildLeadingStyleTag(['开心', '兴奋'])).toBe('(开心,兴奋)');
  });
});

describe('normalizeVoxcpmMode', () => {
  it('normalizes the tts alias to tts_design', () => {
    expect(normalizeVoxcpmMode('tts')).toBe('tts_design');
    expect(normalizeVoxcpmMode('tts_design')).toBe('tts_design');
    expect(normalizeVoxcpmMode('clone')).toBe('clone');
    expect(normalizeVoxcpmMode('ultimate')).toBe('ultimate');
    expect(normalizeVoxcpmMode('')).toBe('clone');
  });
});

describe('tag whitelist', () => {
  it('covers 5 categories and all whitelisted tags', () => {
    expect(STYLE_TAG_CATEGORIES.map((c) => c.label)).toEqual(['哭笑', '叹息', '停顿思考', '疑问', '情绪']);
    expect(VOXCPM_INLINE_TAGS).toEqual([
      '[laughing]', '[sigh]', '[Uhm]', '[Shh]',
      '[Question-ah]', '[Question-ei]', '[Question-en]', '[Question-oh]',
      '[Surprise-wa]', '[Surprise-yo]', '[Dissatisfaction-hnn]',
    ]);
  });
});

describe('stripInlineTags', () => {
  it('removes whitelisted inline tags', () => {
    expect(stripInlineTags('你好[laughing]世界')).toBe('你好世界');
    expect(stripInlineTags('嗯 [Uhm] 我想想')).toBe('嗯 我想想');
    expect(stripInlineTags('[sigh]没办法')).toBe('没办法');
  });

  it('removes multiple tags', () => {
    expect(stripInlineTags('啊[Surprise-wa]真的吗[Question-ah]')).toBe('啊真的吗');
  });

  it('keeps non-whitelisted bracket text', () => {
    expect(stripInlineTags('见[注释]内容')).toBe('见[注释]内容');
  });
});

describe('stripLeadingStyleTag', () => {
  it('removes a leading (风格) tag with half/full-width parens', () => {
    expect(stripLeadingStyleTag('(开心)今天天气真好')).toBe('今天天气真好');
    expect(stripLeadingStyleTag('（悲伤）他离开了')).toBe('他离开了');
    expect(stripLeadingStyleTag('(唱歌)啦啦啦')).toBe('啦啦啦');
  });

  it('removes a leading [风格] tag', () => {
    expect(stripLeadingStyleTag('[laughing]哈哈哈哈')).toBe('哈哈哈哈');
  });

  it('keeps leading tag when there is no trailing content boundary issue', () => {
    expect(stripLeadingStyleTag('没有标签的文本')).toBe('没有标签的文本');
  });

  it('does not remove tags that are not at the start', () => {
    expect(stripLeadingStyleTag('他说(开心)太好了')).toBe('他说(开心)太好了');
  });
});

describe('stripStyleTags', () => {
  it('removes both leading and inline tags', () => {
    expect(stripStyleTags('(开心)今天[laughing]天气真好')).toBe('今天天气真好');
    expect(stripStyleTags('（平静）嗯 [Uhm] 好吧[sigh]')).toBe('嗯 好吧');
  });
});
