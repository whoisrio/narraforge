/**
 * SSML 专业编辑器
 *
 * 功能：
 * - 分类标签栏（语音控制 / 特殊读法 / 停顿强调 / 音效）
 * - 语法高亮覆盖层（标签彩色标注）
 * - SSML 结构树面板
 * - 模板库（常用 SSML 片段一键插入）
 * - 属性编辑弹窗（带说明和校验）
 * - SSML 结构校验
 */
import { useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation, t as translate } from '../../i18n';
import styles from './SSMLToolbar.module.css';

/* ─── SSML 标签定义 ─── */
interface SSMLTag {
  label: string;
  tag: string;
  description: string;
  selfClosing?: boolean;
  defaultAttrs?: Record<string, string>;
  optionalAttrs?: { name: string; label: string; placeholder?: string; options?: string[]; description?: string }[];
}

interface TagCategory {
  name: string;
  icon: string;
  tags: SSMLTag[];
}

const TAG_CATEGORIES: TagCategory[] = [
  {
    name: translate('ssml.voiceControl'),
    icon: '🎛️',
    tags: [
      {
        label: translate('ssml.effectMode'),
        tag: 'speak',
        description: translate('ssml.effectModeDesc'),
        defaultAttrs: { effect: 'robot' },
        optionalAttrs: [
          { name: 'effect', label: translate('ssml.effectType'), options: ['robot', 'lolita', 'lowpass', 'echo'], description: translate('ssml.effectTypeDesc') },
        ],
      },
    ],
  },
  {
    name: translate('ssml.pauseEmphasis'),
    icon: '⏸️',
    tags: [
      {
        label: translate('ssml.insertPause'),
        tag: 'break',
        description: translate('ssml.insertPauseDesc'),
        selfClosing: true,
        defaultAttrs: { time: '500ms' },
        optionalAttrs: [
          { name: 'time', label: translate('ssml.pauseDuration'), placeholder: translate('ssml.pauseDurationPlaceholder'), options: ['200ms', '300ms', '500ms', '1s', '2s', '3s', '5s'], description: translate('ssml.pauseDurationDesc') },
        ],
      },
    ],
  },
  {
    name: translate('ssml.pronunciationCorrection'),
    icon: '🔤',
    tags: [
      {
        label: translate('ssml.pinyinAnnotation'),
        tag: 'phoneme',
        description: translate('ssml.pinyinAnnotationDesc'),
        defaultAttrs: { alphabet: 'py', ph: '' },
        optionalAttrs: [
          { name: 'alphabet', label: translate('ssml.annotationType'), options: ['py', 'cmu'], description: translate('ssml.annotationTypeDesc') },
          { name: 'ph', label: translate('ssml.pinyinOrPhoneme'), placeholder: translate('ssml.pinyinPlaceholder'), description: translate('ssml.pinyinDesc') },
        ],
      },
      {
        label: translate('ssml.substituteReading'),
        tag: 'sub',
        description: translate('ssml.substituteReadingDesc'),
        defaultAttrs: { alias: '' },
        optionalAttrs: [
          { name: 'alias', label: translate('ssml.readingContent'), placeholder: translate('ssml.readingContentPlaceholder'), description: translate('ssml.readingContentDesc') },
        ],
      },
    ],
  },
  {
    name: translate('ssml.specialReading'),
    icon: '🔢',
    tags: [
      { label: translate('ssml.digitReading'), tag: 'say-as', description: translate('ssml.digitReadingDesc'), defaultAttrs: { 'interpret-as': 'digits' } },
      { label: translate('ssml.telephoneNumber'), tag: 'say-as', description: translate('ssml.telephoneNumberDesc'), defaultAttrs: { 'interpret-as': 'telephone' } },
      { label: translate('ssml.date'), tag: 'say-as', description: translate('ssml.dateDesc'), defaultAttrs: { 'interpret-as': 'date' } },
      { label: translate('ssml.time'), tag: 'say-as', description: translate('ssml.timeDesc'), defaultAttrs: { 'interpret-as': 'time' } },
      { label: translate('ssml.currency'), tag: 'say-as', description: translate('ssml.currencyDesc'), defaultAttrs: { 'interpret-as': 'currency' } },
      { label: translate('ssml.characters'), tag: 'say-as', description: translate('ssml.charactersDesc'), defaultAttrs: { 'interpret-as': 'characters' } },
    ],
  },
  {
    name: translate('ssml.soundEffectInsert'),
    icon: '🔊',
    tags: [
      {
        label: translate('ssml.insertSoundEffect'),
        tag: 'soundEvent',
        description: translate('ssml.insertSoundEffectDesc'),
        selfClosing: true,
        defaultAttrs: { src: '' },
        optionalAttrs: [
          { name: 'src', label: translate('ssml.audioUrl'), placeholder: translate('ssml.audioUrlPlaceholder'), description: translate('ssml.audioUrlDesc') },
        ],
      },
    ],
  },
];

