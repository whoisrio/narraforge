import removeMarkdown from 'remove-markdown';

/**
 * 将 Markdown 文本转为 TTS 可读的纯文本。
 * - 表格 → 逐行 KV 格式
 * - 有序列表 → "第一、第二、"
 * - 无序列表 → 顿号连接
 * - 标题 → 加句号分段
 * - 通用 → remove-markdown 剥标记
 */
export function stripMarkdownForTTS(md: string): string {
  if (!md) return '';

  let text = md;

  // 1. 表格 → 可读 KV
  text = convertTables(text);

  // 2. 有序列表 → "第一、xxx；第二、xxx"
  text = convertOrderedLists(text);

  // 3. 无序列表 → 顿号/逗号连接
  text = convertUnorderedLists(text);

  // 4. 标题行 → 加句号（在 removeMarkdown 之前，因为之后 # 就没了）
  text = text.replace(/^(#{1,6})\s+(.+)$/gm, (_m, _h, content) => {
    return content.trim() + '。';
  });

  // 5. 分隔线 → 换段
  text = text.replace(/^[-*_]{3,}\s*$/gm, '\n');

  // 6. blockquote > 前缀去掉
  text = text.replace(/^>\s?/gm, '');

  // 7. 通用 markdown 剥离
  text = removeMarkdown(text, {
    stripListLeaders: false, // 我们已经自己处理了列表
    gfm: true,
    useImgAltText: true,
  });

  // 8. 清理多余空行
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

/**
 * 把 Markdown 表格转成逐行可读格式。
 * | 引擎 | 语言 | → 引擎：Edge，语言：中文
 */
function convertTables(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // 检测表格起始：至少有两个 | 且下一行是分隔行
    if (isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseTableRow(lines[i]);
      i += 2; // 跳过表头 + 分隔行

      const rows: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = parseTableRow(lines[i]);
        // 每行拼成 "表头1：值1，表头2：值2"
        const parts = cells.map((cell, ci) => {
          const h = headers[ci]?.trim() || '';
          const v = cell.trim();
          if (h && v) return `${h}：${v}`;
          return v;
        }).filter(Boolean);
        if (parts.length > 0) rows.push(parts.join('，'));
        i++;
      }
      result.push(rows.join('；'));
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join('\n');
}

function isTableRow(line: string | undefined): boolean {
  if (!line) return false;
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|', 1);
}

function isTableSeparator(line: string | undefined): boolean {
  if (!line) return false;
  return /^\|?[\s\-:|]+\|?$/.test(line.trim()) && line.includes('-');
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(c => c.trim());
}

/**
 * 有序列表 → "第一、xxx；第二、xxx"
 */
const ORDINALS = ['第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九', '第十',
  '第十一', '第十二', '第十三', '第十四', '第十五', '第十六', '第十七', '第十八', '第十九', '第二十'];

function convertOrderedLists(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const formatted = listItems.map((item, i) => {
      const prefix = ORDINALS[i] || `第${i + 1}`;
      return `${prefix}、${item}`;
    });
    result.push(formatted.join('；'));
    listItems = [];
  };

  for (const line of lines) {
    const m = line.match(/^\s*\d+\.\s+(.+)$/);
    if (m) {
      listItems.push(m[1].trim());
    } else {
      flushList();
      result.push(line);
    }
  }
  flushList();

  return result.join('\n');
}

/**
 * 无序列表 → 顿号连接
 */
function convertUnorderedLists(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    result.push(listItems.join('、') + '。');
    listItems = [];
  };

  for (const line of lines) {
    const m = line.match(/^\s*[-*+]\s+(.+)$/);
    if (m) {
      listItems.push(m[1].trim());
    } else {
      flushList();
      result.push(line);
    }
  }
  flushList();

  return result.join('\n');
}
