/**
 * SSML 工具栏组件
 *
 * 支持快速插入、修改、删除 CosyVoice SSML 标签：
 * - <speak> 根节点（rate, pitch, volume, effect）
 * - <break> 停顿（time）
 * - <sub> 替换文本（alias）
 * - <phoneme> 拼音/音标（alphabet, ph）
 * - <say-as> 内容类型（interpret-as）
 * - <soundEvent> 外部声音（src）
 */
import { useState, useCallback } from 'react';
import styles from './SSMLToolbar.module.css';

/** SSML 标签定义 */
interface SSMLTag {
  label: string;
  tag: string;
  description: string;
  /** 是否自闭合标签 */
  selfClosing?: boolean;
  /** 默认属性 */
  defaultAttrs?: Record<string, string>;
  /** 可选属性列表（供用户选择） */
  optionalAttrs?: { name: string; label: string; placeholder?: string; options?: string[] }[];
}

/** SSML 标签列表 */
const SSML_TAGS: SSMLTag[] = [
  {
    label: '停顿',
    tag: 'break',
    description: '插入静默停顿',
    selfClosing: true,
    defaultAttrs: { time: '500ms' },
    optionalAttrs: [
      { name: 'time', label: '时长', placeholder: '如 500ms / 2s', options: ['300ms', '500ms', '1s', '2s', '3s', '5s'] },
    ],
  },
  {
    label: '替换朗读',
    tag: 'sub',
    description: '将文本替换为指定朗读内容',
    defaultAttrs: { alias: '' },
    optionalAttrs: [
      { name: 'alias', label: '朗读内容', placeholder: '如：网络协议标准' },
    ],
  },
  {
    label: '拼音',
    tag: 'phoneme',
    description: '用拼音精确指定中文发音',
    defaultAttrs: { alphabet: 'py', ph: '' },
    optionalAttrs: [
      { name: 'alphabet', label: '发音类型', options: ['py', 'cmu'] },
      { name: 'ph', label: '拼音/音标', placeholder: '如：dian3 dang4 hang2' },
    ],
  },
  {
    label: '数字读法',
    tag: 'say-as',
    description: '按数字的标准读法朗读',
    defaultAttrs: { 'interpret-as': 'cardinal' },
  },
  {
    label: '逐位读数',
    tag: 'say-as',
    description: '逐个数字读出（如 123 → 一二三）',
    defaultAttrs: { 'interpret-as': 'digits' },
  },
  {
    label: '电话号码',
    tag: 'say-as',
    description: '按电话号码方式逐位读出',
    defaultAttrs: { 'interpret-as': 'telephone' },
  },
  {
    label: '日期',
    tag: 'say-as',
    description: '按日期格式朗读',
    defaultAttrs: { 'interpret-as': 'date' },
  },
  {
    label: '时间',
    tag: 'say-as',
    description: '按时间格式朗读',
    defaultAttrs: { 'interpret-as': 'time' },
  },
  {
    label: '货币',
    tag: 'say-as',
    description: '按货币金额朗读',
    defaultAttrs: { 'interpret-as': 'currency' },
  },
  {
    label: '逐字符',
    tag: 'say-as',
    description: '逐字符朗读',
    defaultAttrs: { 'interpret-as': 'characters' },
  },
  {
    label: '音效',
    tag: 'speak',
    description: '添加音效（机器人、萝莉等）',
    defaultAttrs: { effect: 'robot' },
    optionalAttrs: [
      { name: 'effect', label: '音效类型', options: ['robot', 'lolita', 'lowpass', 'echo'] },
    ],
  },
  {
    label: '插入音效',
    tag: 'soundEvent',
    description: '插入外部音效文件（铃声、猫叫等）',
    selfClosing: true,
    defaultAttrs: { src: '' },
    optionalAttrs: [
      { name: 'src', label: '音频URL', placeholder: '阿里云OSS上的WAV文件URL' },
    ],
  },
];

/** 从文本中查找光标所在的 SSML 标签 */
function findSSMLTagAtCursor(text: string, cursorPos: number): { tag: string; start: number; end: number; attrs: string } | null {
  // 查找光标前面最近的 < 开始
  const beforeCursor = text.substring(0, cursorPos);
  const afterCursor = text.substring(cursorPos);

  // 向前找最近的 <
  const openBracket = beforeCursor.lastIndexOf('<');
  if (openBracket === -1) return null;

  // 向后找最近的 >
  const closeBracket = afterCursor.indexOf('>');
  if (closeBracket === -1) return null;

  const tagContent = text.substring(openBracket, cursorPos + closeBracket + 1);

  // 解析标签名和属性
  const match = tagContent.match(/^<(\w+)([^>]*?)(\/?)>$/);
  if (!match) return null;

  return {
    tag: match[1],
    start: openBracket,
    end: cursorPos + closeBracket + 1,
    attrs: match[2],
  };
}

