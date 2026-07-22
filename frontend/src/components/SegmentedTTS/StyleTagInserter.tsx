import { useCallback, type RefObject } from 'react';
import { STYLE_TAG_CATEGORIES } from '../../services/styleTags';
import { insertTagAtSelection } from './styleTagInsert';
import styles from './StyleTagInserter.module.css';

interface Props {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onTextChange: (text: string) => void;
  /** 章节引擎是否支持 inline（位置）tag；不支持时仍可用但显示移除提示。 */
  inlineSupported: boolean;
}

/** voxcpm 位置 tag 分类插入菜单（哭笑/叹息/停顿思考/疑问/情绪）。 */
export function StyleTagInserter({ textareaRef, onTextChange, inlineSupported }: Props) {
  const insertTag = useCallback(
    (tag: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const { selectionStart, selectionEnd, value } = ta;
      const result = insertTagAtSelection(value, selectionStart, selectionEnd, tag);
      onTextChange(result.text);
      // 受控 textarea 更新后再恢复选区
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(result.selectionStart, result.selectionEnd);
      }, 0);
    },
    [textareaRef, onTextChange],
  );

  return (
    <div className={styles.inserter}>
      <div className={styles.groups}>
        {STYLE_TAG_CATEGORIES.map((cat) => (
          <div key={cat.key} className={styles.group}>
            <span className={styles.groupLabel}>{cat.label}</span>
            {cat.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={styles.tagBtn}
                onClick={() => insertTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        ))}
      </div>
      {!inlineSupported && (
        <div className={styles.hint}>当前引擎不支持位置 tag，合成时将自动移除</div>
      )}
    </div>
  );
}
