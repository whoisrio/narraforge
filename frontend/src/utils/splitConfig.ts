/**
 * 规则拆分的标点常量（与后端 text_split_service.DEFAULT_RULE_DELIMITERS 保持一致）。
 * 默认双语：中文全角 + 英文半角句读，保证中文 / 英文 / 中英混排文本都能正确切分。
 */

/** 新章节的默认拆分标点（不含「、」——顿号太碎，需用户手动开启） */
export const DEFAULT_SPLIT_DELIMITERS = ['，', '。', '！', '？', '；', '.', ',', '!', '?', ';'];

/** 拆分设置面板里可选的全部标点 */
export const DELIMITER_OPTIONS = ['，', '。', '！', '？', '；', '、', '.', ',', '!', '?', ';'];