/** 查找选中文本周围的标签 */
function findEnclosingTag(text: string, selStart: number, selEnd: number): { tag: string; openStart: number; openEnd: number; closeStart: number; closeEnd: number } | null {
  // 向前找 <tagname
  const before = text.substring(0, selStart);
  const openMatch = before.match(/<(\w+)[^>]*>$/);
  if (!openMatch) return null;

  const openStart = selStart - openMatch[0].length;
  const tagName = openMatch[1];

  // 向后找 </tagname>
  const after = text.substring(selEnd);
  const closePattern = new RegExp(`^</${tagName}>`);
  const closeMatch = after.match(closePattern);
  if (!closeMatch) return null;

  return {
    tag: tagName,
    openStart,
    openEnd: selStart,
    closeStart: selEnd,
    closeEnd: selEnd + closeMatch[0].length,
  };
}

interface SSMLToolbarProps {
  /** 当前文本内容 */
  text: string;
  /** 文本变更回调 */
  onTextChange: (text: string) => void;
  /** textarea ref，用于操作光标位置 */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 是否启用 SSML */
  enabled: boolean;
}

export function SSMLToolbar({ text, onTextChange, textareaRef, enabled }: SSMLToolbarProps) {
  const [showAttrDialog, setShowAttrDialog] = useState<SSMLTag | null>(null);
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});
  const [pendingInsert, setPendingInsert] = useState<{ selStart: number; selEnd: number } | null>(null);

  /** 获取 textarea 的选中范围 */
  const getSelection = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return { start: 0, end: 0 };
    return { start: ta.selectionStart, end: ta.selectionEnd };
  }, [textareaRef]);

  /** 插入文本到 textarea 并恢复光标 */
  const insertText = useCallback((newText: string, cursorOffset?: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    onTextChange(newText);
    // 恢复焦点和光标
    requestAnimationFrame(() => {
      ta.focus();
      if (cursorOffset !== undefined) {
        ta.setSelectionRange(cursorOffset, cursorOffset);
      }
    });
  }, [textareaRef, onTextChange]);

  /** 构建属性字符串 */
  const buildAttrString = (attrs: Record<string, string>): string => {
    const parts = Object.entries(attrs)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}="${v}"`);
    return parts.length > 0 ? ' ' + parts.join(' ') : '';
  };

  /** 快速插入标签（不需要属性弹窗） */
  const quickInsert = (tag: SSMLTag) => {
    const { start, end } = getSelection();
    const selected = text.substring(start, end);

    if (tag.selfClosing) {
      // 自闭合标签: <break time="500ms"/>
      const attrStr = buildAttrString(tag.defaultAttrs || {});
      const insert = `<${tag.tag}${attrStr}/>`;
      const newText = text.substring(0, start) + insert + text.substring(end);
      insertText(newText, start + insert.length);
    } else if (tag.tag === 'speak' && tag.defaultAttrs?.effect) {
      // speak 音效模式：用 <speak effect="xxx"> 包裹
      const attrStr = buildAttrString(tag.defaultAttrs);
      const insert = `<${tag.tag}${attrStr}>${selected || '文本内容'}</${tag.tag}>`;
      const newText = text.substring(0, start) + insert + text.substring(end);
      const cursorPos = start + `<${tag.tag}${attrStr}>`.length + (selected ? selected.length : 4);
      insertText(newText, cursorPos);
    } else if (tag.tag === 'say-as') {
      // say-as 标签：直接用默认属性包裹选中文本
      const attrStr = buildAttrString(tag.defaultAttrs || {});
      const insert = `<${tag.tag}${attrStr}>${selected || '文本内容'}</${tag.tag}>`;
      const newText = text.substring(0, start) + insert + text.substring(end);
      const cursorPos = start + `<${tag.tag}${attrStr}>`.length + (selected ? selected.length : 4);
      insertText(newText, cursorPos);
    } else if (tag.tag === 'sub') {
      // sub 标签需要用户输入 alias，显示弹窗
      setPendingInsert({ selStart: start, selEnd: end });
      setAttrValues({ alias: '' });
      setShowAttrDialog(tag);
    } else if (tag.tag === 'phoneme') {
      // phoneme 标签需要用户输入拼音
      setPendingInsert({ selStart: start, selEnd: end });
      setAttrValues({ alphabet: 'py', ph: '' });
      setShowAttrDialog(tag);
    } else {
      // 需要属性弹窗的标签
      setPendingInsert({ selStart: start, selEnd: end });
      setAttrValues({ ...tag.defaultAttrs });
      setShowAttrDialog(tag);
    }
  };

  /** 确认属性弹窗 */
  const confirmAttrDialog = () => {
    if (!showAttrDialog || !pendingInsert) return;
    const { selStart, selEnd } = pendingInsert;
    const selected = text.substring(selStart, selEnd);
    const tag = showAttrDialog;

    const attrStr = buildAttrString(attrValues);
    let insert: string;
    let cursorPos: number;

    if (tag.selfClosing) {
      insert = `<${tag.tag}${attrStr}/>`;
      cursorPos = selStart + insert.length;
    } else {
      insert = `<${tag.tag}${attrStr}>${selected || '文本内容'}</${tag.tag}>`;
      cursorPos = selStart + `<${tag.tag}${attrStr}>`.length + (selected ? selected.length : 4);
    }

    const newText = text.substring(0, selStart) + insert + text.substring(selEnd);
    insertText(newText, cursorPos);
    setShowAttrDialog(null);
    setPendingInsert(null);
  };

  /** 删除光标处的标签 */
  const deleteTagAtCursor = () => {
    const { start } = getSelection();
    const found = findSSMLTagAtCursor(text, start);
    if (found) {
      const newText = text.substring(0, found.start) + text.substring(found.end);
      insertText(newText, found.start);
    }
  };

  /** 删除包裹选中文本的标签 */
  const unwrapTag = () => {
    const { start, end } = getSelection();
    if (start === end) {
      // 没有选中文本，尝试删除光标处的标签
      deleteTagAtCursor();
      return;
    }
    const enclosing = findEnclosingTag(text, start, end);
    if (enclosing) {
      const inner = text.substring(enclosing.openEnd, enclosing.closeStart);
      const newText = text.substring(0, enclosing.openStart) + inner + text.substring(enclosing.closeEnd);
      insertText(newText, enclosing.openStart + inner.length);
    }
  };

  if (!enabled) return null;

  return (
    <div className={styles.toolbar}>
      <div className={styles.tagGrid}>
        {SSML_TAGS.map((tag, i) => (
          <button
            key={`${tag.tag}-${i}`}
            className={styles.tagButton}
            onClick={() => quickInsert(tag)}
            title={tag.description}
          >
            {tag.label}
          </button>
        ))}
        <button
          className={`${styles.tagButton} ${styles.dangerButton}`}
          onClick={unwrapTag}
          title="删除选中文本外层的 SSML 标签"
        >
          删除标签
        </button>
      </div>

      <div className={styles.hint}>
        💡 选中文本后点击标签按钮，即可用 SSML 标签包裹。光标在标签内时点击「删除标签」可移除。
      </div>

      {/* 属性输入弹窗 */}
      {showAttrDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowAttrDialog(null)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <div className={styles.dialogTitle}>
              {showAttrDialog.label} — &lt;{showAttrDialog.tag}&gt;
            </div>
            <div className={styles.dialogDesc}>{showAttrDialog.description}</div>
            {(showAttrDialog.optionalAttrs || []).map(attr => (
              <div key={attr.name} className={styles.attrField}>
                <label>{attr.label}</label>
                {attr.options ? (
                  <select
                    value={attrValues[attr.name] || ''}
                    onChange={e => setAttrValues(prev => ({ ...prev, [attr.name]: e.target.value }))}
                  >
                    <option value="">选择...</option>
                    {attr.options.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder={attr.placeholder}
                    value={attrValues[attr.name] || ''}
                    onChange={e => setAttrValues(prev => ({ ...prev, [attr.name]: e.target.value }))}
                    autoFocus
                  />
                )}
              </div>
            ))}
            <div className={styles.dialogActions}>
              <button className={styles.cancelBtn} onClick={() => setShowAttrDialog(null)}>取消</button>
              <button className={styles.confirmBtn} onClick={confirmAttrDialog}>插入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