/* ─── SSML 模板 ─── */
interface SSMLTemplate {
  name: string;
  description: string;
  content: string;
}

const SSML_TEMPLATES: SSMLTemplate[] = [
  {
    name: translate('ssml.polyphoneCorrection'),
    description: translate('ssml.polyphoneCorrectionDesc'),
    content: '<phoneme alphabet="py" ph="hang2">行</phoneme>业标准',
  },
  {
    name: translate('ssml.digitsAndUnit'),
    description: translate('ssml.digitsAndUnitDesc'),
    content: '<say-as interpret-as="digits">138</say-as>号文件',
  },
  {
    name: translate('ssml.telephoneNumber'),
    description: translate('ssml.telephoneNumberTplDesc'),
    content: '联系电话<say-as interpret-as="telephone">13800138000</say-as>',
  },
  {
    name: translate('ssml.pauseSegment'),
    description: translate('ssml.pauseSegmentDesc'),
    content: '第一句话说完了。<break time="800ms"/>接下来是第二句。',
  },
  {
    name: translate('ssml.abbreviationReplace'),
    description: translate('ssml.abbreviationReplaceDesc'),
    content: '<sub alias="超文本传输协议">HTTP</sub>是网络的基础协议',
  },
  {
    name: translate('ssml.robotEffect'),
    description: translate('ssml.robotEffectDesc'),
    content: '<speak effect="robot">你好，我是机器人。</speak>',
  },
];

/* ─── SSML 结构解析 ─── */
interface SSMLNode {
  tag: string;
  attrs: string;
  start: number;
  end: number;
  children: SSMLNode[];
  text?: string;
}

function parseSSMLStructure(text: string): SSMLNode[] {
  const nodes: SSMLNode[] = [];
  const tagRegex = /<(\w+)([^>]*?)(\/?)>/g;
  const closeTagRegex = /<\/(\w+)>/g;
  let match: RegExpExecArray | null;

  // Simple flat parse — find all opening tags
  const openTags: { tag: string; attrs: string; start: number; selfClose: boolean }[] = [];
  const closeTags: { tag: string; pos: number }[] = [];

  tagRegex.lastIndex = 0;
  while ((match = tagRegex.exec(text)) !== null) {
    if (match[3] === '/') {
      openTags.push({ tag: match[1], attrs: match[2], start: match.index, selfClose: true });
    } else {
      openTags.push({ tag: match[1], attrs: match[2], start: match.index, selfClose: false });
    }
  }

  closeTagRegex.lastIndex = 0;
  while ((match = closeTagRegex.exec(text)) !== null) {
    closeTags.push({ tag: match[1], pos: match.index });
  }

  // Build flat node list
  for (const ot of openTags) {
    const closePos = ot.selfClose
      ? ot.start
      : closeTags.find(ct => ct.tag === ot.tag && ct.pos > ot.start)?.pos ?? text.length;

    nodes.push({
      tag: ot.tag,
      attrs: ot.attrs.trim(),
      start: ot.start,
      end: closePos,
      children: [],
    });
  }

  return nodes;
}

/* ─── SSML 校验 ─── */
interface ValidationIssue {
  type: 'error' | 'warning';
  message: string;
  position?: number;
}

function validateSSML(text: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const openTagRegex = /<(\w+)([^>]*?)>/g;
  const closeTagRegex = /<\/(\w+)>/g;

  const stack: { tag: string; pos: number }[] = [];
  let match: RegExpExecArray | null;

  // Collect all tags in order
  const allTags: { type: 'open' | 'close'; tag: string; pos: number }[] = [];

  openTagRegex.lastIndex = 0;
  while ((match = openTagRegex.exec(text)) !== null) {
    if (match[0].endsWith('/>')) continue; // skip self-closing
    allTags.push({ type: 'open', tag: match[1], pos: match.index });
  }

  closeTagRegex.lastIndex = 0;
  while ((match = closeTagRegex.exec(text)) !== null) {
    allTags.push({ type: 'close', tag: match[1], pos: match.index });
  }

  allTags.sort((a, b) => a.pos - b.pos);

  for (const t of allTags) {
    if (t.type === 'open') {
      stack.push({ tag: t.tag, pos: t.pos });
    } else {
      if (stack.length === 0) {
        issues.push({ type: 'error', message: translate('ssml.unexpectedCloseTag', { tag: t.tag }), position: t.pos });
      } else {
        const top = stack[stack.length - 1];
        if (top.tag !== t.tag) {
          issues.push({
            type: 'error',
            message: translate('ssml.tagMismatch', { expected: top.tag, actual: t.tag }),
            position: t.pos,
          });
        } else {
          stack.pop();
        }
      }
    }
  }

  for (const unclosed of stack) {
    issues.push({ type: 'error', message: translate('ssml.unclosedTag', { tag: unclosed.tag }), position: unclosed.pos });
  }

  return issues;
}

/* ─── 工具函数 ─── */
function buildAttrString(attrs: Record<string, string>): string {
  const parts = Object.entries(attrs)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}="${v}"`);
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

function findSSMLTagAtCursor(text: string, cursorPos: number): { tag: string; start: number; end: number } | null {
  const before = text.substring(0, cursorPos);
  const after = text.substring(cursorPos);
  const openBracket = before.lastIndexOf('<');
  if (openBracket === -1) return null;
  const closeBracket = after.indexOf('>');
  if (closeBracket === -1) return null;
  const tagContent = text.substring(openBracket, cursorPos + closeBracket + 1);
  const match = tagContent.match(/^<(\w+)([^>]*?)(\/?)>$/);
  if (!match) return null;
  return { tag: match[1], start: openBracket, end: cursorPos + closeBracket + 1 };
}

function findEnclosingTag(text: string, selStart: number, selEnd: number) {
  const before = text.substring(0, selStart);
  const openMatch = before.match(/<(\w+)[^>]*>$/);
  if (!openMatch) return null;
  const openStart = selStart - openMatch[0].length;
  const tagName = openMatch[1];
  const after = text.substring(selEnd);
  const closePattern = new RegExp(`^</${tagName}>`);
  const closeMatch = after.match(closePattern);
  if (!closeMatch) return null;
  return { tag: tagName, openStart, openEnd: selStart, closeStart: selEnd, closeEnd: selEnd + closeMatch[0].length };
}

/* ─── 结构树面板 ─── */
function StructureTree({ text, onJump }: { text: string; onJump: (pos: number) => void }) {
  const { t } = useTranslation();
  const nodes = useMemo(() => parseSSMLStructure(text), [text]);
  const issues = useMemo(() => validateSSML(text), [text]);

  if (nodes.length === 0 && issues.length === 0) {
    return <div className={styles.treeEmpty}>{t('ssml.noSsmlTags')}</div>;
  }

  return (
    <div className={styles.treePanel}>
      {issues.length > 0 && (
        <div className={styles.treeIssues}>
          {issues.map((iss, i) => (
            <div key={i} className={iss.type === 'error' ? styles.treeError : styles.treeWarning}
              onClick={() => iss.position !== undefined && onJump(iss.position)}
            >
              {iss.type === 'error' ? '❌' : '⚠️'} {iss.message}
            </div>
          ))}
        </div>
      )}
      {nodes.map((node, i) => (
        <div key={i} className={styles.treeNode} onClick={() => onJump(node.start)}>
          <span className={styles.treeTag}>&lt;{node.tag}&gt;</span>
          {node.attrs && <span className={styles.treeAttrs}>{node.attrs}</span>}
        </div>
      ))}
    </div>
  );
}

/* ─── 主组件 ─── */
interface SSMLToolbarProps {
  text: string;
  onTextChange: (text: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  enabled: boolean;
}

export function SSMLToolbar({ text, onTextChange, textareaRef, enabled }: SSMLToolbarProps) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState(0);
  const [showAttrDialog, setShowAttrDialog] = useState<SSMLTag | null>(null);
  const [attrValues, setAttrValues] = useState<Record<string, string>>({});
  const [pendingInsert, setPendingInsert] = useState<{ selStart: number; selEnd: number } | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const getSelection = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return { start: 0, end: 0 };
    return { start: ta.selectionStart, end: ta.selectionEnd };
  }, [textareaRef]);

  const insertText = useCallback((newText: string, cursorOffset?: number) => {
    onTextChange(newText);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        if (cursorOffset !== undefined) ta.setSelectionRange(cursorOffset, cursorOffset);
      }
    });
  }, [textareaRef, onTextChange]);

  const quickInsert = (tag: SSMLTag) => {
    const { start, end } = getSelection();
    const selected = text.substring(start, end);

    if (tag.selfClosing) {
      const attrStr = buildAttrString(tag.defaultAttrs || {});
      const insert = `<${tag.tag}${attrStr}/>`;
      insertText(text.substring(0, start) + insert + text.substring(end), start + insert.length);
    } else if (tag.optionalAttrs && tag.optionalAttrs.length > 0 && !tag.defaultAttrs) {
      // Needs user input
      setPendingInsert({ selStart: start, selEnd: end });
      setAttrValues({});
      setShowAttrDialog(tag);
    } else if (tag.tag === 'sub' || tag.tag === 'phoneme') {
      setPendingInsert({ selStart: start, selEnd: end });
      setAttrValues(tag.tag === 'phoneme' ? { alphabet: 'py', ph: '' } : { alias: '' });
      setShowAttrDialog(tag);
    } else {
      const attrStr = buildAttrString(tag.defaultAttrs || {});
      const insert = `<${tag.tag}${attrStr}>${selected || t('ssml.textContent')}</${tag.tag}>`;
      const cursorPos = start + `<${tag.tag}${attrStr}>`.length + (selected ? selected.length : 4);
      insertText(text.substring(0, start) + insert + text.substring(end), cursorPos);
    }
  };

  const insertTemplate = (tpl: SSMLTemplate) => {
    const { start, end } = getSelection();
    insertText(text.substring(0, start) + tpl.content + text.substring(end), start + tpl.content.length);
    setShowTemplates(false);
  };

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
      insert = `<${tag.tag}${attrStr}>${selected || t('ssml.textContent')}</${tag.tag}>`;
      cursorPos = selStart + `<${tag.tag}${attrStr}>`.length + (selected ? selected.length : 4);
    }

    insertText(text.substring(0, selStart) + insert + text.substring(selEnd), cursorPos);
    setShowAttrDialog(null);
    setPendingInsert(null);
  };

  const unwrapTag = () => {
    const { start, end } = getSelection();
    if (start === end) {
      const found = findSSMLTagAtCursor(text, start);
      if (found) {
        insertText(text.substring(0, found.start) + text.substring(found.end), found.start);
      }
      return;
    }
    const enclosing = findEnclosingTag(text, start, end);
    if (enclosing) {
      const inner = text.substring(enclosing.openEnd, enclosing.closeStart);
      insertText(text.substring(0, enclosing.openStart) + inner + text.substring(enclosing.closeEnd), enclosing.openStart + inner.length);
    }
  };

  const jumpToPosition = (pos: number) => {
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(pos, pos);
      ta.scrollTop = ta.scrollHeight * (pos / text.length) - ta.clientHeight / 2;
    }
  };

  if (!enabled) return null;

  const category = TAG_CATEGORIES[activeCategory];

  return (
    <div className={styles.toolbar} ref={wrapperRef}>
      {/* 分类标签栏 */}
      <div className={styles.categoryTabs}>
        {TAG_CATEGORIES.map((cat, i) => (
          <button
            key={cat.name}
            className={`${styles.categoryTab} ${i === activeCategory ? styles.categoryTabActive : ''}`}
            onClick={() => setActiveCategory(i)}
          >
            {cat.icon} {cat.name}
          </button>
        ))}
        <div className={styles.categorySpacer} />
        <button
          className={`${styles.categoryTab} ${showTemplates ? styles.categoryTabActive : ''}`}
          onClick={() => { setShowTemplates(!showTemplates); setShowStructure(false); }}
        >
          📋 {t('ssml.templates')}
        </button>
        <button
          className={`${styles.categoryTab} ${showStructure ? styles.categoryTabActive : ''}`}
          onClick={() => { setShowStructure(!showStructure); setShowTemplates(false); }}
        >
          🌳 {t('ssml.structure')}
        </button>
      </div>

      {/* 标签按钮区 */}
      {!showTemplates && !showStructure && (
        <div className={styles.tagGrid}>
          {category.tags.map((tag, i) => (
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
            title="删除光标处/选区外层的 SSML 标签"
          >
            {t('ssml.deleteTag')}
          </button>
        </div>
      )}

      {/* 模板库 */}
      {showTemplates && (
        <div className={styles.templateGrid}>
          {SSML_TEMPLATES.map((tpl, i) => (
            <button key={i} className={styles.templateCard} onClick={() => insertTemplate(tpl)}>
              <div className={styles.templateName}>{tpl.name}</div>
              <div className={styles.templateDesc}>{tpl.description}</div>
              <code className={styles.templateCode}>{tpl.content.length > 50 ? tpl.content.slice(0, 50) + '…' : tpl.content}</code>
            </button>
          ))}
        </div>
      )}

      {/* 结构树 + 校验 */}
      {showStructure && (
        <StructureTree text={text} onJump={jumpToPosition} />
      )}

      {/* 提示条 */}
      <div className={styles.hint}>
        💡 {t('ssml.hintBar')}
      </div>

      {/* 属性编辑弹窗 */}
      {showAttrDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowAttrDialog(null)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <div className={styles.dialogTitle}>
              {showAttrDialog.label} — &lt;{showAttrDialog.tag}&gt;
            </div>
            <div className={styles.dialogDesc}>{showAttrDialog.description}</div>
            {(showAttrDialog.optionalAttrs || []).map(attr => (
              <div key={attr.name} className={styles.attrField}>
                <label>
                  {attr.label}
                  {attr.description && <span className={styles.attrHint}> — {attr.description}</span>}
                </label>
                {attr.options ? (
                  <select
                    value={attrValues[attr.name] || ''}
                    onChange={e => setAttrValues(prev => ({ ...prev, [attr.name]: e.target.value }))}
                  >
                    <option value="">{t('common.selectPlaceholder')}</option>
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

            {/* 实时预览 */}
            <div className={styles.previewBox}>
              <div className={styles.previewLabel}>{t('ssml.preview')}</div>
              <code>
                {(() => {
                  const attrStr = buildAttrString(attrValues);
                  if (showAttrDialog.selfClosing) return `<${showAttrDialog.tag}${attrStr}/>`;
                  return `<${showAttrDialog.tag}${attrStr}>文本内容</${showAttrDialog.tag}>`;
                })()}
              </code>
            </div>

            <div className={styles.dialogActions}>
              <button className={styles.cancelBtn} onClick={() => setShowAttrDialog(null)}>{t('common.cancel')}</button>
              <button className={styles.confirmBtn} onClick={confirmAttrDialog}>{t('ssml.insert')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
